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

test('separate hours per day group', () => {
  const r = parseSign('6 HMP MONDAY-FRIDAY 6PM-MIDNIGHT SATURDAY 8AM-MIDNIGHT <-> (SUPERSEDES  PS-198C)');
  assert.equal(r.kind, 'limited_parking');
  assert.equal(r.limitMinutes, 360);
  assert.equal(isActive(r, MON, at(12)), false, 'weekday noon is not covered');
  assert.equal(isActive(r, MON, at(19)), true);
  assert.equal(isActive(r, SAT, at(12)), true);
  assert.equal(isActive(r, SUN, at(12)), false);
  assert.equal(describeRule(r), 'metered parking 6 PM–midnight Mon–Fri, 8 AM–midnight Sat');
  const t = parseSign('TRUCK (SYMBOL) TRUCK LOADING ONLY MONDAY-FRIDAY 5AM-8AM 6PM-10PM SATURDAY 5AM-10PM -->');
  assert.equal(t.kind, 'truck_loading');
  assert.equal(isActive(t, TUE, at(7)), true);
  assert.equal(isActive(t, TUE, at(12)), false);
  assert.equal(isActive(t, SAT, at(12)), true);
});

test('real city sign wording', () => {
  assert.equal(parseSign('PAY-BY-CELL LOCATOR NUMBER').kind, 'info', 'payment plate is not a parking rule');
  assert.equal(parseSign('LOCAL MTA BUS ROUTE PANEL (TEXT TO BE MODIFIED AS REQUESTED)').kind, 'info');
  assert.equal(parseSign('Q4/ Q4 LTD (COMBINATION ROUTE PANEL)').kind, 'info');
  assert.equal(parseSign('METERS ARE NOT IN EFFECT ABOVE TIMES (TO BE USED ONLY FOR CONFLICTING STREET CLEANING AND METERED PARKING REGULATIONS)').kind, 'info');
  assert.equal(parseSign('TRUCK (SYMBOL) TRUCK LOADING ONLY 7AM-7PM EXCEPT SUNDAY --> (SUPERSEDES SP-30BA & SP-215BA)').kind, 'truck_loading');
  assert.equal(parseSign('NLZ (SYMBOL) LOADING ONLY MONDAY-FRIDAY 7AM-7PM -->').kind, 'truck_loading');
  assert.equal(parseSign('STAR (SYMBOL) AVO FIRE DEPARTMENT --> (SUPERSEDES PS-22EA)').kind, 'no_standing');
  assert.equal(parseSign('FHV (SYMBOL) FOR-HIRE VEHICLES ONLY 6PM-3AM ALL DAYS -->').kind, 'no_standing');
  assert.equal(parseSign('BUS (SYMBOL) MTA BUS LAYOVER ONLY MONDAY-FRIDAY 3:30PM-7PM --> NO ENGINE IDLING MAX FINE $2000').kind, 'no_standing');
  assert.equal(parseSign('HARD HAT (SYMBOL) TEMPORARY CONSTRUCTION REGULATION (RIDER)').kind, 'unknown');
  const sc = parseSign('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11AM-12:30PM <-> (SUPERSEDES SP-360C)');
  assert.deepEqual(sc.days, [TUE, FRI]);
  assert.deepEqual(sc.windows, [{ start: at(11), end: at(12, 30) }]);
});

test('outer-borough sign wording', () => {
  assert.equal(parseSign('SHARED E-SCOOTER PARKING  SIGN').kind, 'info');
  assert.equal(parseSign('BACK IN ANGLE PARKING ONLY <-> (SUPERSEDES SP-7D)').kind, 'info');
  assert.equal(parseSign('DAY - DAY XYY-XYY (FOR BUS STOP ONLY)').kind, 'info');
  assert.equal(parseSign('3 HOUR COMMERCIAL VEHICLES ONLY PAY AT MUNI-METER 7AM-7PM EXCEPT SUNDAY').kind, 'commercial_parking', 'meter signs are not payment plates');
  const fifteen = parseSign('15 MINUTE PARKING --> (THIS SMO REQUIRES D/C APPROVAL)');
  assert.equal(fifteen.kind, 'limited_parking');
  assert.equal(fifteen.limitMinutes, 15);
  assert.equal(describeRule(fifteen), 'time-limited parking anytime');
  assert.equal(parseSign('1HP 8AM-4PM ALL DAYS -->').limitMinutes, 60);
  assert.equal(parseSign('STAR (SYMBOL) NYS ROAD TEST ONLY MONDAY-FRIDAY 8AM-5PM <->').kind, 'no_standing');
  assert.equal(parseSign('TRUCK OR TRAILER PARKING PROHIBITED 9PM-5AM').kind, 'no_parking');
  assert.equal(parseSign('1 HMP COMMERCIAL VEHICLES  ONLY 8:30-10PM EXCEPT SUNDAY -->').kind, 'unknown', 'half-written time is not "anytime"');
  assert.equal(parseSign('DESCRIPTION NOT AVAILABLE').kind, 'unknown');
});
