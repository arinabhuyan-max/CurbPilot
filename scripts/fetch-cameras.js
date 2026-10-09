#!/usr/bin/env node
// Downloads the public NYC DOT traffic camera list (the city cameras that 511NY
// and Globe TV also show) into data/cameras.json for the "live camera" view.
//
//   npm run fetch-cameras

const fs = require('fs');
const path = require('path');
const { area } = require('../src/config');
const { ID_RE } = require('../src/cameras');

const SOURCE = process.env.CURBPILOT_CAMERAS_URL || 'https://webcams.nyctmc.org/api/cameras';
const OUT = path.join(__dirname, '..', 'data', 'cameras.json');

async function main() {
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(SOURCE, { signal: AbortSignal.timeout(60000) });
      if (res.ok) break;
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((ok) => setTimeout(ok, 3000 * attempt));
  }
  if (!res || !res.ok) throw new Error(`HTTP ${res && res.status} from ${SOURCE}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected response: not a list of cameras');

  const b = area.bbox;
  const cameras = rows
    .filter((r) => ID_RE.test(String(r.id)) && String(r.isOnline) !== 'false')
    .map((r) => [String(r.id), String(r.name || '').trim(), Number(r.latitude), Number(r.longitude), String(r.area || '')])
    .filter(([, , lat, lon]) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east)
    .map(([id, name, lat, lon, a]) => [id, name, Number(lat.toFixed(6)), Number(lon.toFixed(6)), a])
    .sort((x, y) => x[0].localeCompare(y[0])); // stable order keeps weekly diffs small

  if (cameras.length < 100) throw new Error(`Only ${cameras.length} usable cameras out of ${rows.length}; not overwriting.`);
  const out = { meta: { source: SOURCE, provider: 'NYC DOT traffic cameras', count: cameras.length }, cameras };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const byArea = {};
  for (const c of cameras) byArea[c[4]] = (byArea[c[4]] || 0) + 1;
  console.log(`Wrote ${cameras.length} of ${rows.length} cameras to ${path.relative(process.cwd(), OUT)}`, byArea);
}

main().catch((err) => {
  console.error(`fetch-cameras failed: ${err.message}`);
  process.exit(1);
});
