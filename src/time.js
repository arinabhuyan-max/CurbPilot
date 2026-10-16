// Arrival time handling. Everything is NYC wall-clock time: the sign says
// "4PM-7PM", so we need the local weekday and minute of day, plus the date
// for holidays.

const { timezone } = require('./config');
const { formatClock } = require('./rules');
const { holidayOn } = require('./holidays');

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nycNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

// Accepts "" / "now", "HH:MM" (today in NYC), or "YYYY-MM-DDTHH:MM" (NYC wall time).
function parseWhen(input, now = new Date()) {
  const s = String(input || '').trim();
  let when;
  if (!s || s.toLowerCase() === 'now') {
    when = { ...nycNow(now), isNow: true };
  } else {
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/);
    if (m) {
      const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
      when = { day, minute: Number(m[4]) * 60 + Number(m[5]), date: `${m[1]}-${m[2]}-${m[3]}` };
    } else if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) {
      const today = nycNow(now);
      when = { day: today.day, minute: Number(m[1]) * 60 + Number(m[2]), date: today.date };
    } else {
      return null;
    }
    if (when.minute < 0 || when.minute >= 1440 || Number.isNaN(when.day)) return null;
  }
  when.holiday = holidayOn(when.date);
  when.label = `${when.isNow ? 'Now, ' : ''}${DAY_LONG[when.day]} ${formatClock(when.minute)}${when.holiday ? ` (${when.holiday.name})` : ''}`;
  return when;
}

module.exports = { parseWhen, nycNow };
