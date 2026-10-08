// Turns NYC parking-sign text into structured rules, describes rules in plain
// English, and decides what a commercial van may do under them at a given time.
//
// A rule looks like:
//   { kind, windows, days, limitMinutes, paid, cleaning, text, source }
// kind     one of KINDS below
// windows  [{ start, end }] in minutes after midnight, or null = all day
// days     array of weekday numbers (0 = Sunday), or null = every day
//
// Correctness matters more than coverage: anything we can't read confidently
// comes back as kind "unknown" so the driver is told to check that sign.

const KINDS = {
  no_stopping: { effect: 'forbid', label: 'no stopping' },
  no_standing: { effect: 'forbid', label: 'no standing' },
  passenger_only: { effect: 'forbid', label: 'passenger cars only (no commercial vans)' },
  no_parking: { effect: 'load', label: 'no parking' },
  truck_loading: { effect: 'load', label: 'truck loading/unloading only' },
  commercial_parking: { effect: 'park', label: 'commercial vehicle parking' },
  limited_parking: { effect: 'park', label: 'metered parking' },
  info: { effect: 'none', label: 'not a parking sign' },
  unknown: { effect: 'unknown', label: 'unreadable sign' },
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_TOKEN =
  '(?:MON(?:DAY)?|TUE(?:S(?:DAY)?)?|WED(?:NESDAY)?|THU(?:R(?:S(?:DAY)?)?)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?)';
const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const TIME_TOKEN = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM|A\\.M\\.|P\\.M\\.)|MIDNIGHT|NOON)';

function normalizeText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ') // "(SANITATION BROOM SYMBOL)", "(SINGLE ARROW)"
    .replace(/<-*>|<-+|-+>/g, ' ') // arrows
    .replace(/\bTHRU\b|\bTHROUGH\b/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function dayIndex(token) {
  return DAY_INDEX[token.slice(0, 3)];
}

function parseTime(token, isEnd) {
  const t = token.replace(/\./g, '').trim();
  if (t === 'MIDNIGHT') return isEnd ? 1440 : 0;
  if (t === 'NOON') return 720;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === 'PM') h += 12;
  const minutes = h * 60 + Number(m[2] || 0);
  return isEnd && minutes === 0 ? 1440 : minutes;
}

function parseWindows(s) {
  if (/\bANYTIME\b|\bALL TIMES\b|\b24 HOURS?\b/.test(s)) return { windows: null, found: true };
  const re = new RegExp(`(${TIME_TOKEN})\\s*(?:-|TO)\\s*(${TIME_TOKEN})`, 'g');
  const windows = [];
  let m;
  while ((m = re.exec(s))) {
    const start = parseTime(m[1], false);
    const end = parseTime(m[2], true);
    if (start == null || end == null || start === end) return { windows: null, found: false, bad: true };
    windows.push({ start, end });
  }
  return { windows: windows.length ? windows : null, found: windows.length > 0 };
}

function expandDayExpr(expr) {
  const re = new RegExp(`${DAY_TOKEN}|-|&|AND|,`, 'g');
  const tokens = expr.match(re) || [];
  const days = new Set();
  let prev = null;
  let pendingRange = false;
  for (const tok of tokens) {
    if (tok === '-') {
      pendingRange = prev != null;
      continue;
    }
    if (tok === '&' || tok === 'AND' || tok === ',') continue;
    const d = dayIndex(tok);
    if (pendingRange) {
      for (let i = prev; i !== d; i = (i + 1) % 7) days.add(i);
      pendingRange = false;
    }
    days.add(d);
    prev = d;
  }
  return [...days].sort();
}

function parseDays(s) {
  if (/\bSCHOOL DAYS\b/.test(s)) return { days: [1, 2, 3, 4, 5], schoolDays: true };
  const exprRe = new RegExp(
    `(EXCEPT\\s+)?(${DAY_TOKEN}(?:\\s*(?:-|&|AND|,|\\s)\\s*${DAY_TOKEN})*)`,
    'g'
  );
  let days = null;
  let m;
  while ((m = exprRe.exec(s))) {
    const listed = expandDayExpr(m[2]);
    const set = m[1] ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !listed.includes(d)) : listed;
    days = days ? [...new Set([...days, ...set])].sort() : set;
  }
  if (/\bINCLUDING SUN(DAY)?\b/.test(s)) days = null;
  if (days && days.length === 7) days = null;
  return { days };
}

function parseLimit(s) {
  let m = s.match(/\b1\/2\s*(?:HOUR|HR)\b/);
  if (m) return 30;
  m = s.match(/\b(\d{1,2})\s*(?:HOURS?|HRS?|HMP)\b/);
  if (m) return Number(m[1]) * 60;
  m = s.match(/\b(ONE|TWO|THREE|FOUR)\s*HOURS?\b/);
  if (m) return { ONE: 1, TWO: 2, THREE: 3, FOUR: 4 }[m[1]] * 60;
  m = s.match(/\b(\d{1,3})\s*(?:MINUTES?|MIN)\b/);
  if (m) return Number(m[1]);
  return null;
}

