// Host-tab lifecycle: one Meet tab per Zapper session, never one per refresh.
const URL_PATTERN = /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/;
const WEB_ORIGIN = /^https:\/\/(?:www\.)?(?:zapperapp\.in|zapper\.app)$|^http:\/\/(?:localhost|127\.0\.0\.1):5173$/;
const KEY = 'zapperHostMeetSessions';
const PENDING_KEY = 'zapperPendingMeetRoom';
let work = Promise.resolve();

function serialized(task) {
  const next = work.then(task, task);
  work = next.catch(() => {});
  return next;
}
async function sessions() { return (await chrome.storage.session.get(KEY))[KEY] || {}; }
async function save(s) { await chrome.storage.session.set({ [KEY]: s }); }
function senderValid(sender) {
  try { return WEB_ORIGIN.test(new URL(sender.url || sender.tab?.url || '').origin) && sender.tab?.id != null; }
  catch { return false; }
}
async function sendStatus(entry, status, message) {
  if (!entry) return;
  await chrome.tabs.sendMessage(entry.ownerTabId,
    { type: 'zapper-host-status', sessionId: entry.sessionId, status, message })
    .catch(() => {});
}
async function tellMeet(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch { return null; }
}
// If Google Meet API OAuth is not configured, a signed-in local Google browser
// can still open meet.google.com/new and give Zapper the room URL. Only the
// authenticated Zapper page can then register the link and issue the PIN.
async function createRoom(sender) {
  const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
  if (pending?.ownerTabId === sender.tab.id) {
    const tab = await chrome.tabs.get(pending.tabId).catch(() => null);
    if (tab && URL_PATTERN.test(tab.url || '')) return { ok: true, meetUrl: tab.url.replace(/\/$/, '') };
  }
  const tab = await chrome.tabs.create({ url: 'https://meet.google.com/new', active: true, windowId: sender.tab.windowId });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 25000) {
    const updated = await chrome.tabs.get(tab.id).catch(() => null);
    if (!updated) return { ok: false, error: 'Google Meet creation tab was closed.' };
    const uri = String(updated.url || '').split(/[?#]/)[0].replace(/\/$/, '');
    if (URL_PATTERN.test(uri)) {
      await chrome.storage.session.set({ [PENDING_KEY]: { tabId: tab.id, ownerTabId: sender.tab.id, meetUrl: uri } });
      return { ok: true, meetUrl: uri };
    }
    await new Promise(resolve => setTimeout(resolve, 550));
  }
  return { ok: false, error: 'Google Meet did not produce a room. Sign in to Google in Chrome/Edge, then try Create Session again.' };
}
async function grantMicrophone() {
  // Chrome may refuse this under an enterprise policy or a user override.
  // In that case Meet reports an explicit microphone-blocked status.
  try {
    await chrome.contentSettings.microphone.set({
      primaryPattern: 'https://meet.google.com/*', setting: 'allow', scope: 'regular',
    });
  } catch (error) {
    console.warn('Meet microphone permission could not be preconfigured:', error.message);
  }
}
async function startHost(message, sender) {
  if (!URL_PATTERN.test(message.meetUrl || '')) return { ok: false, error: 'A valid Google Meet room is required.' };
  const state = await sessions();
  const existing = state[message.sessionId];
  if (existing?.meetUrl === message.meetUrl) {
    const tab = await chrome.tabs.get(existing.meetTabId).catch(() => null);
    if (tab) {
      existing.ownerTabId = sender.tab.id;
      state[message.sessionId] = existing;
      await save(state);
      await sendStatus(existing, 'starting', 'Reconnecting to existing host Google Meet tab…');
      await tellMeet(existing.meetTabId, { type: 'zapper-host-meet-start', sessionId: message.sessionId });
      return { ok: true, status: existing.status || 'starting', reused: true };
    }
  }
  if (existing?.meetTabId) await chrome.tabs.remove(existing.meetTabId).catch(() => {});
  // Fail explicitly if another session attempts to claim the same host room.
  for (const entry of Object.values(state)) {
    if (entry.sessionId !== message.sessionId && entry.meetUrl === message.meetUrl &&
      await chrome.tabs.get(entry.meetTabId).catch(() => null)) {
      return { ok: false, error: 'This Google Meet is already hosted by another Zapper session.' };
    }
  }
  await grantMicrophone();
  const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
  const staged = pending?.ownerTabId === sender.tab.id && pending.meetUrl === message.meetUrl
    ? await chrome.tabs.get(pending.tabId).catch(() => null) : null;
  if (staged) await chrome.storage.session.remove(PENDING_KEY);
  // A focused tab is needed initially for Google sign-in and microphone startup.
  // Once admitted, focus returns to Zapper. The Meet tab stays joined.
  const tab = staged || await chrome.tabs.create({ url: message.meetUrl, active: true, windowId: sender.tab.windowId });
  const entry = {
    sessionId: message.sessionId, meetUrl: message.meetUrl,
    ownerTabId: sender.tab.id, ownerWindowId: sender.tab.windowId,
    meetTabId: tab.id, status: 'starting',
  };
  state[message.sessionId] = entry;
  await save(state);
  await sendStatus(entry, 'starting', 'Google Meet opened; automatically joining with microphone on and camera off…');
  await tellMeet(tab.id, { type: 'zapper-host-meet-start', sessionId: message.sessionId });
  return { ok: true, status: 'starting' };
}
async function stopHost(sessionId) {
  const state = await sessions();
  const entry = state[sessionId];
  if (!entry) return { ok: true, status: 'stopped' };
  delete state[sessionId];
  await save(state);
  await tellMeet(entry.meetTabId, { type: 'zapper-host-meet-stop', sessionId });
  await chrome.tabs.remove(entry.meetTabId).catch(() => {});
  return { ok: true, status: 'stopped' };
}
async function userCommand(payload, sender) {
  if (!senderValid(sender)) return { ok: false, error: 'Untrusted host page.' };
  if (!['create', 'ping'].includes(payload.action) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sessionId || '')) {
    return { ok: false, error: 'Invalid Zapper session.' };
  }
  if (payload.action === 'ping') return { ok: true, status: 'extension-ready' };
  if (payload.action === 'create') return createRoom(sender);
  if (payload.action === 'start') return startHost(payload, sender);
  const state = await sessions();
  const entry = state[payload.sessionId];
  if (payload.action === 'status') return {
    ok: true, status: entry?.status || 'not-started',
  };
  if (!entry) return { ok: false, error: 'No host Google Meet tab is connected.' };
  if (entry.ownerTabId !== sender.tab.id && payload.action !== 'stop') {
    return { ok: false, error: 'Another Zapper tab owns this host meeting.' };
  }
  if (payload.action === 'stop') return stopHost(payload.sessionId);
  if (payload.action === 'mute' || payload.action === 'unmute') {
    const result = await tellMeet(entry.meetTabId,
      { type: 'zapper-host-meet-microphone', enabled: payload.action === 'unmute', sessionId: payload.sessionId });
    return result || { ok: false, error: 'Google Meet tab is not ready.' };
  }
  return { ok: false, error: 'Unsupported command.' };
}
chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
  if (payload?.type === 'zapper-web-host-command') {
    serialized(() => userCommand(payload, sender))
      .then(sendResponse, error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (payload?.type === 'zapper-meet-host-progress') {
    serialized(async () => {
      const state = await sessions();
      const entry = state[payload.sessionId];
      if (!entry || sender.tab?.id !== entry.meetTabId) return;
      const oldStatus = entry.status;
      entry.status = String(payload.status || 'starting');
      await save(state);
      await sendStatus(entry, entry.status, String(payload.message || ''));
      if (entry.status === 'joined' && oldStatus !== 'joined') {
        // Return to Web UI. Keep the actual Meet tab running in the background.
        await chrome.tabs.update(entry.ownerTabId, { active: true }).catch(() => {});
      }
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  serialized(async () => {
    const state = await sessions();
    for (const entry of Object.values(state)) {
      if (entry.meetTabId === tabId) {
        await tellMeet(tabId, { type: 'zapper-host-meet-start', sessionId: entry.sessionId });
      }
    }
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  serialized(async () => {
    const state = await sessions();
    for (const entry of Object.values(state)) {
      if (entry.meetTabId === tabId) {
        delete state[entry.sessionId];
        await sendStatus(entry, 'stopped', 'The host Google Meet tab was closed.');
      }
    }
    await save(state);
  });
});
