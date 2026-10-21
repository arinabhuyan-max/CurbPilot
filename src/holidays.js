// NYC parking holidays. On every day in the city's Alternate Side Parking
// suspension calendar, street cleaning rules are lifted. On the six major legal
// holidays, parking meters and every stopping/standing/parking rule are lifted
// too, except rules in effect 7 days a week (e.g. "No Standing Anytime").
//
// Errors must only ever make answers stricter: a missing date means a rule is
// assumed in effect (worst case the driver skips a free spot), never the other
// way round (a ticket). So dates the sources disagree on are left out, and a
// holiday observed on another weekday counts only as a street-cleaning holiday.
//
// Source: NYC DOT "Alternate Side Parking Rules 2026 Suspension Calendar"
// (nyc.gov/html/dot/downloads/pdf/asp-calendar-2026.pdf). Add each new year
// when DOT publishes it; until then only the major legal holidays apply.

const ASP_CALENDAR = {
  2026: {
    '01-01': "New Year's Day",
    '01-06': "Three Kings' Day",
    '01-19': 'Martin Luther King Jr. Day',
    '02-12': "Lincoln's Birthday",
    '02-16': "Washington's Birthday / Lunar New Year's Eve",
    '02-17': 'Lunar New Year',
    '02-18': 'Ash Wednesday / Losar',
    '03-03': 'Purim',
    '03-20': 'Eid al-Fitr',
    '03-21': 'Eid al-Fitr',
    '04-02': 'Holy Thursday / Passover',
    '04-03': 'Good Friday / Passover',
    '04-08': 'Passover (7th day)',
    '04-09': 'Passover (8th day) / Holy Thursday (Orthodox)',
    '04-10': 'Good Friday (Orthodox)',
    '05-14': 'Solemnity of the Ascension',
    '05-22': 'Shavuot',
    '05-23': 'Shavuot',
    '05-25': 'Memorial Day',
    '05-27': 'Eid al-Adha',
    '05-28': 'Eid al-Adha',
    '06-19': 'Juneteenth',
    '07-03': 'Independence Day (observed)',
    '07-04': 'Independence Day',
    '07-23': "Tisha B'Av",
    '08-15': 'Feast of the Assumption',
    '09-07': 'Labor Day',
    '09-12': 'Rosh Hashanah',
    '09-13': 'Rosh Hashanah',
    '09-21': 'Yom Kippur',
    '09-26': 'Sukkot',
    '09-27': 'Sukkot',
    '10-03': 'Shemini Atzeret',
    '10-04': 'Simchat Torah',
    '10-12': "Columbus Day / Indigenous Peoples' Day",
    '11-01': "All Saints' Day",
    '11-03': 'Election Day',
    '11-08': 'Diwali',
    '11-11': 'Veterans Day',
    '11-26': 'Thanksgiving Day',
    '12-08': 'Feast of the Immaculate Conception',
    '12-25': 'Christmas Day',
  },
};

const pad = (n) => String(n).padStart(2, '0');

// The n-th given weekday of a month (n = -1: the last one), as "MM-DD".
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return `${pad(month)}-${pad(1 + ((weekday - first + 7) % 7) + (n - 1) * 7)}`;
  }
  const lastDate = new Date(Date.UTC(year, month, 0));
  const back = (lastDate.getUTCDay() - weekday + 7) % 7;
  return `${pad(month)}-${pad(lastDate.getUTCDate() - back)}`;
}

function majorHolidays(year) {
  return {
    '01-01': "New Year's Day",
    [nthWeekday(year, 5, 1, -1)]: 'Memorial Day',
    '07-04': 'Independence Day',
    [nthWeekday(year, 9, 1, 1)]: 'Labor Day',
    [nthWeekday(year, 11, 4, 4)]: 'Thanksgiving Day',
    '12-25': 'Christmas Day',
  };
}

// "YYYY-MM-DD" -> { name, major } or null on a normal day.
function holidayOn(date) {
  const m = /^(\d{4})-(\d{2}-\d{2})$/.exec(date || '');
  if (!m) return null;
  const year = Number(m[1]);
  const major = majorHolidays(year)[m[2]];
  if (major) return { name: major, major: true };
  const asp = (ASP_CALENDAR[year] || {})[m[2]];
  return asp ? { name: asp, major: false } : null;
}

// Whether the street cleaning holiday list for this date's year is loaded.
function calendarCovers(date) {
  return Boolean(ASP_CALENDAR[String(date || '').slice(0, 4)]);
}

function addDays(date, n) {
  const [y, mo, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

module.exports = { holidayOn, calendarCovers, addDays };
