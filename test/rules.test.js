const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSign, isActive, describeRule } = require('../src/rules');

const MON = 1, TUE = 2, FRI = 5, SAT = 6, SUN = 0;
const at = (h, m = 0) => h * 60 + m;

test('no standing with hours and except Sunday', () => {
  const r = parseSign('NO STANDING 4PM-7PM EXCEPT SUNDAY <---->');
  assert.equal(r.kind, 'no_standing');
  assert.deepEqual(r.windows, [{ start: at(16), end: at(19) }]);
  assert.deepEqual(r.days, [1, 2, 3, 4, 5, 6]);
  assert.equal(isActive(r, MON, at(17)), true);
  assert.equal(isActive(r, MON, at(19)), false, 'end time is exclusive');
  assert.equal(isActive(r, SUN, at(17)), false);
  assert.equal(describeRule(r), 'no standing 4–7 PM except Sunday');
});

test('street cleaning with day list and half-hour', () => {
  const r = parseSign('NO PARKING (SANITATION BROOM SYMBOL) 8:30AM-10AM TUES & FRI <->');
  assert.equal(r.kind, 'no_parking');
  assert.equal(r.cleaning, true);
  assert.deepEqual(r.days, [TUE, FRI]);
  assert.equal(isActive(r, TUE, at(8, 30)), true);
  assert.equal(isActive(r, MON, at(9)), false);
  assert.equal(describeRule(r), 'no parking (street cleaning) 8:30–10 AM Tue & Fri');
});

test('commercial metered parking with time limit', () => {
  const r = parseSign('3 HOUR COMMERCIAL VEHICLES ONLY PAY AT MUNI-METER 7AM-7PM EXCEPT SUNDAY');
  assert.equal(r.kind, 'commercial_parking');
  assert.equal(r.limitMinutes, 180);
  assert.equal(r.paid, true);
});

test('truck loading zone and day ranges', () => {
  const r = parseSign('NO STANDING EXCEPT TRUCKS LOADING & UNLOADING 7AM-7PM MON THRU FRI');
  assert.equal(r.kind, 'truck_loading');
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]);
  assert.equal(isActive(r, SAT, at(12)), false);
});

test('multiple windows', () => {
  const r = parseSign('NO STOPPING 7AM-10AM 4PM-7PM EXCEPT SUNDAY');
  assert.equal(r.kind, 'no_stopping');
  assert.equal(r.windows.length, 2);
  assert.equal(isActive(r, MON, at(12)), false);
  assert.equal(isActive(r, MON, at(16, 30)), true);
});

test('overnight window belongs to the day it starts', () => {
  const r = parseSign('NO PARKING 10PM-6AM MON-FRI');
  assert.equal(isActive(r, FRI, at(23)), true);
  assert.equal(isActive(r, SAT, at(3)), true, 'Friday night spills into Saturday morning');
  assert.equal(isActive(r, SAT, at(23)), false);
  assert.equal(isActive(r, MON, at(3)), false, 'Sunday night is not covered');
});

test('midnight and noon', () => {
  const r = parseSign('NO PARKING MIDNIGHT-3AM MON WED FRI');
  assert.deepEqual(r.windows, [{ start: 0, end: 180 }]);
  assert.deepEqual(r.days, [1, 3, 5]);
  const n = parseSign('NO STANDING NOON-MIDNIGHT');
  assert.deepEqual(n.windows, [{ start: 720, end: 1440 }]);
});

test('anytime and bare signs', () => {
  assert.equal(parseSign('NO STANDING ANYTIME').windows, null);
  const bus = parseSign('BUS STOP');
  assert.equal(bus.kind, 'no_standing');
  assert.equal(isActive(bus, SUN, at(3)), true);
});

test('reserved spaces count as no standing for a van', () => {
  assert.equal(parseSign('NO STANDING EXCEPT AUTHORIZED VEHICLES').kind, 'no_standing');
  assert.equal(parseSign('NO STANDING HOTEL LOADING ZONE 7AM-7PM').kind, 'no_standing');
  assert.equal(parseSign('2 HMP PASSENGER VEHICLES ONLY 9AM-7PM EXCEPT SUNDAY').kind, 'passenger_only');
});

test('unreadable signs are flagged, never guessed', () => {
  const r = parseSign('SPECIAL EVENT REGULATION SEE SUPPLEMENTARY PLATE');
  assert.equal(r.kind, 'unknown');
  assert.equal(isActive(r, MON, at(12)), true);
  assert.equal(parseSign('ONE WAY').kind, 'info');
});
