const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { summarize, createStore, memoryStore } = require('../src/reports');
const { checkCurb, loadData } = require('../src/checker');

const DAY = 864e5;
const NOW = Date.parse('2026-10-16T21:00:00Z');
const r = (k, daysAgo, m = 17 * 60) => ({ k, t: NOW - daysAgo * DAY, d: 3, m });

test('no reports, no notes', () => {
  assert.deepEqual(summarize([], 1020, NOW), { confirmed: 0, wrong: 0, full: 0, notes: [] });
});

test('confirmations, mismatches and "full around this time"', () => {
  const s = summarize([r('ok', 2), r('ok', 10), r('wrong', 5), r('full', 3, 17 * 60 + 30), r('full', 3, 9 * 60), r('ok', 200)], 17 * 60, NOW);
  assert.equal(s.confirmed, 2, 'reports older than 90 days are dropped');
  assert.equal(s.wrong, 1);
  assert.equal(s.full, 1, 'only "full" reports within an hour of the arrival time count');
  assert.match(s.notes[0].text, /^A driver reported the signs here don't match \(last 5 days ago\), but a driver parked fine here since\./);
  assert.equal(s.notes[0].tone, 'warn');
  assert.match(s.notes[1].text, /Confirmed by drivers twice in the last 90 days \(last 2 days ago\)/);
  assert.match(s.notes[2].text, /Reported full around this time once recently/);
});

test('"full" around midnight wraps', () => {
  assert.equal(summarize([r('full', 1, 23 * 60 + 40)], 10, NOW).full, 1);
});

test('reports are off on Vercel until a store is connected', () => {
  assert.equal(createStore({ VERCEL: '1' }), null);
  assert.equal(createStore({}).kind, 'memory');
  assert.equal(createStore({ VERCEL: '1', KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' }).kind, 'upstash');
});

test('answers carry each curb id and what drivers reported', async () => {
  const demo = loadData(path.join(__dirname, '..', 'data', 'demo.json'));
  const store = memoryStore();
  const first = await checkCurb({ address: '120 W 28th St', when: '2026-10-07T17:00' }, demo, { offline: true, reports: store });
  const id = first.recommendation.id;
  assert.match(id, /^W 28 ST\|/);
  assert.deepEqual(first.recommendation.reports.notes, []);
  await store.add(id, { k: 'ok', t: Date.now(), d: 3, m: 1020 });
  const again = await checkCurb({ address: '120 W 28th St', when: '2026-10-07T17:00' }, demo, { offline: true, reports: store });
  assert.equal(again.recommendation.reports.confirmed, 1);
  assert.ok(again.backups.every((b) => b.id && b.reports));
});

test('a broken report store never breaks the answer', async () => {
  const demo = loadData(path.join(__dirname, '..', 'data', 'demo.json'));
  const broken = { recent: async () => { throw new Error('down'); } };
  const orig = console.error;
  console.error = () => {};
  try {
    const a = await checkCurb({ address: '120 W 28th St', when: '2026-10-07T17:00' }, demo, { offline: true, reports: broken });
    assert.equal(a.verdict, 'go');
    assert.equal(a.recommendation.reports, undefined);
  } finally {
    console.error = orig;
  }
});
