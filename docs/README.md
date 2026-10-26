# Zapper v4.2.1 — deployment and release guide

Base: **v4.2.0**. Scope: six-month discount (15%), displayed `Create Session` navigation labels, and a separate public Schedule a Demo form. Existing login, registration/trial, subscription validation, Cashfree server-side payment verification, Google OAuth, live audio transport, PIN/session management, admin dashboard and PDF output logic are unchanged. Desktop runtime unchanged; desktop package version aligned.

## Pricing (server authoritative)

| Plan | Price | Discount | Billing |
| --- | ---: | ---: | --- |
| 1 month | ₹999 | none | one-time |
| 3 months | ₹2,697 | 10% | one-time |
| 6 months | ₹5,095 | 15% off ₹5,994, rounded | one-time |

Server-side amounts live in `apps/api/cashfree-payments.js`; website and Billing/Refund pages display those amounts. New pricing applies to **new orders only**. Existing paid orders and subscription expiry dates must not be rewritten. Once Cashfree verifies an order is PAID, the backend atomically applies the purchased months to that host **once**.

## Schedule a Demo email delivery

The public demo form is available from the desktop header, mobile navigation, homepage support panel and footer. It requests email, an optional phone number, and a short use case. Submissions go via `POST /api/demo/request` to **zapperapp.supported@gmail.com**. The request is validated and rate limited (five per IP address per hour); it contains a hidden spam honeypot, uses `reply_to` for the visitor, and **is not stored in the users database**.

Demo emailing reuses the existing optional **Resend** email provider (the same one used for password resets). On Railway API **Variables** configure:

- `RESEND_API_KEY`: a Resend API key permitted to send email.
- `DEMO_FROM_EMAIL`: a sender on your **verified domain**, e.g. `Zapper <no-reply@zapperapp.in>`. When omitted, uses the existing `PASSWORD_RESET_FROM` setting, which may already work if password-reset emails are configured.

Verify your sender domain in Resend, including the DNS records Resend requests. Without valid credentials, the form intentionally shows an error and asks visitors to email support directly; it **does not claim delivery**. Do not put email API credentials in Vercel variables, source files or the browser.

**Test demo delivery:** Deploy Railway and Vercel; open the public website incognito, select Schedule a Demo, submit a real email and use case, then confirm an email arrives at `zapperapp.supported@gmail.com` (including Spam folder if necessary). The received email should show the submitted message and `Reply-To` visitor email. Also test phone left blank and an invalid email. If no message arrives, check Railway deployment logs and Resend's email activity. Provider acceptance is not a guaranteed inbox delivery.

## Cashfree — sandbox to production checklist

1. Open the [Cashfree Merchant Dashboard](https://merchant.cashfree.com/). Complete merchant/business verification, bank settlement/KYC information, and website review. The public website must serve Pricing, [Billing](https://www.zapperapp.in/billing.html), [Refund](https://www.zapperapp.in/refund.html), [Terms](https://www.zapperapp.in/terms.html), [Privacy](https://www.zapperapp.in/privacy.html), [Contact](https://www.zapperapp.in/contact.html), and [Digital delivery](https://www.zapperapp.in/delivery.html) without login. Use accurate legal/business details; no code can guarantee merchant approval.
2. In **Cashfree Sandbox/Test**, obtain the Client ID and Client Secret. Use a separate Railway **staging environment and database volume**. Configure `CASHFREE_ENV=sandbox`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `WEB_APP_URL` (staging web origin) and `PUBLIC_API_URL` (staging API origin). Configure the Vercel staging site to use the staging API (`VITE_API_BASE_URL`) and ensure `WEB_ORIGINS` includes that staging frontend. If testing Google sign-in, use staging OAuth credentials and callback.
3. Ensure the checkout domain is configured/whitelisted with Cashfree as required by your account. Subscribe a payment-success webhook at `https://<YOUR-STAGING-API-HOST>/api/payments/cashfree/webhook`. Cashfree webhook signatures are checked, and the backend independently verifies Cashfree `PAID` order status before activation.
4. Sign in as an active/inactive test host. Buy **each** of the three plans (including ₹5,095 for six months) using Cashfree sandbox payment methods. Check that the amount Cashfree displays matches the selected plan, that a successful payment activates/extends the correct account subscription in the staging SQLite database, and that refresh/reverification does not apply the same order twice. Test cancellation, failures, pending payments and webhook retries: unpaid orders must not enable access.
5. Test the existing Zapper login, trial, Google Meet creation, unique PIN, multi-device sessions, real-time captions and saved PDF. Confirm staging has **not** changed the production database. Review Cashfree order and settlement/reconciliation records.
6. Once Cashfree merchant approval and staging testing are complete, merge the tested commit to `main`, deploy Railway production and Vercel production. On **Railway production only**, configure live `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV=production`, `WEB_APP_URL=https://www.zapperapp.in`, `PUBLIC_API_URL=https://api.zapperapp.in` and your existing `WEB_ORIGINS`. Configure the production payment webhook as `https://api.zapperapp.in/api/payments/cashfree/webhook`. **Do not overwrite Railway `/data`, production JWT secret, or Google OAuth credentials.**
7. Carry out a controlled real purchase with the merchant account authorized for live processing. Confirm the status is PAID in Cashfree, the `cashfree_orders` record is paid, and the host's `subscription_started_at_ms` and `subscription_valid_until_ms` are updated exactly once. Test your actual business refund/reconciliation procedure separately.

Official checkout: https://www.cashfree.com/devstudio/preview/pg/web/checkout . Sandbox orders and provider-mocked unit tests cannot verify production settlement. Card details are handled by Cashfree hosted checkout, not Zapper.

## Responsiveness and capacity

This release **does not alter login queries, password verification, dashboard fetches, session polling or Deepgram streaming**. Demo request networking happens only when someone submits that form. Response time and support for 100+ users depend on Railway instance resources, SQLite write concurrency, Deepgram concurrency and network latency. Do not claim a 100-user performance SLA without a load test. Before launch, profile browser Network timing and Railway CPU/RAM/SQLite locks; load test 100 concurrent host/dashboard views and realistic streaming session volumes in staging. Staging should have separate storage and secrets. Do not run load tests against the production database.

## Checks to repeat after deployment

- Desktop/mobile navigation: Create Session button shows the new label and still opens the original host/admin portal. Registration and login unchanged.
- Six-month plan displays ₹5,095 (15%) on website and Cashfree order; one- and three-month plans unchanged. Billing/Refund pages match.
- Schedule a Demo form sends one email to the intended inbox and shows real success/failure feedback; footer/mobile shortcuts work.
- Existing trials, subscriptions, PIN copying, session End/Cancel, Google OAuth, transcript delivery and PDF download still work. API health reports v4.2.1.

Local automated payment and demo tests use mock providers. **Real email inbox delivery, payment settlement, 100+ user latency and cross-device audio remain production/staging verification tasks.**
