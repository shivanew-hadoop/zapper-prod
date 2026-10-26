// meet-controller/host-join.js — Host mode.
// Launched by the web portal through zapper://host-join?meet=<link>&name=<name> right after
// Create Session. Joins the freshly created Google Meet AS THE HOST: camera OFF, microphone ON,
// clicks Join automatically and keeps the window open so the host's voice is in the meeting.
// Participants then join with the PIN and the existing caption pipeline does the rest.
// This never sends microphone audio to Zapper servers or to Deepgram: the audio goes only to Meet.
const { app, shell } = require('electron');
const path = require('path');
const { HostBrowserController } = require('./host-browser');

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
let hostController = null;

function sanitizeName(value) {
  const name = String(value || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return name || 'Host';
}

function parseHostJoinUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'zapper:' || parsed.hostname.toLowerCase() !== 'host-join') return null;
  const meetUrl = String(parsed.searchParams.get('meet') || '').trim().toLowerCase();
  if (!MEET_URL.test(meetUrl)) return null; // never open anything but a Meet room link
  return { meetUrl, name: sanitizeName(parsed.searchParams.get('name')) };
}

// zapper://host-mic?state=on|off and zapper://host-leave — the web portal's Mute button and
// End Session control the host's Meet window through these.
function parseHostControlUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'zapper:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'host-leave') return { type: 'leave' };
  if (host === 'host-mic') {
    const state = String(parsed.searchParams.get('state') || '').toLowerCase();
    if (state === 'on' || state === 'off') return { type: 'mic', on: state === 'on' };
  }
  return null;
}


// Supported system browser is intentionally NOT bundled. Its browser profile is
// separate from Electron and persistent for one-time Google sign-in.
function controller(onStatus) {
  if (!hostController) hostController = new HostBrowserController({
    profileDir: path.join(app.getPath('userData'), 'host-system-browser'),
    shell,
    onStatus,
  });
  else hostController.onStatus = onStatus;
  return hostController;
}
async function joinAsHost({ meetUrl, name }, onStatus = () => {}) {
  if (!MEET_URL.test(String(meetUrl || ''))) throw new Error('Invalid Google Meet URL');
  return controller(onStatus).start({ meetUrl, name: sanitizeName(name) });
}
async function leaveHost() {
  if (hostController) await hostController.stop();
}
async function setHostMic(on) {
  return hostController ? hostController.setMic(on) : false;
}
async function toggleHostWindow() {
  return hostController ? hostController.show() : false;
}
module.exports = { joinAsHost, leaveHost, setHostMic, toggleHostWindow,
  parseHostControlUrl, parseHostJoinUrl, sanitizeName, MEET_URL };
