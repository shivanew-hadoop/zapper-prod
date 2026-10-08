# Zapper Platform — complete product build

Greenfield Zapper repository with three independently deployable applications.

- `apps/api` — Railway API + SQLite volume + Deepgram relay + host subscriptions + admin console APIs + 6-digit PINs + stored PDF transcripts.
- `apps/web` — Vercel website. Public marketing/participant launch, host registration/login/dashboard and role-based admin console.
- `apps/desktop` — Electron desktop app. No Zapper account login: Google Sign-In when required, then 6-digit PIN only.

## Production endpoints

- Website: `https://zapperapp.in` (keep using the Vercel preview URL until final acceptance testing is complete)
- API: `https://api.zapperapp.in`
- Desktop protocol: `zapper://launch`
- Windows download: GitHub Releases asset `Zapper-Setup-x64.exe`

## Roles and flow

### Participant
1. Opens the public website.
2. Clicks **Launch Zapper** if installed or **Download Zapper** otherwise.
3. Desktop verifies Google sign-in; the Google Sign-In window is left open until the participant closes it manually.
4. Participant enters the host's 6-digit PIN.
5. API resolves the Meet URL and authorizes transcription. No Zapper portal account is required.

### Host
1. Registers/logs in on the website.
2. Active subscription is required to create a session.
3. Enters a Meet ID/link and receives a 6-digit PIN.
4. Shares the PIN with the participant and can end the session at any time to invalidate that PIN.
5. On desktop Leave, the complete transcript and generated PDF are saved under the host account.
6. Participant Leave/reopen and host browser refresh do not end the PIN. Only Host **End Session** invalidates it.
7. The portal shows the latest session history and retains the latest 15 transcript PDFs; active sessions are never auto-deleted.

### Admin
1. Uses the same website Login form.
2. `ADMIN_EMAIL` marks the account as admin.
3. Admin sees all users, account state, subscription start/end dates, last activity, session count and transcript count.
4. Admin can set exact start/end dates, extend/reduce dates and disable/reactivate host accounts.

## Start here

Read `docs/10-COMPLETE-PRODUCT.md` for the deployment/update sequence and `docs/11-GITHUB-RELEASES.md` for the Windows download workflow.

## Verification

```bash
cd apps/api
node tests/smoke.js
```

The smoke test validates admin login, host registration, host-controlled PIN lifecycle, participant leave/rejoin, host End Session invalidation, compact PDF generation and admin activity reporting.


## v3.1.6 focused web/auth/live-navigation update

- Google Sign-In no longer pushes an active participant session back to Start Session.
- Persistent public navigation/footer with Launch/Download access, professional product sections and dedicated policy URLs.
- Forgot Password reset-link flow plus admin-set password control.
- Existing host-controlled session/PIN/STT/PDF behavior retained.
- See `docs/17-v3.1.6-WEB-AUTH-LIVE-NAV.md`.

## v3.1.5 host-controlled session/PDF patch

This build keeps the v3.1.4 overlay/UI behavior and changes only session lifecycle ownership plus PDF header regeneration. Active PINs stay valid across participant Leave/reopen and host browser refresh; only Host **End Session** deactivates them. PDF downloads use the compact participant/timing header even for transcripts stored by older builds.
