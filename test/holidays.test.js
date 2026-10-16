const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSign } = require('../src/rules');
const { holidayOn, calendarCovers, addDays } = require('../src/holidays');
const { statusAt, nextChange } = require('../src/blockface');
const { buildAnswer } = require('../src/answer');
const { parseWhen } = require('../src/time');

const THU = 4;
const at = (h, m = 0) => h * 60 + m;
const face = (...signs) => ({ street: 'W 40 ST', from: '6 AVE', to: '7 AVE', side: 'N', line: [[40.7535, -73.9845], [40.7547, -73.9874]], rules: signs.map(parseSign) });
const THANKSGIVING = { name: 'Thanksgiving Day', major: true };
const DIWALI = { name: 'Diwali', major: false };

test('major legal holidays are computed for any year; the rest come from the DOT calendar', () => {
  assert.deepEqual(holidayOn('2026-11-26'), THANKSGIVING);
  assert.deepEqual(holidayOn('2027-11-25'), THANKSGIVING, 'fourth Thursday of November');
  assert.deepEqual(holidayOn('2027-05-31'), { name: 'Memorial Day', major: true }, 'last Monday of May');
  assert.deepEqual(holidayOn('2027-09-06'), { name: 'Labor Day', major: true }, 'first Monday of September');
  assert.deepEqual(holidayOn('2026-11-08'), { name: 'Diwali', major: false });
  assert.deepEqual(holidayOn('2026-07-03'), { name: 'Independence Day (observed)', major: false }, 'observed day lifts street cleaning only');
  assert.equal(holidayOn('2026-11-19'), null);
  assert.equal(holidayOn('2027-11-08'), null, 'no 2027 street cleaning calendar yet');
  assert.equal(calendarCovers('2026-01-01'), true);
  assert.equal(calendarCovers('2027-01-01'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('arrival times carry their date and holiday', () => {
  const w = parseWhen('2026-11-26T17:00');
  assert.equal(w.date, '2026-11-26');
  assert.deepEqual(w.holiday, THANKSGIVING);
  assert.match(w.label, /Thursday 5 PM \(Thanksgiving Day\)/);
  const now = parseWhen('now', new Date('2026-11-26T15:00:00Z'));
  assert.equal(now.date, '2026-11-26', 'NYC date, not UTC');
  assert.equal(parseWhen('09:00', new Date('2026-11-27T03:00:00Z')).date, '2026-11-26', '10 PM in NYC is still the 26th');
});

test('street cleaning holiday lifts only street cleaning', () => {
  const f = face('NO PARKING (SANITATION BROOM SYMBOL) 8AM-9:30AM MON & THURS', 'NO STANDING 8AM-6PM MON-FRI');
  assert.equal(statusAt(f, THU, at(8, 30)).category, 'mixed');
  const s = statusAt(f, THU, at(8, 30), DIWALI);
  assert.equal(s.category, 'no', 'no standing still applies, the street cleaning stretch is lifted');
  assert.equal(s.suspended.length, 1);
  const cleaningOnly = face('NO PARKING (SANITATION BROOM SYMBOL) 8AM-9:30AM MON & THURS');
  assert.equal(statusAt(cleaningOnly, THU, at(8, 30)).category, 'load');
  assert.equal(statusAt(cleaningOnly, THU, at(8, 30), DIWALI).category, 'free');
});

test('major legal holiday lifts meters and rules not in effect 7 days a week', () => {
  const weekdays = face('NO STANDING 4PM-7PM EXCEPT SUNDAY');
  assert.equal(statusAt(weekdays, THU, at(17), THANKSGIVING).category, 'free');
  const daily = face('NO STANDING ANYTIME');
  assert.equal(statusAt(daily, THU, at(17), THANKSGIVING).category, 'no', '"anytime" signs stay');
  const dailyHours = face('NO STOPPING 7AM-7PM');
  assert.equal(statusAt(dailyHours, THU, at(17), THANKSGIVING).category, 'no', 'every-day hours stay');
  const meter = face('2 HOUR METERED PARKING 9AM-7PM');
  const s = statusAt(meter, THU, at(17), THANKSGIVING);
  assert.equal(s.category, 'park');
  assert.equal(s.park[0].paid, false, 'meters are free');
  const unreadable = face('SOME SIGN NOBODY CAN READ');
  assert.equal(statusAt(unreadable, THU, at(17), THANKSGIVING).category, 'check', 'never lift an unreadable sign');
});

test('next change counts a holiday that starts at midnight', () => {
  const f = face('NO STANDING 7AM-7PM EXCEPT SUNDAY');
  // Wednesday 11 PM before Thanksgiving: without the date, no standing starts at 7 AM.
  assert.equal(nextChange(f, 3, at(23)).minute, at(7));
  assert.equal(nextChange(f, 3, at(23), '2026-11-25'), null, 'Thanksgiving: nothing changes in the next 24h');
});

test('answers name the holiday and what it lifted', () => {
  const faces = [face('NO STANDING 4PM-7PM EXCEPT SUNDAY')];
  const place = { lat: 40.7541, lon: -73.986, street: 'W 40 ST' };
  const r = buildAnswer({ place, faces, when: parseWhen('2026-11-26T17:00') });
  assert.equal(r.verdict, 'go');
  assert.match(r.summary, /suspended for Thanksgiving Day/);
  assert.ok(r.caveats.some((c) => /major legal holiday/.test(c)));
  const normal = buildAnswer({ place, faces, when: parseWhen('2026-11-19T17:00') });
  assert.equal(normal.verdict, 'none');
  assert.ok(normal.caveats.some((c) => /Not a city parking holiday/.test(c)));
  const eve = buildAnswer({ place, faces, when: parseWhen('2026-11-25T20:00') });
  assert.ok(eve.caveats.some((c) => /Tomorrow is Thanksgiving Day/.test(c)));
});
