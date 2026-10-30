// audio-ws/server.js — local relay from Meet preload to Electron main process
const WebSocket = require('ws');
const { overlayReadinessMessage } = require('./readiness');

const PORT = 9999;
let wss = null;
let audioCb = () => {};
let hostAudioCb = () => {};
let clients = new Set();

function startAudioWSServer({ isOverlayReady } = {}) {
  if (wss) return true;

  wss = new WebSocket.Server({ host: '127.0.0.1', port: PORT });
  clients = new Set();

  wss.on('connection', (ws, request) => {
    // Do not pass host readiness checks into the existing Meet audio relay.
    if (request?.url === '/host-ready') {
      ws.on('error', () => {});
      ws.send(overlayReadinessMessage(isOverlayReady), () => {
        try { ws.close(1000, 'readiness delivered'); } catch (_) {}
      });
      return;
    }
    // Keep host and PIN viewer raw PCM streams on their own desktops.
    const isHost = request?.url === '/host-audio';
    const isParticipant = request?.url === '/' || request?.url === '/participant-audio';
    const origin = String(request?.headers?.origin || '');
    if ((!isHost && !isParticipant) || (origin && !/^https:\/\/meet\.google\.com$/.test(origin))) {
      ws.close(1008, 'unsupported audio source');
      return;
    }
    clients.add(ws);
    console.log('[AudioRelay] Meet audio client connected');

    ws.on('message', (data) => {
      if (!data || data.length === 0) return;
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (isHost) hostAudioCb(buf); else audioCb(buf);
      } catch (err) {
        console.error('[AudioRelay] Audio chunk error:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[AudioRelay] Meet audio client disconnected');
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      console.error('[AudioRelay] Client error:', err.message);
    });
  });

  wss.on('listening', () => {
    console.log(`[AudioRelay] Listening on ws://localhost:${PORT}`);
  });

  wss.on('error', (err) => {
    console.error('[AudioRelay] Server error:', err.message);
  });

  return true;
}

function onAudioChunk(cb) {
  audioCb = typeof cb === 'function' ? cb : () => {};
}

function onHostAudioChunk(cb) { hostAudioCb = typeof cb === 'function' ? cb : () => {}; }

function stopAudioWSServer() {
  hostAudioCb = () => {};
  audioCb = () => {};

  for (const ws of clients) {
    try { ws.close(1000, 'app stopped'); } catch (_) {}
  }
  clients.clear();

  if (wss) {
    try { wss.close(); } catch (_) {}
    wss = null;
  }
}

module.exports = { startAudioWSServer, onAudioChunk, onHostAudioChunk, stopAudioWSServer };
