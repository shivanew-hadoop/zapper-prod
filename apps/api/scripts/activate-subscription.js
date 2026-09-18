const apiBase = String(process.env.API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const adminKey = String(process.env.ADMIN_KEY || '');
const email = String(process.argv[2] || '').trim();
const days = Math.max(1, Number(process.argv[3] || 30));
if (!adminKey || !email) {
  console.error('Usage: ADMIN_KEY=... API_BASE_URL=https://api.zapperapp.in node scripts/activate-subscription.js user@example.com 30');
  process.exit(1);
}
fetch(`${apiBase}/api/admin/subscription`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
  body: JSON.stringify({ email, days }),
}).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(data, null, 2));
}).catch(error => { console.error(error.message); process.exit(1); });
