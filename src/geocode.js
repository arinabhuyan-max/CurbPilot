// Address -> point. Uses NYC Planning Labs GeoSearch (free, no key). If that is
// unreachable, falls back to Manhattan's house-number grid for cross-street
// addresses like "120 W 28th St", which covers most of the pilot area.

const { geosearchUrl } = require('./config');
const { normalizeStreet, prettyStreet } = require('./streets');

// West-side cross streets: house numbers by avenue block.
const WEST_BLOCKS = [
  [1, 99, '5 AVE', '6 AVE'],
  [100, 199, '6 AVE', '7 AVE'],
  [200, 299, '7 AVE', '8 AVE'],
  [300, 399, '8 AVE', '9 AVE'],
  [400, 499, '9 AVE', '10 AVE'],
];

function parseLatLon(text) {
  const m = String(text).trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]), street: '', label: `${m[1]}, ${m[2]}`, source: 'coordinates' };
}

function localGeocode(text, faces) {
  const m = String(text)
    .toUpperCase()
    .match(/^\s*(\d+)\s+((?:W|WEST)\.?\s+\d+(?:ST|ND|RD|TH)?\s+(?:ST|STREET)\.?)/);
  if (!m) return null;
  const num = Number(m[1]);
  const street = normalizeStreet(m[2]);
  const block = WEST_BLOCKS.find(([lo, hi]) => num >= lo && num <= hi);
  if (!block) return null;
  const side = num % 2 === 1 ? 'N' : 'S'; // Manhattan: odd numbers on the north side
  const ends = [block[2], block[3]].sort().join('|');
  const onBlock = faces.filter(
    (f) => normalizeStreet(f.street) === street && [normalizeStreet(f.from), normalizeStreet(f.to)].sort().join('|') === ends
  );
  const face = onBlock.find((f) => f.side === side) || onBlock[0];
  if (!face) return null;
  const [a, b] = face.line;
  const end = b || a;
  return {
    lat: (a[0] + end[0]) / 2,
    lon: (a[1] + end[1]) / 2,
    street,
    label: `${num} ${prettyStreet(street)}, Manhattan`,
    source: 'grid',
  };
}

async function geosearch(text, { timeoutMs = 4000 } = {}) {
  const url = `${geosearchUrl}?text=${encodeURIComponent(text)}&size=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GeoSearch HTTP ${res.status}`);
  const body = await res.json();
  const feat = body.features && body.features[0];
  if (!feat) return null;
  const [lon, lat] = feat.geometry.coordinates;
  const p = feat.properties || {};
  return { lat, lon, street: normalizeStreet(p.street || ''), label: p.label || text, source: 'geosearch' };
}

async function geocode(text, faces, { offline = false } = {}) {
  const direct = parseLatLon(text);
  if (direct) return direct;
  if (!offline) {
    try {
      const hit = await geosearch(text);
      if (hit) return hit;
    } catch (err) {
      // fall through to the local grid
    }
  }
  return localGeocode(text, faces);
}

module.exports = { geocode, localGeocode, parseLatLon };
