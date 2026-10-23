'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { installDemoInquiries, validateInquiry, DEMO_RECIPIENT } = require('../demo-inquiries');

function harness({ configured = true, providerStatus = 200, responseId = 'sent_test' } = {}) {
  let handler; const messages = [];
  const app = { post(route, ...middleware) {
    assert.equal(route, '/api/demo/request');
    handler = middleware.at(-1);
  } };
  const env = configured ? { RESEND_API_KEY: 'secret-key', PASSWORD_RESET_FROM: 'Zapper <no-reply@zapperapp.in>' } : {};
  installDemoInquiries({ app, env, fetchImpl: async (_url, opts) => {
    messages.push(JSON.parse(opts.body));
    assert.equal(opts.headers.Authorization, 'Bearer secret-key');
    return { ok: providerStatus === 200, status: providerStatus, json: async () => ({ id: responseId }) };
  } });
  async function post(body) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ body }, res);
    return res;
  }
  return { post, messages };
}
const form = { email: 'visitor@example.com', phone: '+91 93460 73219', useCase: 'We need meeting transcription for our team.' };
test('demo contact validation does not accept malformed or oversized input', () => {
  assert.throws(() => validateInquiry({ ...form, email: 'not-email' }));
  assert.throws(() => validateInquiry({ ...form, phone: 'invalid phone!' }));
  assert.throws(() => validateInquiry({ ...form, useCase: 'short' }));
  assert.deepEqual(validateInquiry({ ...form, website: 'bot.example' }), { ignored: true });
});
test('one request sends exactly one email to the intended inbox with reply-to visitor', async () => {
  const ctx = harness();
  const response = await ctx.post(form);
  assert.equal(response.statusCode, 200);
  assert.equal(response.data.ok, true);
  assert.equal(ctx.messages.length, 1);
  assert.deepEqual(ctx.messages[0].to, [DEMO_RECIPIENT]);
  assert.equal(ctx.messages[0].reply_to, form.email);
  assert.match(ctx.messages[0].text, /meeting transcription/);
});
test('no sender credentials or failed provider never reports a successful send', async () => {
  const missing = harness({ configured: false });
  assert.equal((await missing.post(form)).statusCode, 503);
  assert.equal(missing.messages.length, 0);
  const failed = harness({ providerStatus: 403 });
  assert.equal((await failed.post(form)).statusCode, 502);
  assert.equal((await harness({ responseId: '' }).post(form)).statusCode, 502);
});
test('honeypot requests are ignored without provider calls', async () => {
  const ctx = harness();
  const result = await ctx.post({ ...form, website: 'some spam' });
  assert.equal(result.statusCode, 200);
  assert.equal(ctx.messages.length, 0);
});
