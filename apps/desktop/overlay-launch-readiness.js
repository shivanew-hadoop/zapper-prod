// Local-only handshake: the website must never create a session merely because
// a zapper:// link was requested. A fresh launch nonce is acknowledged only
// after Electron receives that protocol URL and its overlay is visible/loaded.
const http = require('http');

const PORT = 43791;
const LAUNCH_NONCE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  'https://zapperapp.in', 'https://www.zapperapp.in',
  'http://localhost:5173', 'http://127.0.0.1:5173'
]);

function parseLaunchNonce(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'zapper:' || parsed.hostname.toLowerCase() !== 'launch') return null;
    const nonce = parsed.searchParams.get('nonce') || '';
    return LAUNCH_NONCE.test(nonce) ? nonce.toLowerCase() : null;
  } catch (_) { return null; }
}

function createOverlayReadinessServer(isOverlayReady, { port = PORT, origins = ALLOWED_ORIGINS } = {}) {
  let lastLaunch = null;
  const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin || '');
    if (!origins.has(origin)) {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${port}`); }
    catch (_) { res.writeHead(400); res.end(); return; }
    if (req.method !== 'GET' || url.pathname !== '/overlay-ready') {
      res.writeHead(404); res.end(); return;
    }
    const nonce = url.searchParams.get('nonce') || '';
    const confirmed = Boolean(lastLaunch && LAUNCH_NONCE.test(nonce) &&
      lastLaunch.nonce === nonce.toLowerCase() && Date.now() - lastLaunch.at < 10 * 60 * 1000);
    const ready = confirmed && Boolean(isOverlayReady());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ready }));
  });
  server.on('error', error => {
    // An occupied port is NOT confirmation. Website stays blocked until a
    // genuine ready reply is returned by the expected desktop app.
    console.error('Zapper overlay readiness server:', error.message);
  });
  return {
    server,
    acknowledgeUrl(rawUrl) {
      const nonce = parseLaunchNonce(rawUrl);
      if (nonce) lastLaunch = { nonce, at: Date.now() };
      return Boolean(nonce);
    },
    start() { server.listen(port, '127.0.0.1'); },
    stop() { server.close(); }
  };
}

module.exports = { PORT, parseLaunchNonce, createOverlayReadinessServer };
