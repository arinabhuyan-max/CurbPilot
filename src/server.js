// Tiny HTTP server: serves the phone page and one JSON endpoint.
//   GET /                -> public/index.html
//   GET /api/check?address=...&when=...
//   GET /api/info        -> pilot area + data source
//   GET /api/camera/<id>/image -> latest snapshot of a listed NYC DOT camera
//                                 (fallback when the page can't load it directly)

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { checkCurb, loadData, cameraList } = require('./checker');
const { imageUrl } = require('./cameras');

const PORT = Number(process.env.PORT) || 3000;
const OFFLINE = process.env.CURBPILOT_OFFLINE === '1';
const PUBLIC = path.join(__dirname, '..', 'public');
const data = loadData(process.env.CURBPILOT_DATA);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/check') {
      const result = await checkCurb(
        { address: url.searchParams.get('address'), when: url.searchParams.get('when') },
        data,
        { offline: OFFLINE }
      );
      return send(res, result.error ? 400 : 200, result);
    }
    const cam = url.pathname.match(/^\/api\/camera\/([0-9a-f-]{36})\/image$/i);
    if (cam) return await sendCameraImage(res, cam[1].toLowerCase());
    if (url.pathname === '/api/info') {
      return send(res, 200, {
        area: config.area.name,
        ...data.meta,
        blockfaces: data.blockfaces.length,
        cameras: cameraList().list.length,
      });
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
