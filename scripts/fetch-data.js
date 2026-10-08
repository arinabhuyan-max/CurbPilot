#!/usr/bin/env node
// Downloads NYC DOT "Parking Regulation Locations and Signs" (NYC Open Data,
// dataset nfid-uabd) for all five boroughs.
// Output: data/raw-signs.ndjson (one sign per line, normalized field names),
// written as it downloads so the city-wide set never sits in memory at once.
//
//   npm run fetch-data
//   SOCRATA_APP_TOKEN=... npm run fetch-data   (optional, raises rate limits)

const fs = require('fs');
const path = require('path');
const { area } = require('../src/config');
const { statePlaneToLatLon } = require('../src/geo');

const DATASET = process.env.CURBPILOT_DATASET || 'https://data.cityofnewyork.us/resource/nfid-uabd.json';
const PAGE = 50000;
const OUT = path.join(__dirname, '..', 'data', 'raw-signs.ndjson');

const pick = (row, names) => {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return undefined;
};

// The city has renamed columns between releases, so accept the known variants.
function normalizeRow(row) {
  let lat = Number(pick(row, ['latitude', 'lat']));
  let lon = Number(pick(row, ['longitude', 'long', 'lon']));
  const loc = pick(row, ['location', 'the_geom', 'georeference']);
  if ((!lat || !lon) && loc && Array.isArray(loc.coordinates)) [lon, lat] = loc.coordinates;
  if (!lat || !lon) {
    const x = Number(pick(row, ['sign_x_coord', 'x_coord', 'x']));
    const y = Number(pick(row, ['sign_y_coord', 'y_coord', 'y']));
    if (x && y) [lat, lon] = statePlaneToLatLon(x, y);
  }
  return {
    order: pick(row, ['order_number', 'order_no']),
    on_street: pick(row, ['on_street', 'main_st']),
    from_street: pick(row, ['from_street', 'from_st']),
    to_street: pick(row, ['to_street', 'to_st']),
    side: String(pick(row, ['side_of_street', 'side']) || '').toUpperCase().charAt(0),
    text: pick(row, ['sign_description', 'signdesc', 'sign_desc']),
    code: pick(row, ['sign_code', 'mutcd_code']),
    distance: Number(pick(row, ['distance_from_intersection', 'distx'])) || null,
    arrow: pick(row, ['arrow_direction', 'arrow_points']),
    voided: pick(row, ['sign_design_voided_on_date']),
    lat,
    lon,
  };
}

function inArea({ lat, lon }) {
  const b = area.bbox;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

// The city's server occasionally drops a page; try each page a few times.
async function fetchWithRetry(url, headers) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
      if (res.ok || attempt === 4 || (res.status < 500 && res.status !== 429)) return res;
    } catch (err) {
      if (attempt === 4) throw err;
    }
    await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
  }
}

async function main() {
  const headers = process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {};
  // Optional filter, e.g. CURBPILOT_WHERE="upper(borough)='MANHATTAN'"
  const where = process.env.CURBPILOT_WHERE;
  const out = fs.createWriteStream(OUT);
  let kept = 0;
  let seen = 0;
  for (let offset = 0; ; offset += PAGE) {
    const filter = where ? `$where=${encodeURIComponent(where)}&` : '';
    const url = `${DATASET}?${filter}$limit=${PAGE}&$offset=${offset}&$order=:id`;
    process.stdout.write(`Fetching rows ${offset}…`);
    const res = await fetchWithRetry(url, headers);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    if (offset === 0 && rows[0]) console.log(`\n  columns: ${Object.keys(rows[0]).join(', ')}`);
    seen += rows.length;
    for (const r of rows.map(normalizeRow)) {
      if (r.text && r.on_street && r.lat && r.lon && !r.voided && inArea(r)) {
        if (!out.write(JSON.stringify(r) + '\n')) await new Promise((ok) => out.once('drain', ok));
        kept++;
      }
    }
    console.log(` ${rows.length} rows, ${kept} kept so far`);
    if (rows.length < PAGE) break;
  }
  await new Promise((ok) => out.end(ok));
  if (!kept) {
    throw new Error(`Fetched ${seen} rows but none had usable NYC coordinates. Check the column names printed above.`);
  }
  console.log(`Wrote ${kept} of ${seen} signs to ${path.relative(process.cwd(), OUT)}. Next: npm run build-data`);
}

main().catch((err) => {
  console.error(`\nfetch-data failed: ${err.message}`);
  process.exit(1);
});
