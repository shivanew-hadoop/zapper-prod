// Runs ONLY in the Google Meet tab explicitly opened by Zapper's extension.
// This is not fake audio injection: Google Meet itself captures the host mic.
(() => {
  'use strict';
  let sessionId = '';
  let timer = null;
  let attempts = 0;
  let lastReport = '';
  let lastReportAt = 0;
  let joined = false;
  let userMuted = false;
  const MAX_ATTEMPTS = 300;
  const VALID_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const label = el => [el.getAttribute('aria-label'), el.getAttribute('data-tooltip'),
    el.getAttribute('title'), el.textContent?.slice(0, 140)]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const buttons = () => [...document.querySelectorAll('button, [role="button"]')]
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' &&
        getComputedStyle(el).display !== 'none';
    });
  const findButton = pattern => buttons().find(b => pattern.test(label(b)));
  const tap = button => {
    try { button?.click(); return Boolean(button); } catch { return false; }
  };
  const stateText = () => String(document.body?.innerText || '').toLowerCase();
  function inCall() {
    return Boolean(findButton(/(?:^|\b)(leave call|end call|hang up)(?:\b|$)/i));
  }
  function micControl() {
    const off = findButton(/turn on (?:the )?(?:microphone|mic)\b|\bunmute (?:microphone|mic)\b|microphone (?:is )?off\b|mic (?:is )?off\b/i);
    if (off) return { element: off, enabled: false };
    const on = findButton(/turn off (?:the )?(?:microphone|mic)\b|\bmute (?:microphone|mic)\b|microphone (?:is )?on\b|mic (?:is )?on\b/i);
    if (on) return { element: on, enabled: true };
    return null;
  }
  function cameraControl() {
    const on = findButton(/turn off (?:the )?(?:camera|video)\b|camera (?:is )?on\b|video (?:is )?on\b/i);
    if (on) return { element: on, enabled: true };
    const off = findButton(/turn on (?:the )?(?:camera|video)\b|camera (?:is )?off\b|video (?:is )?off\b/i);
    if (off) return { element: off, enabled: false };
    return null;
  }
  function report(status, message) {
    const key = status + ':' + message;
    const now = Date.now();
    if (key === lastReport && now - lastReportAt < 15000) return;
    lastReport = key;
    lastReportAt = now;
    if (!sessionId) return;
    chrome.runtime.sendMessage({ type: 'zapper-meet-host-progress', sessionId, status, message })
      .catch(() => {});
  }
  async function microphonePermission() {
    try {
      const state = await navigator.permissions.query({ name: 'microphone' });
      return state.state;
    } catch { return 'unknown'; }
  }
  async function tick() {
    if (!sessionId) return;
    const text = stateText();
    if (/waiting (?:to be |for ).*(?:admit|let you in)|asking to join|someone will let you in/.test(text)) {
      report('waiting', 'Google Meet is requesting admission. Sign into the Google account that created this room.');
      return;
    }
    if (await microphonePermission() === 'denied') {
      report('error', 'Google Meet microphone permission is blocked. Allow the microphone for meet.google.com in Chrome/Edge.');
      stopPoll();
      return;
    }
    if (/sign in to (?:your |a )?google account|choose an account to continue/.test(text) && !inCall()) {
      report('attention', 'Google Meet needs the host to sign in to Google in this browser.');
      return;
    }

    const camera = cameraControl();
    if (camera?.enabled) tap(camera.element);
    const mic = micControl();
    if (mic && mic.enabled === userMuted) tap(mic.element);

    // The host is not considered ready until Meet itself shows the call controls
    // and it reports microphone ON and camera OFF. This is never a guessed state.
    const currentMic = micControl();
    const currentCamera = cameraControl();
    if (inCall()) {
      joined = true;
      if (!userMuted && currentMic?.enabled && currentCamera?.enabled === false) {
        report('joined', 'Host joined Google Meet; microphone ON, camera OFF. PIN participants can hear host audio.');
      } else if (userMuted && currentMic?.enabled === false) {
        report('muted', 'Host muted in Google Meet.');
      } else {
        report('attention', !currentMic ? 'Host joined, but microphone state cannot be confirmed in Google Meet.'
          : currentMic.enabled === false && !userMuted ? 'Host joined; attempting to unmute the Google Meet microphone…'
          : !currentCamera ? 'Host joined; camera state cannot be confirmed.'
          : 'Host joined; turning off Google Meet camera…');
      }
      return;
    }
    if (joined) {
      joined = false;
      report('stopped', 'Host left Google Meet. Attempting to rejoin…');
    }

    // Fail closed: never join with camera on or microphone muted/unknown.
    if (currentCamera?.enabled === true || currentMic?.enabled !== true || currentCamera?.enabled !== false) {
      report('starting', 'Preparing Google Meet: switching camera OFF and microphone ON…');
      return;
    }
    const join = findButton(/^(?:join now|join meeting|join call|ask to join)(?:\b|\s)/i);
    if (join) {
      tap(join);
      report('starting', 'Joining Google Meet automatically…');
    } else {
      report('starting', 'Waiting for Google Meet join controls…');
    }
  }
  let busy = false;
  function stopPoll() { if (timer) clearInterval(timer); timer = null; }
  function startPoll(newSessionId) {
    if (!VALID_SESSION.test(newSessionId)) return { ok: false, error: 'Invalid session identifier.' };
    if (sessionId && sessionId !== newSessionId) return { ok: false, error: 'Another Zapper session already owns this Meet tab.' };
    sessionId = newSessionId;
    if (timer) return { ok: true, alreadyRunning: true };
    attempts = 0;
    timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        if (++attempts > MAX_ATTEMPTS && !joined) {
          report('error', 'Google Meet did not join. Check the Google account, microphone permission, and meeting access.');
          stopPoll();
          return;
        }
        await tick();
      } catch (error) {
        report('error', `Google Meet automation issue: ${String(error?.message || error).slice(0, 120)}`);
      } finally { busy = false; }
    }, 1200);
    void tick();
    return { ok: true };
  }
  chrome.runtime.onMessage.addListener((payload, sender, reply) => {
    if (payload?.type === 'zapper-host-meet-start') {
      reply(startPoll(payload.sessionId));
    } else if (payload?.type === 'zapper-host-meet-stop') {
      if (payload.sessionId !== sessionId) { reply({ ok: false }); return; }
      stopPoll();
      sessionId = '';
      reply({ ok: true });
    } else if (payload?.type === 'zapper-host-meet-microphone') {
      if (payload.sessionId !== sessionId) { reply({ ok: false, error: 'Wrong session.' }); return; }
      userMuted = !payload.enabled;
      const mic = micControl();
      if (mic && mic.enabled !== payload.enabled) tap(mic.element);
      reply({ ok: true, status: payload.enabled ? 'unmuting' : 'muting' });
      void pause(350).then(tick);
    }
  });
})();
