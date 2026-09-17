# Current production scope

## Implemented now

- New repository layout with separate API, web and desktop applications.
- Email/password registration and login.
- SQLite user database on a Railway volume.
- User name/email/subscription records.
- Manual subscription activation/renewal for the ₹1,000/month plan.
- Google Meet link/code normalization.
- Unique 6-digit host session PIN.
- Desktop Google sign-in + PIN-only launch flow.
- Signed short-lived desktop session authorization.
- Remote Deepgram STT through the Railway backend.
- Full transcript upload on Leave.
- Backend session termination on Leave.
- Latest 20 transcript list and PDF download.
- Admin API/helper script to list registered users.

## Not automated yet

These are intentionally outside the first 50–100-user launch package and should be added after the base flow is stable:

- Razorpay/Stripe payment checkout and payment webhooks.
- Email verification.
- Forgot-password/reset-password email flow.
- Admin web dashboard (admin functions currently use protected scripts/API).
- Object storage for PDFs (PDFs are generated on demand from SQLite transcript text).

The system is usable for controlled testing without these items. Do not call the billing process fully automated until a payment provider and webhook verification are added.
