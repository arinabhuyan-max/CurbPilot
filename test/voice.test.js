const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { voiceAssistant, spokenAnswer, readToolCalls, DEFAULT_MODEL } = require('../src/voice');

test('reads both tool-call shapes from the Vapi docs', () => {
  // Function tools page: arguments as an object under function
  const a = readToolCalls({
    message: { type: 'tool-calls', toolCallList: [{ id: 'toolu_1', type: 'function', function: { name: 'check_curb', arguments: { address: '120 W 28th St' } } }] },
  });
  assert.deepEqual(a, [{ id: 'toolu_1', name: 'check_curb', args: { address: '120 W 28th St' } }]);
  // Server events page: flat name + parameters; and arguments as a JSON string
  const b = readToolCalls({ message: { toolCallList: [{ id: 'abc', name: 'check_curb', parameters: { address: 'x' } }] } });
  assert.deepEqual(b[0], { id: 'abc', name: 'check_curb', args: { address: 'x' } });
  const c = readToolCalls({ message: { toolCallList: [{ id: 'q', function: { name: 'check_curb', arguments: '{"address":"y","arrival_time":"17:30"}' } }] } });
  assert.deepEqual(c[0].args, { address: 'y', arrival_time: '17:30' });
});

test('spoken answer: summary, numbered backups, sign reminder, no em dashes', () => {
  const text = spokenAnswer({
    summary: 'Park on the north side of W 28th St. Commercial parking until 7 PM — pay at the meter.',
    backups: [{ label: 'the north side of W 27th St (between 6th Ave & 7th Ave)', distance: 'about 70 m, 1 min walk', text: 'Commercial parking until 6 PM.' }],
  });
  assert.match(text, /^Park on the north side of W 28th St\./);
  assert.match(text, /Backup 1 if that's full: the north side of W 27th St/);
  assert.match(text, /Always obey the sign where you stop\.$/);
  assert.doesNotMatch(text, /—/);
  assert.equal(spokenAnswer({ ok: false, error: 'Enter a delivery address.' }), 'Enter a delivery address.');
});

test('assistant: Claude on Vapi, check_curb tool pointing at our server', () => {
  const a = voiceAssistant('https://curb-pilot.vercel.app/api/vapi/tool', {});
  assert.equal(a.model.provider, 'anthropic');
  assert.equal(a.model.model, DEFAULT_MODEL);
  assert.equal(a.model.tools[0].function.name, 'check_curb');
  assert.equal(a.model.tools[0].server.url, 'https://curb-pilot.vercel.app/api/vapi/tool');
  assert.deepEqual(a.model.tools[0].function.parameters.required, ['address']);
  assert.equal(a.voice, undefined, 'Vapi default voice unless configured');
  const custom = voiceAssistant('u', { VAPI_MODEL: 'claude-haiku-4-5-20251001', VAPI_VOICE_PROVIDER: 'vapi', VAPI_VOICE_ID: 'Elliot' });
  assert.equal(custom.model.model, 'claude-haiku-4-5-20251001');
  assert.deepEqual(custom.voice, { provider: 'vapi', voiceId: 'Elliot' });
});

test('server: /api/voice and the Vapi tool webhook', async (t) => {
  const PORT = 5000 + Math.floor(Math.random() * 2000);
  const start = (env) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, CURBPILOT_OFFLINE: '1', CURBPILOT_DATA: path.join(__dirname, '..', 'data', 'demo.json'), ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    t.after(() => p.kill());
    return new Promise((ok) => p.stdout.once('data', ok));
  };

  await start({ PORT: String(PORT), VAPI_PUBLIC_KEY: '' });
  const off = await (await fetch(`http://127.0.0.1:${PORT}/api/voice`)).json();
  assert.deepEqual(off, { enabled: false });

  await start({ PORT: String(PORT + 1), VAPI_PUBLIC_KEY: 'pk_test' });
  const base = `http://127.0.0.1:${PORT + 1}`;
  const on = await (await fetch(`${base}/api/voice`, { headers: { 'x-forwarded-host': 'curb-pilot.vercel.app', 'x-forwarded-proto': 'https' } })).json();
  assert.equal(on.publicKey, 'pk_test');
  assert.equal(on.assistant.model.tools[0].server.url, 'https://curb-pilot.vercel.app/api/vapi/tool');

  const call = (toolCallList) =>
    fetch(`${base}/api/vapi/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { type: 'tool-calls', toolCallList } }),
    });
  const res = await call([
    { id: 'toolu_1', type: 'function', function: { name: 'check_curb', arguments: { address: '120 W 28th St', arrival_time: '17:00' } } },
    { id: 'toolu_2', type: 'function', function: { name: 'check_curb', arguments: { address: '' } } },
    { id: 'toolu_3', type: 'function', function: { name: 'order_pizza', arguments: {} } },
  ]);
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.equal(results[0].toolCallId, 'toolu_1');
  assert.match(results[0].result, /Park on the north side of W 28th St/);
  assert.equal(typeof results[0].result, 'string');
  assert.ok(results[1].error && !results[1].result, 'a failed check uses error, not result');
  assert.match(results[2].error, /Unknown tool/);

  const other = await fetch(`${base}/api/vapi/tool`, { method: 'POST', body: JSON.stringify({ message: { type: 'status-update' } }) });
  assert.equal(other.status, 200);
});
