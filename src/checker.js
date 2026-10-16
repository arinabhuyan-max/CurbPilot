// The one core job: address + arrival time -> plain-English curb answer.

const config = require('./config');
const { geocode } = require('./geocode');
const { parseWhen } = require('./time');
const { buildAnswer } = require('./answer');
const { loadData, facesNear } = require('./data');
const { loadCameras, nearestCameras } = require('./cameras');
const { summarize } = require('./reports');

let defaultCameras;
const cameraList = () => (defaultCameras ||= loadCameras());

// Adds what drivers reported to each listed curb (as `reports`). A slow or
// broken report store never holds up or breaks the answer itself.
async function attachReports(answer, store, minute) {
  const items = [answer.recommendation, ...(answer.backups || []), ...(answer.doNot || [])].filter(Boolean);
  const ids = [...new Set(items.map((x) => x.id))];
  try {
    const found = await store.recent(ids);
    for (const x of items) x.reports = summarize(found.get(x.id) || [], minute);
  } catch (err) {
    console.error('Driver reports unavailable:', err.message);
  }
}

// opts.reports: the driver report store (reports.js), or nothing to leave reports out.
async function checkCurb({ address, when }, data, opts = {}) {
  if (!address || !String(address).trim()) return { ok: false, error: 'Enter a delivery address.' };
  const time = parseWhen(when, opts.now);
  if (!time) return { ok: false, error: 'Arrival time not understood. Use HH:MM, e.g. 17:30.' };

  const place = await geocode(address, data.blockfaces, { offline: opts.offline });
  if (!place) {
    return { ok: false, error: `Couldn't find "${address}". Try a full street address, e.g. "120 W 28th St, Manhattan".` };
  }

  const answer = buildAnswer({
    place,
    faces: facesNear(data, place.lat, place.lon),
    when: time,
    meta: { demo: data.meta && data.meta.demo, area: config.area.name },
  });
  if (opts.reports && answer.ok) await attachReports(answer, opts.reports, time.minute);
  const cameras = opts.cameras || cameraList();
  return {
    ...answer,
    address: place.label,
    when: time.label,
    demo: Boolean(data.meta && data.meta.demo),
    // Live views of the area around the address (not of a specific spot);
    // null hides the camera panel when no camera list has been downloaded.
    cameras: cameras.list.length ? nearestCameras(cameras, place.lat, place.lon) : null,
  };
}

module.exports = { checkCurb, loadData, cameraList };
