const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseSign } = require('../src/rules');
const { buildAnswer } = require('../src/answer');
const { checkCurb, loadData } = require('../src/checker');
const { parseWhen } = require('../src/time');
const { normalizeStreet, prettyStreet } = require('../src/streets');
const { statePlaneToLatLon, latLonToStatePlane } = require('../src/geo');

const demo = loadData(path.join(__dirname, '..', 'data', 'demo.json'));
const WED = '2026-10-07';
const check = (address, when) => checkCurb({ address, when }, demo, { offline: true });

test('the example from the plan: north side OK, south side no standing at 5 PM', async () => {
  const r = await check('120 W 28th St', `${WED}T17:00`);
  assert.equal(r.verdict, 'go');
  assert.match(r.summary, /^Park on the north side of W 28th St\. Commercial vehicle parking is allowed until 7 PM, 3-hour limit/);
  assert.match(r.summary, /Do NOT park on the south side of W 28th St: no standing 4–7 PM except Sunday/);
  assert.equal(r.demo, true);
});

test('same block in the morning: both sides legal', async () => {
  const r = await check('120 W 28th St', `${WED}T10:30`);
  assert.equal(r.verdict, 'go');
  assert.equal(r.doNot.length, 0);
  assert.equal(r.alternatives.length, 1);
});

test('nothing on the block: points to the nearest legal curb', async () => {
  const r = await check('115 W 26th St', `${WED}T12:00`);
  assert.equal(r.verdict, 'nearby');
  assert.match(r.recommendation.label, /north side of W 27th St/);
  assert.equal(r.doNot.length, 2);
});

test('no parking zone: van may stop to deliver only', async () => {
  const r = await check('150 W 29th St', `${WED}T12:00`);
  assert.equal(r.verdict, 'load');
  assert.match(r.summary, /only while actively loading or unloading/);
});

test('warning when nothing legal is nearby, with the earliest legal time', () => {
  const face = (side, sign) => ({
    street: 'W 40 ST', from: '6 AVE', to: '7 AVE', side,
    line: [[40.7535, -73.9845], [40.7547, -73.9874]],
    rules: [parseSign(sign)],
  });
  const faces = [face('N', 'NO STANDING 7AM-7PM EXCEPT SUNDAY'), face('S', 'NO STOPPING 4PM-7PM EXCEPT SUNDAY')];
  const r = buildAnswer({
    place: { lat: 40.7541, lon: -73.986, street: 'W 40 ST' },
    faces,
    when: { day: 3, minute: 17 * 60 },
  });
  assert.equal(r.verdict, 'none');
  assert.match(r.summary, /^WARNING: no legal place to stop/);
  assert.match(r.summary, /Earliest legal option: .* at 7 PM\./);
});

test('unreadable sign makes the driver check it', () => {
  const face = (side, sign) => ({
    street: 'W 40 ST', from: '6 AVE', to: '7 AVE', side,
    line: [[40.7535, -73.9845], [40.7547, -73.9874]],
    rules: [parseSign(sign)],
  });
  const r = buildAnswer({
    place: { lat: 40.7541, lon: -73.986, street: 'W 40 ST' },
    faces: [face('N', 'SPECIAL EVENT REGULATION SEE SUPPLEMENTARY PLATE'), face('S', 'NO PARKING 8AM-6PM MON-FRI')],
    when: { day: 3, minute: 12 * 60 },
  });
  assert.equal(r.verdict, 'load');
  assert.match(r.summary, /Do NOT park on the north side of W 40th St: has a sign CurbPilot can't read/);
});

test('outside the pilot area is said plainly', () => {
  const r = buildAnswer({
    place: { lat: 40.8, lon: -73.95, street: 'W 110 ST' },
    faces: demo.blockfaces,
    when: { day: 3, minute: 600 },
  });
  assert.equal(r.verdict, 'outside');
});

test('arrival time parsing', () => {
  assert.deepEqual(
    { day: parseWhen('2026-10-11T08:45').day, minute: parseWhen('2026-10-11T08:45').minute },
    { day: 0, minute: 525 }
  );
  assert.equal(parseWhen('nonsense'), null);
  const now = parseWhen('now', new Date('2026-10-07T21:30:00Z')); // 5:30 PM EDT
  assert.equal(now.day, 3);
  assert.equal(now.minute, 17 * 60 + 30);
});

test('street names', () => {
  assert.equal(normalizeStreet('WEST 28 STREET'), 'W 28 ST');
  assert.equal(normalizeStreet('W 28th St.'), 'W 28 ST');
  assert.equal(normalizeStreet('Avenue of the Americas'), '6 AVE');
  assert.equal(normalizeStreet('SEVENTH AVENUE'), '7 AVE');
  assert.equal(prettyStreet('W 23 ST'), 'W 23rd St');
});

test('state plane coordinates round-trip (Empire State Building)', () => {
  const [x, y] = latLonToStatePlane(40.748817, -73.985428);
  assert.ok(Math.abs(x - 988200) < 1500 && Math.abs(y - 212000) < 1500, `${x}, ${y}`);
  const [lat, lon] = statePlaneToLatLon(x, y);
  assert.ok(Math.abs(lat - 40.748817) < 1e-7 && Math.abs(lon + 73.985428) < 1e-7);
});
