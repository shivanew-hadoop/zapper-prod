import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  supportedHostBrowser, shouldAutoDownload, queueResume, consumeResume,
  HOST_EXTENSION_ZIP, HOST_EXTENSION_DOWNLOADED_KEY, HOST_EXTENSION_PENDING_KEY,
} from '../src/host-extension-setup.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

const storage = memoryStorage();
assert.equal(supportedHostBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36'), true);
assert.equal(supportedHostBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/137.0.0.0'), true);
assert.equal(supportedHostBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/137.0.0.0 Mobile'), false);
assert.equal(supportedHostBrowser('Mozilla/5.0 (iPhone) CriOS/137.0.0.0 Mobile'), false);
assert.equal(supportedHostBrowser('Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15'), false);
assert.equal(shouldAutoDownload(storage), true);
storage.setItem(HOST_EXTENSION_DOWNLOADED_KEY, 'yes');
assert.equal(shouldAutoDownload(storage), false, 'avoid duplicate ZIP downloads on repeated Create Session clicks');
queueResume(storage, 'host-a');
assert.equal(consumeResume(storage, 'host-b'), false, 'never auto-create under another account');
assert.equal(storage.getItem(HOST_EXTENSION_PENDING_KEY), null);
queueResume(storage, 'host-a');
assert.equal(consumeResume(storage, 'host-a'), true);
assert.equal(consumeResume(storage, 'host-a'), false, 'reload continuation executes once');
assert.equal(HOST_EXTENSION_ZIP, '/downloads/Zapper-Host-Meet-Chrome-Edge-Extension.zip');
const mainSource = readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
assert.match(mainSource, /hostMeetCommand\('ping', ''\)/);
assert.match(mainSource, /hostExtensionSetup\.open\(\{ ownerId: account\.id \}\)/);
assert.match(mainSource, /if \(consumeResume\(sessionStorage, account\.id\)/);
console.log('Host extension onboarding: browser detection, one-time download, session ownership, and safe reload resume passed');
