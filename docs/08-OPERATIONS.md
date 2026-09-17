# Operations / backup

- Keep `JWT_SECRET` stable. Changing it signs every existing portal/desktop token out.
- Never expose `ADMIN_KEY` in browser code, desktop code, screenshots or GitHub.
- Keep `DEEPGRAM_API_KEY` only in Railway variables.
- Use the Railway persistent volume for `/data`; a service redeploy without the volume would otherwise create a new empty database.
- Enable Railway volume backups before onboarding real customers.
- Export/copy the SQLite database periodically if you need an additional off-platform backup.
- For the initial 50–100 users, one SQLite database is sufficient; do not run multiple API replicas against the same SQLite volume.
- If you later need horizontal scaling, move the account/session/transcript data to Postgres before adding API replicas.
