// Host mode guard: the zapper://host-join link may only ever open a real Google Meet room.
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { BrowserWindow: class {}, screen: {}, session: {}, systemPreferences: {} };
  return originalLoad.call(this, request, ...rest);
};
const { parseHostJoinUrl, sanitizeName } = require('../meet-controller/host-join');
Module._load = originalLoad;

const meet = encodeURIComponent('https://meet.google.com/abc-defg-hij');
assert.deepEqual(parseHostJoinUrl(`zapper://host-join?meet=${meet}&name=Zed%20Host`), { meetUrl: 'https://meet.google.com/abc-defg-hij', name: 'Zed Host' });
assert.equal(parseHostJoinUrl('zapper://launch'), null, 'other zapper:// links must be ignored');
assert.equal(parseHostJoinUrl(`zapper://host-join?meet=${encodeURIComponent('https://evil.example/abc-defg-hij')}`), null, 'non-Meet hosts must be rejected');
assert.equal(parseHostJoinUrl(`zapper://host-join?meet=${encodeURIComponent('https://meet.google.com/abc-defg-hij/../x')}`), null, 'only exact room links');
assert.equal(parseHostJoinUrl('https://meet.google.com/abc-defg-hij'), null, 'wrong scheme rejected');
assert.equal(sanitizeName('<script>x</script>'), 'scriptxscript');
assert.equal(sanitizeName(''), 'Host');
console.log(JSON.stringify({ ok: true, hostJoinOnlyOpensMeetRooms: true }));
