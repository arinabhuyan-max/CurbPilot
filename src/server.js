// Tiny HTTP server: serves the phone page and one JSON endpoint.
//   GET /                -> public/index.html
//   GET /api/check?address=...&when=...
//   GET /api/info        -> pilot area + data source
//   GET /api/camera/<id>/image -> latest snapshot of a listed NYC DOT camera
//                                 (fallback when the page can't load it directly)
//   GET  /api/voice      -> Vapi public key + Parker assistant config (voice on/off)
//   POST /api/vapi/tool  -> Vapi tool-calls webhook: Parker's check_curb
//   POST /api/report     -> a driver's report on a curb: { id, kind: ok | full | wrong }
//   GET  /api/reports/wrong -> "signs didn't match" reports to review
//                              (Authorization: Bearer $REPORTS_ADMIN_TOKEN)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { checkCurb, loadData, cameraList } = require('./checker');
const { imageUrl } = require('./cameras');
const { voiceAssistant, spokenAnswer, readToolCalls, TOOL_NAME } = require('./voice');
const { faceById } = require('./data');
const { KINDS: REPORT_KINDS, createStore } = require('./reports');
const { nycNow } = require('./time');

const PORT = Number(process.env.PORT) || 3000;
const OFFLINE = process.env.CURBPILOT_OFFLINE === '1';
const PUBLIC = path.join(__dirname, '..', 'public');
const data = loadData(process.env.CURBPILOT_DATA);
const reports = createStore();

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// Parker's picture: a parker.png/.webp/.jpg in public/ if one has been added,
// otherwise the drawn parker.svg.
const PARKER_TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const parkerFile = Object.keys(PARKER_TYPES)
  .map((ext) => `parker${ext}`)
  .find((f) => fs.existsSync(path.join(PUBLIC, f)));

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Only cameras from our own list, fetched from the fixed NYC DOT address:
// the id never becomes part of an arbitrary URL.
async function sendCameraImage(res, id) {
  const camera = cameraList().byId.get(id);
  if (!camera) return send(res, 404, { error: 'Unknown camera' });
  const upstream = await fetch(imageUrl(camera.id), { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const type = upstream && upstream.headers.get('content-type');
  if (!upstream || !upstream.ok || !/^image\//.test(type || '')) {
    return send(res, 502, { error: 'Camera image unavailable' });
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) return send(res, 502, { error: 'Camera image unavailable' });
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': body.length });
  return res.end(body);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Public origin of this deployment, for the tool URL Vapi calls back.
function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
}

// Same public information as /api/check, so no auth. Vapi expects HTTP 200 with { results: [{ toolCallId, result | error }] }, result a flat string.
async function handleVapiTool(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }
  if (!body.message || body.message.type !== 'tool-calls') return send(res, 200, {});
  const results = await Promise.all(
    readToolCalls(body).map(async ({ id, name, args }) => {
      if (name !== TOOL_NAME) return { toolCallId: id, error: `Unknown tool ${name}` };
      try {
        const answer = await checkCurb({ address: args.address, when: args.arrival_time || 'now' }, data, { offline: OFFLINE, reports });
        return answer.error ? { toolCallId: id, error: answer.error } : { toolCallId: id, result: spokenAnswer(answer) };
      } catch (err) {
        console.error(err);
        return { toolCallId: id, error: "Sorry, I couldn't check that address right now." };
      }
    })
  );
  return send(res, 200, { results });
}

// Best effort against a script flooding reports: per server instance, per IP.
const REPORTS_PER_HOUR = 30;
const reportLog = new Map();

function tooManyReports(ip, now = Date.now()) {
  const recent = (reportLog.get(ip) || []).filter((t) => now - t < 3600e3);
  if (reportLog.size > 10000) reportLog.clear();
  reportLog.set(ip, [...recent, now]);
  return recent.length >= REPORTS_PER_HOUR;
}

async function handleReport(req, res) {
  if (!reports) return send(res, 503, { error: 'Driver reports are not switched on.' });
  let body;
  try {
    body = await readJson(req, 4096);
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }
  if (!REPORT_KINDS.includes(body.kind) || typeof body.id !== 'string' || !faceById(data, body.id)) {
    return send(res, 400, { error: 'Unknown curb or report type.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyReports(ip)) return send(res, 429, { error: 'Too many reports. Try again later.' });
  const { day, minute } = nycNow();
  await reports.add(body.id, { k: body.kind, t: Date.now(), d: day, m: minute });
  return send(res, 200, { ok: true });
}

function isAdmin(req) {
  const token = process.env.REPORTS_ADMIN_TOKEN;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !given) return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/check') {
      const result = await checkCurb(
        { address: url.searchParams.get('address'), when: url.searchParams.get('when') },
        data,
        { offline: OFFLINE, reports }
      );
      return send(res, result.error ? 400 : 200, result);
    }
    if (url.pathname === '/api/report' && req.method === 'POST') return await handleReport(req, res);
    if (url.pathname === '/api/reports/wrong') {
      if (!reports || !isAdmin(req)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { reports: await reports.wrongList() });
    }
    if (url.pathname === '/api/vapi/tool' && req.method === 'POST') return await handleVapiTool(req, res);
    if (url.pathname === '/api/voice') {
      const publicKey = process.env.VAPI_PUBLIC_KEY;
      if (!publicKey) return send(res, 200, { enabled: false });
      return send(res, 200, { enabled: true, publicKey, assistant: voiceAssistant(`${origin(req)}/api/vapi/tool`) });
    }
    const cam = url.pathname.match(/^\/api\/camera\/([0-9a-f-]{36})\/image$/i);
    if (cam) return await sendCameraImage(res, cam[1].toLowerCase());
    if (url.pathname === '/api/info') {
      return send(res, 200, {
        area: config.area.name,
        ...data.meta,
        blockfaces: data.blockfaces.length,
        cameras: cameraList().list.length,
        reports: Boolean(reports),
        parkerImage: parkerFile ? `/${parkerFile}` : null,
      });
    }
    if (parkerFile && url.pathname === `/${parkerFile}`) {
      res.writeHead(200, { 'Content-Type': PARKER_TYPES[path.extname(parkerFile)], 'Cache-Control': 'public, max-age=3600' });
      return res.end(fs.readFileSync(path.join(PUBLIC, parkerFile)));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Something went wrong. Read the signs before you stop.' });
  }
});

server.listen(PORT, () => {
  const source = data.meta && data.meta.demo ? 'DEMO data (not real signs)' : 'NYC Open Data';
  console.log(`CurbPilot on http://localhost:${PORT}  (${data.blockfaces.length} block faces, ${source})`);
});
