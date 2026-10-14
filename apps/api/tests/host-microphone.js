// Regression checks for browser-host microphone authorization. Does not require
// external Google/Deepgram credentials and does not alter production databases.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.JWT_SECRET = 'host-mic-regression-key-1234567890123456789012345';
process.env.ADMIN_EMAIL = 'mic-admin@example.com';
process.env.ADMIN_PASSWORD = 'AdminPassword123!';
const createSessionControl = require('../session-control');
const routes = new Map();
const app = { get: (route,...handlers) => routes.set(`GET ${route}`,handlers), post: (route,...handlers) => routes.set(`POST ${route}`,handlers) };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapper-mic-'));
const control = createSessionControl({ app, dataDir });
async function call(method, route, { body = {}, headers = {}, params = {} } = {}) {
  let code = 200, payload;
  const req = { body, headers, params, query:{} };
  const res = { status(n){code=n;return this;}, json(data){payload=data;return this;}, set(){return this;} };
  const handlers = routes.get(`${method} ${route}`);
  assert.ok(handlers, `Missing ${method} ${route}`);
  let i=0;
  const next=()=>{ const handler=handlers[i++]; return handler && handler(req,res,next); };
  await next();
  return {code,payload};
}
(async () => {
  try {
    for (const email of ['host-one@example.com','host-two@example.com']) {
      const r = await call('POST','/api/auth/register',{body:{email,password:'Password123!',name:email}});
      assert.equal(r.code,200);
    }
    const login=async email => (await call('POST','/api/auth/login',{body:{email,password:'Password123!'}})).payload.token;
    const first=await login('host-one@example.com');
    const second=await login('host-two@example.com');
    const admin=(await call('POST','/api/auth/login',{body:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}})).payload.token;
    const session=(await call('POST','/api/sessions',{headers:{authorization:`Bearer ${first}`},body:{meetUrl:'abc-defg-hij'}})).payload.session;
    const pathToken='/api/sessions/:id/host-audio-token';
    const params={id:session.id};
    let r=await call('POST',pathToken,{params});
    assert.equal(r.code,401,'anonymous user must not capture session audio');
    r=await call('POST',pathToken,{params,headers:{authorization:`Bearer ${second}`}});
    assert.equal(r.code,404,'a different host cannot capture the first host audio session');
    r=await call('POST',pathToken,{params,headers:{authorization:`Bearer ${admin}`}});
    assert.equal(r.code,403,'admin cannot masquerade as host audio source');
    r=await call('POST',pathToken,{params,headers:{authorization:`Bearer ${first}`}});
    assert.equal(r.code,200);
    assert.ok(r.payload.captureToken,'audio capture token missing');
    assert.equal(control.verifyParticipantToken(r.payload.captureToken),null,'host token must NOT authorize PIN redemption');
    const captureToken = r.payload.captureToken;
    const hostState=control.verifyHostAudioToken(captureToken);
    assert.equal(hostState.session.id,session.id);
    assert.equal(hostState.user.email,'host-one@example.com');
    assert.equal(control.db.prepare('SELECT count(*) c FROM session_participant_seats WHERE session_id=?').get(session.id).c,0,'host capture must not consume a participant seat');
    assert.equal(control.hostAudioTokenState('invalid'),null);
    r=await call('POST','/api/sessions/:id/end',{params,headers:{authorization:`Bearer ${first}`}});
    assert.equal(r.code,200);
    assert.equal(control.verifyHostAudioToken(captureToken),null,'ended session must revoke live host microphone authorization');
    assert.equal(control.hostAudioTokenState(captureToken)?.active,false,'session ended flag must be visible to existing sockets');
    assert.equal(control.hostAudioSessionState(session.id,hostState.user.id).active,false,'socket end-session check must work without relying on original token expiry');
    const stopped = await call('POST',pathToken,{params,headers:{authorization:`Bearer ${first}`}});
    assert.equal(stopped.code,409,'ended session cannot mint new host microphone tokens');
    console.log(JSON.stringify({ok:true,version:require('../package.json').version,hostAuthorization:true,otherHostDenied:true,adminDenied:true,noParticipantSeatUsed:true,endedSessionDenied:true}));
  } finally {
    control.db.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error => {console.error(error); process.exitCode=1;});
