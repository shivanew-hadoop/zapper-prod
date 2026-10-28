// PIN overlays are local-first. Never delay Meet->Electron IPC waiting for a
// remote websocket. Remote text is a safety fallback when local Meet captions
// have stopped arriving; the backend still handles PIN auth, chat and PDFs.
const LOCAL_CAPTION_STALE_MS = 6000;
const HOST_RELAY_PRIORITY_MS = 1800;

function shouldRenderParticipantCaption({ source, lastLocalAt = 0, lastHostRelayAt = 0, now = Date.now() }) {
  if (source === 'local-meet') return true;
  if (source !== 'host-relay' && source !== 'peer-relay') return false;
  if (lastLocalAt > 0 && now - lastLocalAt < LOCAL_CAPTION_STALE_MS) return false;
  // If local Meet is unavailable, use the host-authorized feed before another
  // participant's captions. This is the existing fallback preference.
  if (source === 'peer-relay' && lastHostRelayAt > 0 &&
      now - lastHostRelayAt < HOST_RELAY_PRIORITY_MS) return false;
  return true;
}

module.exports = { shouldRenderParticipantCaption, LOCAL_CAPTION_STALE_MS };
