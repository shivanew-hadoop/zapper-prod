// SQLite integration tests for previously deployed registrations with missing dates.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { DatabaseSync } = require('node:sqlite');
const createSessionControl = require('../session-control');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapper-trial-persistence-'));
const dbPath = path.join(tmp, 'zapper.db');
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'host',
    status TEXT NOT NULL DEFAULT 'pending',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    trial_started_at_ms INTEGER,
    trial_ends_at_ms INTEGER,
    subscription_status TEXT NOT NULL DEFAULT 'inactive',
    subscription_started_at_ms INTEGER,
    subscription_valid_until_ms INTEGER,
    created_at_ms INTEGER NOT NULL
  );
  CREATE TABLE host_sessions(
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    pin TEXT NOT NULL UNIQUE,
    meet_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    active INTEGER NOT NULL DEFAULT 1,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER,
    participant_started_at_ms INTEGER,
    last_speech_at_ms INTEGER,
    end_reason TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
const now = Date.now();
const day = 86400000;
const recent = now - 20 * 60 * 1000;
const old = now - 3 * day;
const add = (email, createdAt, {status='active', role='host',
    trialStart=null, trialEnd=null, subStart=null, subEnd=null} = {}) => {
  return db.prepare(`INSERT INTO users(email,password_hash,name,role,status,trial_started_at_ms,trial_ends_at_ms,subscription_status,subscription_started_at_ms,subscription_valid_until_ms,created_at_ms)
       VALUES(?,?,?,?,?,?,?,'inactive',?,?,?)`).run(email,'hash',email,role,status,trialStart,trialEnd,subStart,subEnd,createdAt).lastInsertRowid;
};
const recentId = add('incomplete-recent@example.com',recent);
const oldId = add('incomplete-old@example.com',old);
const disabledId = add('incomplete-disabled@example.com',recent,{status:'disabled'});
const paidId = add('paid-history@example.com',recent,{subStart:old, subEnd:now - 2000});
const historyId = add('used-previously@example.com',recent);
const trialedId = add('trial-already-used@example.com',recent,{trialStart:old,trialEnd:old+day});
const adminId = add('already-admin@example.com',recent,{role:'admin'});
const caseId = add('MixedCase@Example.com',old);
db.prepare(`INSERT INTO host_sessions(id,user_id,pin,meet_url,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?)`)
  .run('old-session',historyId,'912345','https://meet.google.com/abc-defg-hij',recent,recent+210*60000);
db.close();
const routes = new Map();
const app = { get(route,...handlers){routes.set(`GET ${route}`,handlers)},post(route,...handlers){routes.set(`POST ${route}`,handlers)} };
process.env.JWT_SECRET = 'integration-test-secret-long-enough';
const one = createSessionControl({app,dataDir:tmp});
function row(email) { return one.db.prepare('SELECT * FROM users WHERE email=?').get(email); }
const repaired = row('incomplete-recent@example.com');
assert.equal(repaired.status,'active');
assert.equal(repaired.subscription_status,'active');
assert.equal(repaired.trial_started_at_ms,recent);
assert.equal(repaired.trial_ends_at_ms,recent+day);
assert.equal(repaired.subscription_started_at_ms,recent);
assert.equal(repaired.subscription_valid_until_ms,recent+day);
assert.equal(repaired.approval_status,'approved');
for (const id of [oldId,disabledId,paidId,historyId,trialedId,adminId]) {
  const a=one.db.prepare('SELECT * FROM users WHERE id=?').get(id);
  assert.equal(a.subscription_status,'inactive',`existing user ${id} activated`);
  assert.equal(a.trial_started_at_ms,id===trialedId ? old : null,`existing user ${id} had trial history modified`);
  if (id===paidId) assert.equal(a.subscription_started_at_ms,old);
}
assert.equal(one.db.prepare('SELECT status FROM users WHERE id=?').get(disabledId).status,'disabled');

// New records inserted via an old registration handler are repaired by the DB itself.
const insertedAt = Date.now();
const newId=one.db.prepare(`INSERT INTO users(email,password_hash,name,role,status,approval_status,subscription_status,created_at_ms)
VALUES(?,?,?,'host','pending','pending','inactive',?)`).run('old-handler-new@example.com','hash','Fresh User',insertedAt).lastInsertRowid;
const triggered=one.db.prepare('SELECT * FROM users WHERE id=?').get(newId);
assert.equal(triggered.subscription_status,'active');
assert.equal(triggered.status,'active');
assert.equal(triggered.approval_status,'approved');
assert.equal(triggered.subscription_started_at_ms,insertedAt);
assert.equal(triggered.subscription_valid_until_ms,insertedAt+day);
assert.equal(triggered.trial_started_at_ms,insertedAt);
assert.equal(triggered.trial_ends_at_ms,insertedAt+day);
// Existing duplicate email with mixed casing is rejected even if old row was uppercase.
async function invoke(method,route,body) {
  const req={body,headers:{},params:{},query:{}};
  let status=200, payload;
  const res={status(code){status=code;return this},json(v){payload=v;return this}};
  for(const fn of routes.get(`${method} ${route}`)||[]) await fn(req,res,()=>{});
  return {status,payload};
}
(async()=>{
  const duplicate = await invoke('POST','/api/auth/register',{email:'mixedcase@example.com',password:'Password123!',name:'Case Repeat'});
  assert.equal(duplicate.status,409);
  const fresh = await invoke('POST','/api/auth/register',{email:'brandnew-test@example.com',password:'Password123!',name:'Brand New'});
  assert.equal(fresh.status,200);
  assert.equal(fresh.payload?.user?.subscriptionStatus,'active');
  assert.equal(fresh.payload?.user?.subscriptionValidUntil - fresh.payload?.user?.subscriptionStartedAt,day);
  one.db.close();
  const another=createSessionControl({app:{get(){},post(){}},dataDir:tmp});
  const persisted=another.db.prepare('SELECT * FROM users WHERE id=?').get(recentId);
  assert.equal(persisted.subscription_valid_until_ms,recent+day);
  another.db.close();
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log(JSON.stringify({ok:true,version:'3.1.18',registration:true,olderAccountsUnchanged:true,recentIncompleteAccountsRepaired:true,databaseTrigger:true,duplicateEmail:true,restartPersistence:true}));
})().catch(err=>{console.error(err);process.exitCode=1});
