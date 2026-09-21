process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
function getEnv(k) {
  const m = env.match(new RegExp(`^${k}=(.+)`, 'm'));
  return m ? m[1].trim() : '';
}

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

async function main() {
  console.log('Querying Supabase tables...');
  const headers = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey
  };

  const [genRes, dloRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/generations?select=id,created_at,category,title,article,source_text&limit=5&order=created_at.desc`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/dlo_intakes?select=id,created_at,notes&limit=5&order=created_at.desc`, { headers })
  ]);

  console.log('generations status:', genRes.status);
  const genData = await genRes.json();
  console.log(`generations rows returned: ${Array.isArray(genData) ? genData.length : 'error'}`);
  if (Array.isArray(genData) && genData.length > 0) {
    console.log('Sample generation title:', genData[0].title);
    console.log('Sample generation article length:', genData[0].article ? genData[0].article.length : 0);
  }

  console.log('dlo_intakes status:', dloRes.status);
  const dloData = await dloRes.json();
  console.log(`dlo_intakes rows returned: ${Array.isArray(dloData) ? dloData.length : 'error'}`);
  if (Array.isArray(dloData) && dloData.length > 0) {
    console.log('Sample dlo notes snippet:', (dloData[0].notes || '').slice(0, 100));
  }
}

main().catch(console.error);

