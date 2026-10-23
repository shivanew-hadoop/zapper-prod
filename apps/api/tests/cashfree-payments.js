'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { installCashfreePayments, addCalendarMonths, signatureValid, PLANS } = require('../cashfree-payments');

const plain = value => ({ statusCode: 200, jsonValue: null, status(n) { this.statusCode = n; return this; }, json(value) { this.jsonValue = value; return this; } });
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, status TEXT, subscription_status TEXT, subscription_started_at_ms INTEGER, subscription_valid_until_ms INTEGER)`);
  db.prepare('INSERT INTO users(id,name,email,role,status,subscription_status,subscription_started_at_ms,subscription_valid_until_ms) VALUES(?,?,?,?,?,?,?,?)')
    .run(1,'Host One','one@example.com','host','active','inactive',null,null);
  db.prepare('INSERT INTO users(id,name,email,role,status,subscription_status,subscription_started_at_ms,subscription_valid_until_ms) VALUES(?,?,?,?,?,?,?,?)')
    .run(2,'Host Two','two@example.com','host','active','inactive',null,null);
  let paid = false; const routes = new Map(); let lastRequest;
  const app = { get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); }, post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); } };
  async function provider(url, opts) {
    if (url.endsWith('/orders') && opts.method === 'POST') {
      lastRequest = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ order_id: lastRequest.order_id, payment_session_id: 'sandbox_payment_session' }) };
    }
    const id = url.split('/').at(-1);
    return { ok: true, json: async () => ({ order_id: id, order_currency: 'INR',
      order_amount: lastRequest.order_amount, order_status: paid ? 'PAID' : 'ACTIVE' }) };
  }
  process.env.CASHFREE_CLIENT_ID = 'sandbox-client'; process.env.CASHFREE_CLIENT_SECRET = 'sandbox-secret';
  process.env.CASHFREE_ENV = 'sandbox';
  installCashfreePayments({ app, db, auth: (_req, _res, next) => next(),
    publicUser: user => ({ id: user.id, subscriptionStatus: user.subscription_status, subscriptionValidUntil: user.subscription_valid_until_ms }),
    fetchImpl: provider });
  async function call(method,path, userId, opts={}) {
    const handler = routes.get(`${method} ${path}`);
    assert.ok(handler,`route ${method} ${path}`);
    const request = {authUser:db.prepare('SELECT * FROM users WHERE id=?').get(userId), body:opts.body, params:opts.params||{},headers:opts.headers||{}};
    const res = plain(); await handler(request, res); return res;
  }
  return {db,call,get request(){return lastRequest},set paid(value){paid=value}};
}
test('published prices rounded and calendar month edges',()=> {
  assert.deepEqual([PLANS.month1.amount, PLANS.month3.amount, PLANS.month6.amount],[999,2697,4496]);
  assert.equal(new Date(addCalendarMonths(Date.UTC(2026,0,31),1)).toISOString(),'2026-02-28T00:00:00.000Z');
  assert.equal(new Date(addCalendarMonths(Date.UTC(2026,11,31),1)).toISOString(),'2027-01-31T00:00:00.000Z');
});
test('successful verification activates exactly once and isolates hosts',async()=> {
  const ctx=setup();
  const bad = await ctx.call('POST','/api/payments/create-order',1,{body:{planId:'month6',phone:'12'}});
  assert.equal(bad.statusCode,400);
  const start = await ctx.call('POST','/api/payments/create-order',1,{body:{planId:'month6',phone:'9346073219',amount:1}});
  assert.equal(start.statusCode,200);
  assert.equal(ctx.request.order_amount,4496);
  assert.equal(ctx.request.customer_details.customer_id,'host_1');
  const orderId=start.jsonValue.orderId;
  assert.equal(ctx.db.prepare('SELECT subscription_status FROM users WHERE id=1').get().subscription_status,'inactive');
  const wrongHost=await ctx.call('GET','/api/payments/orders/:orderId/verify',2,{params:{orderId}});
  assert.equal(wrongHost.statusCode,404);
  const pending=await ctx.call('GET','/api/payments/orders/:orderId/verify',1,{params:{orderId}});
  assert.equal(pending.jsonValue.status,'created');
  ctx.paid=true;
  const success=await ctx.call('GET','/api/payments/orders/:orderId/verify',1,{params:{orderId}});
  assert.equal(success.jsonValue.status,'paid');
  const expiry=success.jsonValue.user.subscriptionValidUntil;
  assert.ok(expiry>Date.now()+177*86400000);
  const replay=await ctx.call('GET','/api/payments/orders/:orderId/verify',1,{params:{orderId}});
  assert.equal(replay.jsonValue.user.subscriptionValidUntil,expiry,'replaying verification cannot extend subscription');
  assert.equal(ctx.db.prepare('SELECT subscription_status FROM users WHERE id=2').get().subscription_status,'inactive');
  ctx.db.close();
});
test('signed webhook rejects forged messages and valid signature still verifies provider order',async()=> {
  const ctx=setup();
  const start=await ctx.call('POST','/api/payments/create-order',1,{body:{planId:'month1',phone:'9346073219'}});
  const raw=Buffer.from(JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:start.jsonValue.orderId}}}));
  const denied=await ctx.call('POST','/api/payments/cashfree/webhook',1,{body:raw,headers:{'x-webhook-timestamp':'123','x-webhook-signature':'garbage'}});
  assert.equal(denied.statusCode,401);
  const timestamp=String(Date.now());
  const signature=crypto.createHmac('sha256','sandbox-secret').update(timestamp).update(raw).digest('base64');
  assert.equal(signatureValid('sandbox-secret',timestamp,raw,signature),true);
  // A signed webhook is insufficient without independent server-side PAID status.
  const awaiting=await ctx.call('POST','/api/payments/cashfree/webhook',1,{body:raw,headers:{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature}});
  assert.equal(awaiting.statusCode,200);
  assert.equal(ctx.db.prepare('SELECT status FROM cashfree_orders').get().status,'created');
  ctx.paid=true;
  const paid=await ctx.call('POST','/api/payments/cashfree/webhook',1,{body:raw,headers:{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature}});
  assert.equal(paid.statusCode,200);
  assert.equal(ctx.db.prepare('SELECT status FROM cashfree_orders').get().status,'paid');
  ctx.db.close();
});
