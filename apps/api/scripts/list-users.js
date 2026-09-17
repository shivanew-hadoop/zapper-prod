const apiBase = String(process.env.API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const adminKey = String(process.env.ADMIN_KEY || '');
if (!adminKey) {
  console.error('Usage: ADMIN_KEY=... API_BASE_URL=https://api.zapper.in node scripts/list-users.js');
  process.exit(1);
}
fetch(`${apiBase}/api/admin/users`, { headers: { 'x-admin-key': adminKey } })
  .then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    console.table(data.users || []);
  })
  .catch(error => { console.error(error.message); process.exit(1); });
