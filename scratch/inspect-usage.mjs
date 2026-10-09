process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
function getEnv(k) {
  const m = env.match(new RegExp(`^${k}=(.*)`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

const headers = {
  apikey: serviceKey,
  Authorization: 'Bearer ' + serviceKey,
  'Content-Type': 'application/json',
};

async function queryTable(table, query) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) {
    return { error: `${res.status} ${res.statusText}`, body: await res.text() };
  }
  return await res.json();
}

async function main() {
  console.log('Querying usage_events around 2026-10-06 09:46 to 09:48 UTC...');
  const usage = await queryTable(
    'usage_events',
    'created_at=gte.2026-10-06T09:45:00Z&created_at=lte.2026-10-06T09:50:00Z&order=created_at.asc'
  );
  console.log('usage_events count:', Array.isArray(usage) ? usage.length : usage);
  console.log('usage_events:', JSON.stringify(usage, null, 2));
}

main().catch(console.error);

