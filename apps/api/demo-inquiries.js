'use strict';

// Public demo requests are separate from host authentication, checkout and
// transcription. Delivery uses the same optional Resend provider already used
// for password reset, without storing inquiries in the user database.
const DEMO_RECIPIENT = 'zapperapp.supported@gmail.com';
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function validateInquiry(body = {}) {
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const useCase = String(body.useCase || '').trim();
  const website = String(body.website || '').trim(); // hidden honeypot
  if (website) return { ignored: true };
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.');
  if (phone && (phone.length > 24 || !/^\+?[\d\s().-]{7,24}$/.test(phone))) throw new Error('Enter a valid phone number or leave it blank.');
  if (useCase.length < 10 || useCase.length > 2000) throw new Error('Tell us about your use case (10–2,000 characters).');
  return { email, phone, useCase };
}

function installDemoInquiries({ app, rateLimit = (_req, _res, next) => next(), fetchImpl = fetch,
  env = process.env } = {}) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const sender = String(env.DEMO_FROM_EMAIL || env.PASSWORD_RESET_FROM || 'Zapper <no-reply@zapperapp.in>').trim();
  app.post('/api/demo/request', rateLimit, async (req, res) => {
    let inquiry;
    try { inquiry = validateInquiry(req.body); }
    catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
    if (inquiry.ignored) return res.json({ ok: true, message: 'Request received.' });
    if (!apiKey) return res.status(503).json({ ok: false, error: 'Demo requests are temporarily unavailable. Please contact Zapper support directly.' });
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: sender,
          to: [DEMO_RECIPIENT],
          reply_to: inquiry.email,
          subject: 'New Zapper demo request',
          text: `A visitor requested a Zapper demo.\n\nEmail: ${inquiry.email}\nPhone: ${inquiry.phone || 'Not provided'}\n\nHow they plan to use Zapper:\n${inquiry.useCase}\n`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.error('[DEMO] Email provider rejected request:', response.status);
        return res.status(502).json({ ok: false, error: 'Could not send the request. Please email Zapper support directly.' });
      }
      const data = await response.json().catch(() => ({}));
      if (!data.id) {
        console.error('[DEMO] Email provider did not confirm a message ID.');
        return res.status(502).json({ ok: false, error: 'Email delivery was not confirmed. Please email Zapper support directly.' });
      }
      return res.json({ ok: true, message: 'Your request was sent. We will contact you by email.' });
    } catch (error) {
      console.error('[DEMO] Email delivery error:', error.name || 'Error');
      return res.status(502).json({ ok: false, error: 'Could not send the request. Please email Zapper support directly.' });
    }
  });
}

module.exports = { installDemoInquiries, validateInquiry, DEMO_RECIPIENT };