const RESERVED =
  /AUTHORIZED VEHICLES|AMBULETTE|AMBULANCE|POLICE|NYPD|FDNY|FIRE DEPT|DIPLOMAT|TAXI|HOTEL LOADING|PERMIT|CONSUL|DOT VEHICLES|ELECTRIC VEHICLE|EV CHARGING|BIKE|BICYCLE|CAR SHARE|CARSHARE/;
const NON_PARKING =
  /^(ONE WAY|DO NOT ENTER|STOP|YIELD|CURB LINE|BUILDING LINE|PROPERTY LINE|SPEED|ROUTE|TRUCK ROUTE|NO RIGHT TURN|NO LEFT TURN|NO TURN|NO U TURN|KEEP RIGHT|PEDESTRIAN|SCHOOL|STREET NAME)\b|\bSUPERSEDED\b|\bREMOVED\b/;

function classify(s) {
  if (/\bNO STOPPING\b/.test(s)) return 'no_stopping';
  if (/\bNO STANDING\b/.test(s)) {
    if (/EXCEPT\s+TRUCKS?\s+(?:LOADING|UNLOADING)/.test(s)) return 'truck_loading';
    if (/EXCEPT\s+COMMERCIAL VEH/.test(s)) return 'commercial_parking';
    return 'no_standing';
  }
  if (/\bBUS STOP\b|\bBUS LANE\b|\bFIRE ZONE\b/.test(s)) return 'no_standing';
  if (/\bPASSENGER VEH/.test(s)) return 'passenger_only';
  if (/\bCOMMERCIAL VEH|\bCOMMERCIAL METER|\bCOMMERCIAL PARKING\b/.test(s)) return 'commercial_parking';
  if (/\bNO PARKING\b/.test(s)) {
    if (/EXCEPT\s+TRUCKS?\s+(?:LOADING|UNLOADING)/.test(s)) return 'truck_loading';
    return 'no_parking';
  }
  if (RESERVED.test(s)) return 'no_standing';
  if (/\bHOURS? PARKING\b|\bHMP\b|\bMETER|\bPAY\b|\bHOUR LIMIT\b|\bPARKING \d/.test(s)) return 'limited_parking';
  if (NON_PARKING.test(s)) return 'info';
  return 'unknown';
}

function parseSign(text) {
  const s = normalizeText(text);
  const kind = classify(s);
  const rule = { kind, windows: null, days: null, limitMinutes: null, paid: false, text: String(text || '').trim(), source: 'parser' };
  if (kind === 'info' || kind === 'unknown') return rule;

  const w = parseWindows(s);
  if (w.bad) return { ...rule, kind: 'unknown' };
  rule.windows = w.windows;
  const d = parseDays(s);
  rule.days = d.days;
  if (d.schoolDays) rule.schoolDays = true;
  rule.limitMinutes = parseLimit(s);
  rule.paid = /\bMETER|\bHMP\b|\bPAY\b/.test(s);
  if (/SANITATION|BROOM|STREET CLEANING/.test(String(text).toUpperCase())) rule.cleaning = true;

  return rule;
}

// ---------- time & activity ----------

function isActive(rule, day, minute) {
  if (rule.kind === 'info') return false;
  if (rule.kind === 'unknown') return true; // we can't rule it out, so it always counts
  const dayOk = (d) => !rule.days || rule.days.includes(d);
  if (!rule.windows) return dayOk(day);
  return rule.windows.some(({ start, end }) => {
    if (start < end) return dayOk(day) && minute >= start && minute < end;
    // overnight window, e.g. 10PM-6AM: belongs to the day it starts on
    return (dayOk(day) && minute >= start) || (dayOk((day + 6) % 7) && minute < end);
  });
}

// ---------- plain English ----------

function formatClock(minutes, { compact = false } = {}) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h = h24 % 12 || 12;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const base = mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}`;
  return compact ? base : `${base} ${suffix}`;
}

function formatWindow({ start, end }) {
  // "4–7 PM" when both ends share AM/PM, otherwise "7 AM–7 PM"
  const half = (m) => (m < 720 ? 'AM' : 'PM');
  const compact = start < end && ![0, 720].includes(start) && ![720, 1440].includes(end) && half(start) === half(end);
  if (compact) return `${formatClock(start, { compact: true })}–${formatClock(end)}`;
  return `${formatClock(start)}–${formatClock(end)}`;
}

function formatDays(days) {
  if (!days) return '';
  if (days.length === 6) return `except ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][[0, 1, 2, 3, 4, 5, 6].find((d) => !days.includes(d))]}`;
  const sorted = [...days].sort();
  const consecutive = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive) return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`;
  const names = sorted.map((d) => DAY_NAMES[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function describeRule(rule) {
  if (rule.kind === 'unknown') return `a sign CurbPilot can't read ("${rule.text}")`;
  let label = KINDS[rule.kind].label;
  if (rule.kind === 'no_parking' && rule.cleaning) label = 'no parking (street cleaning)';
  if (rule.kind === 'commercial_parking' && rule.paid) label = 'commercial metered parking';
  const when = rule.windows ? rule.windows.map(formatWindow).join(' & ') : rule.days ? 'all day' : 'anytime';
  const days = formatDays(rule.days);
  return [label, when, days].filter(Boolean).join(' ');
}

module.exports = {
  KINDS,
  parseSign,
  isActive,
  describeRule,
  formatClock,
  formatDays,
  normalizeText,
};
