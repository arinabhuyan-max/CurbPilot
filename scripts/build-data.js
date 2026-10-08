#!/usr/bin/env node
// Turns raw sign rows into block faces with structured rules.
//
//   npm run build-data                       raw-signs.ndjson -> curbs.json
//   npm run build-data -- --ai               also let Claude read unparsed signs
//   node scripts/build-data.js IN OUT [--demo] [--ai]
//
// IN is NDJSON (one sign per line, from fetch-data) or JSON ({ rows: [...] }).
// OUT is compact so all of NYC fits in one file: each distinct sign text is
// parsed once into a shared rules table, and faces point at rules by index:
//   { meta, rules: [rule], faces: [[street, from, to, side, [lat, lon, ...], [ruleIndex]]] }
// src/data.js expands it back into block faces.
//
// Prints the sign texts it could not read so a person can check them.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
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

async function* readRows(file) {
  if (!file.endsWith('.ndjson')) {
    yield* JSON.parse(fs.readFileSync(file, 'utf8')).rows;
    return;
  }
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line);
}

async function groupFaces(file) {
  const faces = new Map();
  let signs = 0;
  for await (const r of readRows(file)) {
    signs++;
    const street = normalizeStreet(r.on_street);
    const from = normalizeStreet(r.from_street);
    const to = normalizeStreet(r.to_street);
    const key = `${street}|${from}|${to}|${r.side}`;
    let f = faces.get(key);
    if (!f) faces.set(key, (f = { street, from, to, side: r.side, points: [], texts: new Set() }));
    // Signs on one pole share a point; keep each location once.
    const p = [Number(Number(r.lat).toFixed(5)), Number(Number(r.lon).toFixed(5))];
    if (!f.points.some((q) => q[0] === p[0] && q[1] === p[1])) f.points.push(p);
    f.texts.add(String(r.text).trim());
  }
  return { faces: [...faces.values()], signs };
}

async function build(inFile, outFile, { demo = false, ai = false } = {}) {
  const { faces, signs } = await groupFaces(inFile);

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

  // Shared rules table; info plates are dropped since they never affect an answer.
  const rules = [];
  const ruleIndex = new Map();
  for (const [text, rule] of parsed) {
    if (rule.kind === 'info') continue;
    ruleIndex.set(text, rules.length);
    rules.push(rule);
  }
  const compactFaces = faces
    .map((f) => [
      f.street,
      f.from,
      f.to,
      f.side,
      farthestPair(f.points).flat(),
      [...f.texts].filter((t) => ruleIndex.has(t)).map((t) => ruleIndex.get(t)),
    ])
    .filter((f) => f[0] && f[4].length);

  const out = {
    meta: {
      demo,
      area: area.name,
      source: demo ? 'Illustrative sample signs (NOT real NYC data)' : 'NYC Open Data: Parking Regulation Locations and Signs',
      builtAt: new Date().toISOString(),
      signs,
      faces: compactFaces.length,
      unreadSigns: unknown.length,
    },
    rules,
    faces: compactFaces,
  };
  fs.writeFileSync(outFile, JSON.stringify(out));

  const kinds = {};
  for (const r of parsed.values()) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const mb = (fs.statSync(outFile).size / 1e6).toFixed(1);
  console.log(`Built ${compactFaces.length} block faces from ${signs} signs -> ${path.relative(process.cwd(), outFile)} (${mb} MB)`);
  console.log('Distinct sign texts by kind:', kinds);
  if (unknown.length) {
    console.log(`\n${unknown.length} sign text(s) could not be read. Drivers will be told to check these:`);
    for (const t of unknown.slice(0, 100)) console.log(`  - ${t}`);
    if (unknown.length > 100) console.log(`  … and ${unknown.length - 100} more`);
    if (!ai) console.log('Tip: `npm run build-data -- --ai` lets Claude read them (needs ANTHROPIC_API_KEY).');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [inFile = path.join(DATA, 'raw-signs.ndjson'), outFile = path.join(DATA, 'curbs.json')] = args.filter(
    (a) => !a.startsWith('--')
  );
  build(inFile, outFile, { demo: flags.has('--demo'), ai: flags.has('--ai') }).catch((err) => {
    console.error(`build-data failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { build };
