// Loads curb data and finds the block faces near a point quickly.
//
// File format (see scripts/build-data.js):
//   { meta, rules: [rule], faces: [[street, from, to, side, [lat, lon, ...], [ruleIndex]]] }

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CELL = 0.005; // degrees, ~550 m north-south; searching 3x3 cells covers the 300 m we need

const cellKey = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

function expand(raw) {
  const blockfaces = raw.faces.map(([street, from, to, side, coords, ruleIds]) => {
    const line = [];
    for (let i = 0; i < coords.length; i += 2) line.push([coords[i], coords[i + 1]]);
    return { street, from, to, side, line, rules: ruleIds.map((i) => raw.rules[i]) };
  });
  // Grid index: every cell a face's endpoints touch.
  const index = new Map();
  for (const f of blockfaces) {
    const keys = new Set(f.line.map(([lat, lon]) => cellKey(lat, lon)));
    for (const k of keys) {
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(f);
    }
  }
  return { meta: raw.meta, blockfaces, index };
}

// Real city data (data/curbs.json) wins; otherwise the bundled demo set.
function loadData(file) {
  const candidates = file ? [file] : [path.join(DATA_DIR, 'curbs.json'), path.join(DATA_DIR, 'demo.json')];
  for (const f of candidates) {
    if (fs.existsSync(f)) return expand(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  throw new Error('No curb data found. Run `npm run demo-data` or `npm run fetch-data && npm run build-data`.');
}

function facesNear(data, lat, lon) {
  const r = Math.floor(lat / CELL);
  const c = Math.floor(lon / CELL);
  const found = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      for (const f of data.index.get(`${r + dr}:${c + dc}`) || []) found.add(f);
    }
  }
  return [...found];
}

module.exports = { loadData, facesNear };
