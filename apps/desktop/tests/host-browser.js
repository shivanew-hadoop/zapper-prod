'use strict';
const assert = require('assert');
const { HostBrowserController, browserCandidates, MEET } = require('../meet-controller/host-browser');
(async () => {
  const messages = [], external = [];
  const bridge = new HostBrowserController({
    profileDir: '/tmp/zapper-host-browser-test-not-created',
    browserPath: null,
    shell: { openExternal: async url => { external.push(url); } },
    onStatus: text => messages.push(text),
  });
  assert(MEET.test('https://meet.google.com/abc-defg-hij'));
  assert(!MEET.test('https://not-google.com/abc-defg-hij'));
  assert.rejects(() => bridge.start({ meetUrl: 'https://evil.example/abc-defg-hij' }), /Invalid Google Meet/);
  assert.equal(external.length, 0);
  await bridge.start({ meetUrl: 'https://meet.google.com/abc-defg-hij' });
  assert.deepEqual(external, ['https://meet.google.com/abc-defg-hij']);
  assert(messages.some(text => text.includes('join Meet manually')));
  const launches = external.length;
  await bridge.start({ meetUrl: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(external.length, launches, 'same room should not be opened twice');
  await bridge.stop();
  let clicks = 0;
  bridge.stopping = false;
  bridge.currentUrl = 'https://meet.google.com/abc-defg-hij';
  bridge.cdp = { command: async () => ({}), close: () => {} };
  bridge.evaluate = async () => ({ state: 'ready', x: 123, y: 456 });
  bridge.click = async (x, y) => { assert.equal(x, 123); assert.equal(y, 456); clicks++; };
  await bridge.tick(bridge.generation);
  await bridge.tick(bridge.generation);
  assert.equal(clicks, 1, 'join attempts should be rate-limited');
  bridge.evaluate = async () => ({ state: 'joined' });
  await bridge.tick(bridge.generation);
  assert(bridge.joined, 'joined state must be confirmed, not assumed after click');
  bridge.evaluate = async () => ({ state: 'blocked' });
  await bridge.tick(bridge.generation);
  assert(messages.some(x => x.includes('Google Meet rejected')));
  await bridge.stop();
  assert(browserCandidates({ PROGRAMFILES: 'C:\\Program Files' }).some(x => x.includes('chrome.exe')));
  console.log(JSON.stringify({ ok: true, noBrowserBundle: true, explicitJoinedState: true, boundedClicks: true, browserCleanup: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
