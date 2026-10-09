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
