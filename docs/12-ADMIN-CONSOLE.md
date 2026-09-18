# Admin console

Admin does not use a separate website. It uses the normal **Host login** form.

## Bootstrap

Set on Railway:

```text
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=<8+ chars>
ADMIN_NAME=Zapper Admin
```

If the email already exists, the backend promotes it to `admin` and does not replace the existing password. If it does not exist, the backend creates the admin with `ADMIN_PASSWORD`.

## Admin capabilities

- View up to 500 registered users.
- Search by name/email.
- See account status and role.
- See subscription start/end and approximate months.
- See last activity, total retained sessions and transcript PDFs.
- Set exact subscription start/end.
- Extend or reduce end date by 30 days using convenience buttons.
- Mark subscription active/inactive.
- Disable/reactivate host accounts.
- Inspect latest retained session activity.

`ADMIN_KEY` remains supported only for CLI/automation scripts. It is never exposed to the browser.
