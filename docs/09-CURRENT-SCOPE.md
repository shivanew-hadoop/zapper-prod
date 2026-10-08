# Current product scope

## Implemented

- Public Zapper marketing/home page with Features, How it works, Pricing and About.
- Public participant **Launch Zapper** and **Download Zapper** actions.
- Stable GitHub Releases Windows download URL.
- Host registration/login and subscription-gated session creation.
- Role-based admin login through the same Login form.
- Admin web console for users, activity, exact subscription dates and account status.
- SQLite database on Railway persistent `/data` volume.
- Database migration from the earlier greenfield build without deleting users.
- Google Meet link/code normalization.
- Unique six-digit session PIN stored against host + Meet URL.
- Participant desktop uses Google Sign-In + PIN only; no Zapper web credentials.
- Signed short-lived desktop session authorization.
- Deepgram STT through Railway.
- Complete transcript upload on participant Leave without ending the host session.
- PDF generated and stored in SQLite with the transcript; downloads regenerate the current compact header (participant email, PIN, From/To/Duration) so older stored PDFs do not keep obsolete host metadata.
- Host-controlled sessions: participant Leave, silence, refresh and legacy expiry do not deactivate a PIN; only Host End Session does.
- Active sessions are preserved; ended session history is trimmed conservatively.
- Latest 15 transcript PDFs retained per account.
- GitHub Actions workflow that creates a Windows release from a version tag.

## Still intentionally manual

- Payment gateway checkout/webhooks (Razorpay/Stripe).
- Email verification.
- Forgot-password/reset-password email flow.

Until payment integration is added, admin controls the subscription start/end dates from the web console.
