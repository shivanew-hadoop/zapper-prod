const assert = require('node:assert/strict');
const { createOverlayReadinessServer, parseLaunchNonce } = require('../overlay-launch-readiness');
const nonce = '8be34e97-7419-4d4d-a85c-148de44c5394';
const other = 'a183f093-6bf0-4b2a-84fd-650383834e6c';
assert.equal(parseLaunchNonce(`zapper://launch?nonce=${nonce}`), nonce);
assert.equal(parseLaunchNonce('zapper://launch'), null);
assert.equal(parseLaunchNonce('zapper://host-join?nonce=' + nonce), null);
assert.equal(parseLaunchNonce('https://zapperapp.in?nonce=' + nonce), null);
let visible = false;
const bridge = createOverlayReadinessServer(() => visible, { port: 0 });
(async () => {
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  const port = bridge.server.address().port;
  const check = async (id, origin = 'https://zapperapp.in') => {
    const r = await fetch(`http://127.0.0.1:${port}/overlay-ready?nonce=${id}`, { headers: { origin } });
    return r.status === 200 ? await r.json() : { status: r.status };
  };
  assert.deepEqual(await check(nonce), { ready: false }, 'visible alone is not a launch acknowledgement');
  visible = true;
  assert.deepEqual(await check(nonce), { ready: false }, 'old visible overlay cannot bypass fresh handshake');
  bridge.acknowledgeUrl(`zapper://launch?nonce=${nonce}`);
  assert.deepEqual(await check(other), { ready: false }, 'another request must not pass');
  assert.deepEqual(await check(nonce), { ready: true }, 'matching request and loaded/visible overlay passes');
  visible = false;
  assert.deepEqual(await check(nonce), { ready: false }, 'hidden overlay must block creation');
  assert.deepEqual(await check(nonce, 'https://evil.example'), { status: 403 }, 'not exposed to arbitrary websites');
  await new Promise(resolve => bridge.server.close(resolve));
  console.log('overlay readiness handshake: PASS');
})().catch(e => { console.error(e); bridge.server.close(); process.exitCode = 1; });
