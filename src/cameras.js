// Public NYC DOT traffic cameras: find the ones nearest an address.
//
// These are the same city cameras that 511NY and sites like Globe TV show
// (e.g. "West Street at Vestry St" is NYC DOT camera C4-WST-03-Med_at_Vestry_St).
// The list is downloaded by scripts/fetch-cameras.js into data/cameras.json:
//   { meta, cameras: [[id, name, lat, lon, area], ...] }
// A camera shows the area around an intersection, not a specific parking spot.

const fs = require('fs');
const path = require('path');
const { distanceMeters } = require('./geo');

const FILE = process.env.CURBPILOT_CAMERAS || path.join(__dirname, '..', 'data', 'cameras.json');
const IMAGE_BASE = 'https://webcams.nyctmc.org/api/cameras';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_METERS = 1500;
// Expressway cameras look at highway lanes, not curbs: prefer a street camera
// unless the highway one is much closer.
const HIGHWAY_PENALTY_METERS = 300;

const ROADS = {
  WST: 'West St',
  FDR: 'FDR Dr',
  HHP: 'Henry Hudson Pkwy',
  HRD: 'Harlem River Dr',
  BQE: 'BQE',
  BKN: 'Brooklyn Bridge',
  GOW: 'Gowanus Expwy',
  PRO: 'Prospect Expwy',
  BLT: 'Belt Pkwy',
  LIE: 'Long Island Expwy',
  GCP: 'Grand Central Pkwy',
  VWE: 'Van Wyck Expwy',
  CIP: 'Cross Island Pkwy',
  JRP: 'Jackie Robinson Pkwy',
  CBE: 'Cross Bronx Expwy',
  MDE: 'Major Deegan Expwy',
  BRP: 'Bronx River Pkwy',
  BRU: 'Bruckner Expwy',
  SIE: 'Staten Island Expwy',
  WSE: 'West Shore Expwy',
};
const DIRECTIONS = { NB: 'northbound', SB: 'southbound', EB: 'eastbound', WB: 'westbound' };

const isHighway = (raw) => /^C\d+-[A-Z0-9]+-/i.test(raw);

// "C2-BQE-28-WB_at_Manhattan_Ave-Ex33" -> "BQE westbound at Manhattan Ave (exit 33)"
// "Central Park West @ 86 St"          -> "Central Park West at 86 St"
function prettyCameraName(raw) {
  const name = String(raw || '').trim();
  const m = name.match(/^C\d+-([A-Z0-9]+)-([^_]*)_at_(.+)$/i);
  if (m) {
    const road = ROADS[m[1].toUpperCase()] || m[1];
    const dir = (m[2].match(/\b(NB|SB|EB|WB)\b/i) || [])[1];
    const at = m[3]
      .replace(/-Ex(\w+)$/i, ' (exit $1)')
      .replace(/_/g, ' ')
      .trim();
    return [road, dir && DIRECTIONS[dir.toUpperCase()], 'at', at].filter(Boolean).join(' ');
  }
  return name.replace(/_/g, ' ').replace(/\s*@\s*/g, ' at ').replace(/\s+/g, ' ');
}

function imageUrl(id) {
  return `${IMAGE_BASE}/${id}/image`;
}

function loadCameras(file = FILE) {
  const empty = { meta: null, list: [], byId: new Map() };
  if (!fs.existsSync(file)) return empty;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = (raw.cameras || [])
    .filter(([id, , lat, lon]) => ID_RE.test(id) && Number.isFinite(lat) && Number.isFinite(lon))
    .map(([id, name, lat, lon, area]) => ({
      id,
      name: prettyCameraName(name),
      lat,
      lon,
      area: area || '',
      highway: isHighway(name),
    }));
  return { meta: raw.meta || null, list, byId: new Map(list.map((c) => [c.id, c])) };
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

// Nearest cameras to a point, best first, as sent to the page.
function nearestCameras(cameras, lat, lon, { limit = 3, maxMeters = MAX_METERS } = {}) {
  return cameras.list
    .map((c) => ({ c, d: distanceMeters([lat, lon], [c.lat, c.lon]) }))
    .filter((x) => x.d <= maxMeters)
    .sort((a, b) => a.d + (a.c.highway ? HIGHWAY_PENALTY_METERS : 0) - (b.d + (b.c.highway ? HIGHWAY_PENALTY_METERS : 0)))
    .slice(0, limit)
    .map(({ c, d }) => ({
      id: c.id,
      name: c.name,
      area: c.area,
      distance: formatDistance(d),
      imageUrl: imageUrl(c.id),
      proxyUrl: `/api/camera/${c.id}/image`,
    }));
}

module.exports = { loadCameras, nearestCameras, prettyCameraName, imageUrl, ID_RE, MAX_METERS };
