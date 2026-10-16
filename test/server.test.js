// Starts the real server and checks the camera image relay only serves listed cameras.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3000 + Math.floor(Math.random() * 1000) + 4000;

test('camera image relay refuses ids that are not in the camera list', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CURBPILOT_OFFLINE: '1',
      CURBPILOT_DATA: path.join(__dirname, '..', 'data', 'demo.json'),
      CURBPILOT_CAMERAS: path.join(__dirname, 'fixtures', 'cameras.json'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill());
  await new Promise((ok) => server.stdout.once('data', ok));
  const base = `http://127.0.0.1:${PORT}`;

  const unknown = await fetch(`${base}/api/camera/99999999-9999-4999-8999-999999999999/image`);
  assert.equal(unknown.status, 404);
  const notId = await fetch(`${base}/api/camera/..%2F..%2Fetc%2Fpasswd/image`);
  assert.equal(notId.status, 404);

  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.cameras, 5);
  const check = await (await fetch(`${base}/api/check?address=120%20W%2028th%20St&when=17:00`)).json();
  assert.equal(check.cameras[0].proxyUrl, '/api/camera/11111111-2222-4333-8444-555555555555/image');
});

test('driver reports: only known curbs and report types, then shown on the next check', async (t) => {
  const port = PORT + 1;
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      CURBPILOT_OFFLINE: '1',
      CURBPILOT_DATA: path.join(__dirname, '..', 'data', 'demo.json'),
      CURBPILOT_CAMERAS: path.join(__dirname, 'fixtures', 'cameras.json'),
      VERCEL: '',
      KV_REST_API_URL: '',
      UPSTASH_REDIS_REST_URL: '',
      REPORTS_ADMIN_TOKEN: 'secret-token',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill());
  await new Promise((ok) => server.stdout.once('data', ok));
  const base = `http://127.0.0.1:${port}`;
  const post = (body) => fetch(`${base}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const checkUrl = `${base}/api/check?address=120%20W%2028th%20St&when=2026-10-07T17:00`;

  assert.equal((await (await fetch(`${base}/api/info`)).json()).reports, true);
  const { recommendation } = await (await fetch(checkUrl)).json();
  assert.equal((await post({ id: 'NOT|A|REAL|CURB', kind: 'ok' })).status, 400);
  assert.equal((await post({ id: recommendation.id, kind: 'great' })).status, 400);
  assert.equal((await post({ id: recommendation.id, kind: 'wrong' })).status, 200);

  const after = await (await fetch(checkUrl)).json();
  assert.equal(after.recommendation.reports.wrong, 1);
  assert.match(after.summary, /^Park on/, 'reports never change the recommendation');

  assert.equal((await fetch(`${base}/api/reports/wrong`)).status, 404, 'review list needs the admin token');
  const review = await (await fetch(`${base}/api/reports/wrong`, { headers: { Authorization: 'Bearer secret-token' } })).json();
  assert.equal(review.reports[0].id, recommendation.id);
});
