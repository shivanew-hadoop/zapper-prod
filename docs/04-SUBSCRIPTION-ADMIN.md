# 4 — Subscription administration

Admin now has a browser console. No admin key is exposed to the web app.

## Admin login

Set Railway `ADMIN_EMAIL`. Sign in through the same normal website Login form. The backend returns role `admin`, and the frontend opens the admin console automatically.

## Admin can

- View/search registered users by name/email.
- See account status and role.
- See subscription start/end dates and approximate months.
- See latest activity, retained session count and transcript PDF count.
- Set exact subscription start/end dates.
- Add or subtract 30 days quickly.
- Mark a subscription active/inactive.
- Disable or reactivate a host account.
- Inspect recent session activity.

## CLI fallback

`ADMIN_KEY` still supports automation scripts without exposing the key to Vercel:

```powershell
$env:API_BASE_URL="https://api.zapperapp.in"
$env:ADMIN_KEY="YOUR_ADMIN_KEY"
node scripts/list-users.js
node scripts/activate-subscription.js customer@example.com 30
```
