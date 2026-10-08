// The one core job: address + arrival time -> plain-English curb answer.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { geocode } = require('./geocode');
const { parseWhen } = require('./time');
const { buildAnswer } = require('./answer');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Real city data (data/pilot.json) wins; otherwise the bundled demo set.
function loadData(file) {
  const candidates = file ? [file] : [path.join(DATA_DIR, 'pilot.json'), path.join(DATA_DIR, 'demo.json')];
  for (const f of candidates) {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  throw new Error('No curb data found. Run `npm run demo-data` or `npm run fetch-data && npm run build-data`.');
}

async function checkCurb({ address, when }, data, opts = {}) {
  if (!address || !String(address).trim()) return { ok: false, error: 'Enter a delivery address.' };
  const time = parseWhen(when, opts.now);
  if (!time) return { ok: false, error: 'Arrival time not understood. Use HH:MM, e.g. 17:30.' };

  const place = await geocode(address, data.blockfaces, { offline: opts.offline });
  if (!place) {
    return { ok: false, error: `Couldn't find "${address}". Try a street address like "120 W 28th St".` };
  }

  const answer = buildAnswer({
    place,
    faces: data.blockfaces,
    when: time,
    meta: { demo: data.meta && data.meta.demo, area: config.area.name },
  });
  return { ...answer, address: place.label, when: time.label, demo: Boolean(data.meta && data.meta.demo) };
}

module.exports = { checkCurb, loadData };
