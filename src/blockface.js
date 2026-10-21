// What a commercial van may do on one block face (one side of one block) at a
// given time, and how long that answer stays true.

const { KINDS, isActive, describeRule } = require('./rules');
const { holidayOn, addDays } = require('./holidays');

// Higher is better for the driver.
const RANK = { park: 5, free: 4, load: 3, mixed: 2, check: 1, no: 0 };

// NYC: in a "No Standing Except Trucks Loading/Unloading" zone, commercial
// vehicles get 3 hours unless the sign posts a different limit.
const TRUCK_LOADING_DEFAULT_LIMIT = 180;

const isCleaning = (r) => r.cleaning || /SANITATION|BROOM|STREET CLEANING/i.test(r.text || '');

function everyDay(rule) {
  if (!rule.schedule) return !rule.days;
  const days = new Set();
  for (const seg of rule.schedule) (seg.days || [0, 1, 2, 3, 4, 5, 6]).forEach((d) => days.add(d));
  return days.size === 7;
}

// Is this rule lifted on this holiday? Street cleaning: on every listed holiday.
// Major legal holidays: every rule not in effect 7 days a week. An unreadable
// sign is never lifted.
function suspendedBy(rule, holiday) {
  if (!holiday || rule.kind === 'unknown') return false;
  return isCleaning(rule) || (holiday.major && !everyDay(rule));
}

// holiday: { name, major } from holidays.js, or null on a normal day.
function statusAt(face, day, minute, holiday = null) {
  const inForce = face.rules.filter((r) => r.kind !== 'info' && isActive(r, day, minute));
  const suspended = inForce.filter((r) => suspendedBy(r, holiday));
  // Meters are free on major legal holidays, even under 7-day signs.
  const active = inForce
    .filter((r) => !suspended.includes(r))
    .map((r) => (holiday && holiday.major && r.paid ? { ...r, paid: false } : r));
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

  return { category, forbid, load, park, unknown, suspended };
}

// The holiday of the day `ahead` minutes after `minute` on `date` (cached per day).
function holidayAhead(date) {
  const cache = new Map();
  return (minute, ahead) => {
    if (!date) return null;
    const offset = Math.floor((minute + ahead) / 1440);
    if (!cache.has(offset)) cache.set(offset, holidayOn(addDays(date, offset)));
    return cache.get(offset);
  };
}

function signature(status) {
  // Two statuses are "the same answer" if the same rules are in force.
  const ids = (list) => list.map(describeRule).sort().join('|');
  return [status.category, ids(status.forbid), ids(status.load), ids(status.park)].join('#');
}

// Scan forward minute by minute (max 24h) to find when the answer changes.
// date ("YYYY-MM-DD", optional) applies holidays, also on the next day.
function nextChange(face, day, minute, date = null) {
  const holiday = holidayAhead(date);
  const start = signature(statusAt(face, day, minute, holiday(minute, 0)));
  for (let ahead = 1; ahead <= 1440; ahead++) {
    const total = minute + ahead;
    const d = (day + Math.floor(total / 1440)) % 7;
    const m = total % 1440;
    if (signature(statusAt(face, d, m, holiday(minute, ahead))) !== start) return { ahead, day: d, minute: m };
  }
  return null;
}

// Earliest time in the next 24h when this face allows parking or loading.
function nextLegal(face, day, minute, date = null) {
  const holiday = holidayAhead(date);
  for (let ahead = 1; ahead <= 1440; ahead++) {
    const total = minute + ahead;
    const d = (day + Math.floor(total / 1440)) % 7;
    const m = total % 1440;
    const cat = statusAt(face, d, m, holiday(minute, ahead)).category;
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
