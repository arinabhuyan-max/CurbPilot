// What a commercial van may do on one block face (one side of one block) at a
// given time, and how long that answer stays true.

const { KINDS, isActive, describeRule } = require('./rules');

// Higher is better for the driver.
const RANK = { park: 5, free: 4, load: 3, mixed: 2, check: 1, no: 0 };

// NYC: in a "No Standing Except Trucks Loading/Unloading" zone, commercial
// vehicles get 3 hours unless the sign posts a different limit.
const TRUCK_LOADING_DEFAULT_LIMIT = 180;

function statusAt(face, day, minute) {
  const active = face.rules.filter((r) => r.kind !== 'info' && isActive(r, day, minute));
  const by = (effect) => active.filter((r) => KINDS[r.kind].effect === effect);
  const forbid = by('forbid');
  const load = by('load');
  const park = by('park');
  const unknown = by('unknown');

  let category;
  if (unknown.length) category = 'check';
  else if (forbid.length && (load.length || park.length)) category = 'mixed';
  else if (forbid.length) category = 'no';
  else if (load.length) category = 'load'; // stacked loading + meter: the stricter rule wins
  else if (park.length) category = 'park';
  else category = 'free';

  return { category, forbid, load, park, unknown };
}

function signature(status) {
  // Two statuses are "the same answer" if the same rules are in force.
  const ids = (list) => list.map(describeRule).sort().join('|');
  return [status.category, ids(status.forbid), ids(status.load), ids(status.park)].join('#');
}

// Scan forward minute by minute (max 24h) to find when the answer changes.
function nextChange(face, day, minute) {
  const start = signature(statusAt(face, day, minute));
  for (let ahead = 1; ahead <= 1440; ahead++) {
    const total = minute + ahead;
    const d = (day + Math.floor(total / 1440)) % 7;
    const m = total % 1440;
    if (signature(statusAt(face, d, m)) !== start) return { ahead, day: d, minute: m };
  }
  return null;
}

// Earliest time in the next 24h when this face allows parking or loading.
function nextLegal(face, day, minute) {
  for (let ahead = 1; ahead <= 1440; ahead++) {
    const total = minute + ahead;
    const d = (day + Math.floor(total / 1440)) % 7;
    const m = total % 1440;
    const cat = statusAt(face, d, m).category;
    if (cat === 'park' || cat === 'free' || cat === 'load') return { ahead, day: d, minute: m, category: cat };
  }
  return null;
}

function timeLimit(status) {
  if (status.category === 'park') {
    const limits = status.park.map((r) => r.limitMinutes).filter(Boolean);
    return limits.length ? Math.min(...limits) : null;
  }
  if (status.category === 'load') {
    const trucks = status.load.filter((r) => r.kind === 'truck_loading');
    if (trucks.length && trucks.length === status.load.length) {
      const posted = trucks.map((r) => r.limitMinutes).filter(Boolean);
      return posted.length ? Math.min(...posted) : TRUCK_LOADING_DEFAULT_LIMIT;
    }
  }
  return null;
}

module.exports = { statusAt, nextChange, nextLegal, timeLimit, RANK };
