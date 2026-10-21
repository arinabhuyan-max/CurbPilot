const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadData } = require('../src/checker');
const { localGeocode } = require('../src/geocode');
const { readTicket, parseTicketTime, parseTicketDate, audit, summarize, report, addressOf } = require('../scripts/ticket-audit');

const demo = loadData(path.join(__dirname, '..', 'data', 'demo.json'));
const row = (o) => ({
  plate_type: 'COM', violation_code: '14', issue_date: '2026-10-07T00:00:00.000', violation_time: '0500P',
  house_number: '120', street_name: 'W 28th St', violation_county: 'NY', violation_in_front_of_or_opposite: 'F', ...o,
});

test('ticket times and dates in the city formats', () => {
  assert.equal(parseTicketTime('0523P'), 17 * 60 + 23);
  assert.equal(parseTicketTime('1210A'), 10, '12:10 AM');
  assert.equal(parseTicketTime('1200P'), 720);
  assert.equal(parseTicketTime('1730'), 17 * 60 + 30);
  assert.equal(parseTicketTime('9999P'), null);
  assert.equal(parseTicketDate('03/14/2026'), '2026-03-14');
  assert.equal(parseTicketDate('2026-03-14T00:00:00.000'), '2026-03-14');
});

test('only the violation codes the sign data can explain', () => {
  assert.equal(readTicket(row({ violation_code: '40' })), null, 'hydrants are not in the sign data');
  assert.equal(readTicket(row({ house_number: '' })), null);
  const t = readTicket(row());
  assert.equal(t.day, 3);
  assert.equal(t.minute, 17 * 60);
  assert.equal(addressOf(t), '120 W 28th St, Manhattan');
});

test('each ticket is checked against what CurbPilot would have said', () => {
  const tickets = [
    row(), // south side, no standing 4–7 PM: CurbPilot warned
    row({ house_number: '121' }), // north side, commercial parking: CurbPilot said OK -> missed
    row({ house_number: '121', violation_in_front_of_or_opposite: 'O' }), // opposite of 121 = south side: warned
    row({ house_number: '121', issue_date: '2026-11-26T00:00:00.000' }), // Thanksgiving
    row({ street_name: 'Nowhere Ave' }),
  ].map(readTicket);
  const places = new Map(tickets.map((t) => [addressOf(t), localGeocode(`${t.house} ${t.street}`, demo.blockfaces)]));
  const { results, unplaced } = audit(demo, tickets, places);
  assert.equal(unplaced, 1);
  assert.deepEqual(results.map((r) => r.outcome), ['warned', 'missed', 'warned', 'missed']);
  assert.equal(results[1].face.side, 'N');
  assert.equal(results[3].holiday.name, 'Thanksgiving Day');

  const s = summarize(results);
  assert.equal(s.missed, 2);
  assert.equal(s.worst[0].tickets.length, 2, 'misses grouped by curb');
  const md = report(s, { builtAt: '2026-10-16', fetched: 5, dateRange: 'x', unplaced });
  assert.match(md, /would have warned the driver, or limited them to loading, for 50\.0% of these tickets/);
  assert.match(md, /the north side of W 28th St .* \| 2 \| No standing \(sign\), Wed 2026-10-07 5 PM at 121 W 28th St, Manhattan/);
});

test('a no standing ticket in a truck loading zone counts as "stop only while loading"', () => {
  const { judge } = require('../scripts/ticket-audit');
  const { parseSign } = require('../src/rules');
  const face = { street: 'E 95 ST', from: '2 AVE', to: '3 AVE', side: 'S', line: [[40.78, -73.95]], rules: [parseSign('NO STANDING EXCEPT TRUCKS LOADING & UNLOADING 8AM-6PM MON-FRI')] };
  assert.equal(judge(face, readTicket(row({ violation_time: '0351P' }))).outcome, 'load');
});
