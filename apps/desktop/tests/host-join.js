// Host mode guard: the zapper://host-join link may only ever open a real Google Meet room.
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { BrowserWindow: class {}, screen: {}, session: {}, systemPreferences: {} };
  return originalLoad.call(this, request, ...rest);
};
const { parseHostJoinUrl, parseHostControlUrl, sanitizeName } = require('../meet-controller/host-join');
Module._load = originalLoad;

const meet = encodeURIComponent('https://meet.google.com/abc-defg-hij');
assert.deepEqual(parseHostJoinUrl(`zapper://host-join?meet=${meet}&name=Zed%20Host`), { meetUrl: 'https://meet.google.com/abc-defg-hij', name: 'Zed Host' });
assert.equal(parseHostJoinUrl('zapper://launch'), null, 'other zapper:// links must be ignored');
assert.deepEqual(parseHostJoinUrl(`zapper://host-join?meet=${meet}&captureToken=host-opaque-123`), { meetUrl: 'https://meet.google.com/abc-defg-hij', name: 'Host', captureToken: 'host-opaque-123' }, 'authorized host caption token carried to desktop');
assert.equal(parseHostJoinUrl(`zapper://host-join?meet=${encodeURIComponent('https://evil.example/abc-defg-hij')}`), null, 'non-Meet hosts must be rejected');
assert.equal(parseHostJoinUrl(`zapper://host-join?meet=${encodeURIComponent('https://meet.google.com/abc-defg-hij/../x')}`), null, 'only exact room links');
assert.equal(parseHostJoinUrl('https://meet.google.com/abc-defg-hij'), null, 'wrong scheme rejected');
assert.equal(sanitizeName('<script>x</script>'), 'scriptxscript');
assert.equal(sanitizeName(''), 'Host');
assert.deepEqual(parseHostControlUrl('zapper://host-mic?state=off'), { type: 'mic', on: false });
assert.deepEqual(parseHostControlUrl('zapper://host-mic?state=on'), { type: 'mic', on: true });
assert.deepEqual(parseHostControlUrl('zapper://host-leave'), { type: 'leave' });
assert.deepEqual(parseHostControlUrl('zapper://host-resume'), { type: 'resume' });
assert.equal(parseHostControlUrl('zapper://host-mic?state=maybe'), null);
assert.equal(parseHostControlUrl('zapper://launch'), null);
console.log(JSON.stringify({ ok: true, hostJoinOnlyOpensMeetRooms: true }));
