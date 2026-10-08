#!/usr/bin/env node
// Turns raw sign rows into block faces with structured rules.
//
//   npm run build-data                       raw-signs.json -> pilot.json
//   npm run build-data -- --ai               also let Claude read unparsed signs
//   node scripts/build-data.js IN OUT [--demo] [--ai]
//
// Prints every sign it could not read so a person can check them.

const fs = require('fs');
const path = require('path');
const { parseSign } = require('../src/rules');
const { normalizeStreet } = require('../src/streets');
const { distanceMeters } = require('../src/geo');
const { area } = require('../src/config');

const DATA = path.join(__dirname, '..', 'data');

function farthestPair(points) {
  if (points.length < 2) return points;
  let best = [points[0], points[0]];
  let bestD = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distanceMeters(points[i], points[j]);
      if (d > bestD) [best, bestD] = [[points[i], points[j]], d];
    }
  }
  return best;
}

function groupFaces(rows) {
  const faces = new Map();
  for (const r of rows) {
    const key = [normalizeStreet(r.on_street), normalizeStreet(r.from_street), normalizeStreet(r.to_street), r.side].join('|');
    if (!faces.has(key)) {
      faces.set(key, {
        id: key,
        street: normalizeStreet(r.on_street),
        from: normalizeStreet(r.from_street),
        to: normalizeStreet(r.to_street),
        side: r.side,
        points: [],
        texts: new Set(),
      });
    }
    const f = faces.get(key);
    f.points.push([Number(r.lat.toFixed(6)), Number(r.lon.toFixed(6))]);
    f.texts.add(String(r.text).trim());
  }
  return [...faces.values()];
}

async function build(inFile, outFile, { demo = false, ai = false } = {}) {
  const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const faces = groupFaces(raw.rows);

  const parsed = new Map();
  for (const f of faces) for (const t of f.texts) if (!parsed.has(t)) parsed.set(t, parseSign(t));

  let unknown = [...parsed.values()].filter((r) => r.kind === 'unknown').map((r) => r.text);
  if (ai && unknown.length) {
    const { aiReadSigns } = require('./ai-rules');
    console.log(`Asking Claude to read ${unknown.length} sign(s) the parser couldn't…`);
    const read = await aiReadSigns(unknown);
    for (const [text, rule] of read) parsed.set(text, rule);
    unknown = unknown.filter((t) => !read.has(t));
  }

  const blockfaces = faces.map((f) => ({
    id: f.id,
    street: f.street,
    from: f.from,
    to: f.to,
    side: f.side,
    line: farthestPair(f.points),
    rules: [...f.texts].map((t) => parsed.get(t)),
  }));

  const out = {
    meta: {
      demo,
      area: area.name,
      source: demo ? 'Illustrative sample signs (NOT real NYC data)' : raw.source,
      fetchedAt: raw.fetchedAt || null,
      builtAt: new Date().toISOString(),
      signs: raw.rows.length,
      unreadSigns: unknown.length,
    },
    blockfaces,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

  const kinds = {};
  for (const r of parsed.values()) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  console.log(`Built ${blockfaces.length} block faces from ${raw.rows.length} signs -> ${path.relative(process.cwd(), outFile)}`);
  console.log('Distinct sign texts by kind:', kinds);
  if (unknown.length) {
    console.log(`\n${unknown.length} sign text(s) could not be read. Drivers will be told to check these:`);
    for (const t of unknown.slice(0, 50)) console.log(`  - ${t}`);
    if (!ai) console.log('Tip: `npm run build-data -- --ai` lets Claude read them (needs ANTHROPIC_API_KEY).');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [inFile = path.join(DATA, 'raw-signs.json'), outFile = path.join(DATA, 'pilot.json')] = args.filter(
    (a) => !a.startsWith('--')
  );
  build(inFile, outFile, { demo: flags.has('--demo'), ai: flags.has('--ai') }).catch((err) => {
    console.error(`build-data failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { build, groupFaces };
