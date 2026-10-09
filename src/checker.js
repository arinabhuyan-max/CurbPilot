// The one core job: address + arrival time -> plain-English curb answer.

const config = require('./config');
const { geocode } = require('./geocode');
const { parseWhen } = require('./time');
const { buildAnswer } = require('./answer');
const { loadData, facesNear } = require('./data');
const { loadCameras, nearestCameras } = require('./cameras');

let defaultCameras;
const cameraList = () => (defaultCameras ||= loadCameras());

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
