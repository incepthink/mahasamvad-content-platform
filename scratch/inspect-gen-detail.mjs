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

async function main() {
  const res = await fetch(`${supabaseUrl}/rest/v1/generations?id=eq.693758f9-06af-4a14-aef1-c291faa7492a`, { headers });
  const row = (await res.json())[0];
  console.log('ID:', row.id);
  console.log('Title:', row.title);
  console.log('Status:', row.status);
  console.log('Created At:', row.created_at);
  console.log('Updated At:', row.updated_at);
  console.log('Cost Breakdown:', JSON.stringify(row.cost_breakdown, null, 2));
  console.log('Article snippet:', (row.article || '').slice(0, 300));
}

main().catch(console.error);

