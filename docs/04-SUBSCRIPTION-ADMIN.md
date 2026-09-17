# 4 — Subscription administration for the first release

The database already stores `subscription_status` and `subscription_valid_until_ms`. The portal price is ₹1,000/month.

Payment gateway automation is intentionally not required for the first 50–100-user test. Activate customers manually through the protected admin API.

## Activate one registered user for 30 days

From `apps/api`:

### macOS/Linux

```bash
API_BASE_URL=https://api.zapper.in \
ADMIN_KEY='YOUR_ADMIN_KEY' \
node scripts/activate-subscription.js customer@example.com 30
```

### PowerShell

```powershell
$env:API_BASE_URL="https://api.zapper.in"
$env:ADMIN_KEY="YOUR_ADMIN_KEY"
node scripts/activate-subscription.js customer@example.com 30
```

Reload the portal. The account should now show Active.

## List registered users

```powershell
$env:API_BASE_URL="https://api.zapper.in"
$env:ADMIN_KEY="YOUR_ADMIN_KEY"
node scripts/list-users.js
```

This shows the user ID, email, name, status, subscription state, expiry and creation time from SQLite.

Never put `ADMIN_KEY` in the Vercel frontend or desktop app.
