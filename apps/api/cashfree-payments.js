'use strict';

// Optional Cashfree hosted checkout. No subscription is activated from a client
// callback: only a PAID order independently confirmed via Cashfree's server API.
const crypto = require('node:crypto');
const API_VERSION = '2025-01-01';
const PLANS = Object.freeze({
  month1: Object.freeze({ months: 1, amount: 999, discountPercent: 0 }),
  month3: Object.freeze({ months: 3, amount: 2697, discountPercent: 10 }),
  month6: Object.freeze({ months: 6, amount: 5095, discountPercent: 15 }),
});
function addCalendarMonths(ms, count) {
  const date = new Date(ms);
  const day = date.getUTCDate();
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count + 1, 0,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  return Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(day, end.getUTCDate()),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}
function signatureValid(secret, timestamp, rawBody, signature) {
  if (!timestamp || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(timestamp)).update(rawBody).digest();
  let received;
  try { received = Buffer.from(String(signature), 'base64'); } catch (_) { return false; }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
function installCashfreePayments({ app, db, auth, publicUser, fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cashfree_orders (
    order_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan_id TEXT NOT NULL,
    months INTEGER NOT NULL,
    amount_inr INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    created_at_ms INTEGER NOT NULL,
    paid_at_ms INTEGER,
    applied_until_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_cashfree_orders_user ON cashfree_orders(user_id,created_at_ms DESC);`);

  const clientId = String(process.env.CASHFREE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.CASHFREE_CLIENT_SECRET || '').trim();
  const mode = String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  const configured = !!(clientId && clientSecret);
  const apiBase = mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const webBase = String(process.env.WEB_APP_URL || 'https://www.zapperapp.in').replace(/\/+$/, '');
  const apiPublicBase = String(process.env.PUBLIC_API_URL || 'https://api.zapperapp.in').replace(/\/+$/, '');
  const orderStatement = db.prepare('SELECT * FROM cashfree_orders WHERE order_id=?');
  const state = () => ({ ok: true, configured, mode, plans: Object.entries(PLANS).map(([id, plan]) => ({ id, ...plan })) });
  app.get('/api/payments/config', (_req, res) => res.json(state()));

  async function cashfreeRequest(path, method = 'GET', body) {
    if (!configured) throw new Error('Online checkout is not configured yet. Contact Zapper support.');
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { 'x-client-id': clientId, 'x-client-secret': clientSecret, 'x-api-version': API_VERSION,
        'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('[CASHFREE] Provider rejected request:', response.status, data.type || '');
      const error = new Error('Payment provider request failed. Please try again or contact support.');
      error.providerStatus = response.status;
      throw error;
    }
    return data;
  }

  // A completed order may reach us from a signed webhook or an authenticated
  // browser return. Both paths verify the authoritative order with Cashfree.
  async function reconcile(orderId) {
    const local = orderStatement.get(orderId);
    if (!local) return null;
    if (local.status === 'paid') return local;
    const remote = await cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`);
    if (remote.order_id !== local.order_id || String(remote.order_currency).toUpperCase() !== 'INR' ||
        Math.round(Number(remote.order_amount) * 100) !== local.amount_inr * 100 ||
        String(remote.order_status).toUpperCase() !== 'PAID') return local;

    // Atomic and idempotent: multiple browser requests and webhook retries
    // cannot extend the subscription twice for the same Cashfree order.
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = orderStatement.get(orderId);
      if (existing?.status !== 'paid') {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(existing.user_id);
        if (!user) throw new Error('Paid order references an unknown user');
        const now = Date.now();
        const previousUntil = Number(user.subscription_valid_until_ms || 0);
        const base = Math.max(now, previousUntil);
        const until = addCalendarMonths(base, existing.months);
        const beganAt = previousUntil > now && Number(user.subscription_started_at_ms || 0)
          ? Number(user.subscription_started_at_ms) : now;
        // Account enablement is independent: a disabled user must stay disabled.
        db.prepare(`UPDATE users SET subscription_status='active',subscription_started_at_ms=?,subscription_valid_until_ms=? WHERE id=?`)
          .run(beganAt, until, user.id);
        db.prepare(`UPDATE cashfree_orders SET status='paid',paid_at_ms=?,applied_until_ms=? WHERE order_id=? AND status<>'paid'`)
          .run(now, until, orderId);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return orderStatement.get(orderId);
  }

  app.post('/api/payments/create-order', auth, async (req, res) => {
    if (req.authUser.role !== 'host') return res.status(403).json({ ok: false, error: 'Only host accounts can purchase a subscription.' });
    if (!configured) return res.status(503).json({ ok: false, error: 'Secure checkout is not configured yet. Contact Zapper support.' });
    const planId = String(req.body?.planId || '');
    const plan = PLANS[planId];
    const phone = String(req.body?.phone || '').replace(/[\s-]/g, '').replace(/^\+91/, '');
    if (!plan) return res.status(400).json({ ok: false, error: 'Please choose a valid plan.' });
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Enter a valid 10-digit Indian mobile number for payment.' });
    const orderId = `zap_${Date.now()}_${crypto.randomBytes(9).toString('hex')}`;
    const now = Date.now();
    // Keep a durable record before calling the provider; no entitlement here.
    db.prepare(`INSERT INTO cashfree_orders(order_id,user_id,plan_id,months,amount_inr,customer_phone,status,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?)`).run(orderId, req.authUser.id, planId, plan.months, plan.amount, phone, 'created', now);
    try {
      const remote = await cashfreeRequest('/orders', 'POST', {
        order_id: orderId, order_amount: plan.amount, order_currency: 'INR',
        customer_details: { customer_id: `host_${req.authUser.id}`, customer_name: req.authUser.name || 'Zapper Host',
          customer_email: req.authUser.email, customer_phone: phone },
        order_meta: { return_url: `${webBase}/?payment_return=1&order_id={order_id}`,
          notify_url: `${apiPublicBase}/api/payments/cashfree/webhook` },
        order_note: `Zapper ${plan.months}-month host subscription`,
        order_tags: { plan_id: planId },
      });
      if (remote.order_id !== orderId || !remote.payment_session_id) throw new Error('Provider response did not include a usable checkout session');
      return res.json({ ok: true, orderId, paymentSessionId: remote.payment_session_id, mode,
        plan: { id: planId, ...plan } });
    } catch (error) {
      console.error('[CASHFREE] Order initialization failed:', error.message);
      return res.status(502).json({ ok: false, error: 'Could not start secure checkout. No subscription changes were made.' });
    }
  });

  app.get('/api/payments/orders/:orderId/verify', auth, async (req, res) => {
    const order = orderStatement.get(String(req.params.orderId));
    if (!order || Number(order.user_id) !== Number(req.authUser.id)) return res.status(404).json({ ok: false, error: 'Order not found.' });
    try {
      const updated = await reconcile(order.order_id);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.authUser.id);
      return res.json({ ok: true, orderId: updated.order_id, status: updated.status,
        subscriptionValidUntil: user.subscription_valid_until_ms, user: publicUser(user) });
    } catch (error) {
      console.error('[CASHFREE] Payment verification unavailable:', error.message);
      return res.status(503).json({ ok: false, error: 'Payment verification is temporarily unavailable. Please retry; you will not be charged again.' });
    }
  });

  // This route is installed BEFORE express.json(), preserving signed raw bytes.
  app.post('/api/payments/cashfree/webhook', async (req, res) => {
    const raw = req.body;
    if (!configured || !signatureValid(clientSecret, req.headers['x-webhook-timestamp'], raw, req.headers['x-webhook-signature'])) {
      return res.status(401).json({ ok: false });
    }
    try {
      const event = JSON.parse(raw.toString('utf8'));
      const orderId = String(event?.data?.order?.order_id || '');
      if (/^PAYMENT_SUCCESS/i.test(String(event.type || '')) && orderId && orderStatement.get(orderId)) await reconcile(orderId);
      return res.json({ ok: true });
    } catch (error) {
      console.error('[CASHFREE] Signed webhook failed:', error.message);
      return res.status(503).json({ ok: false });
    }
  });

  return { plans: PLANS, reconcile };
}
module.exports = { installCashfreePayments, addCalendarMonths, signatureValid, PLANS };
