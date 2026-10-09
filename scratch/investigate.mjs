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

const TARGET_ID = '693758f9-06af-4a14-aef1-c291faa7492a';

async function queryTable(table, query) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, { headers });
    if (!res.ok) {
      return { error: `${res.status} ${res.statusText}`, body: await res.text() };
    }
    return await res.json();
  } catch (err) {
    return { error: err.message, cause: err.cause?.message || err.cause };
  }
}

async function main() {
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Checking TARGET_ID: ${TARGET_ID}`);

  console.log('\n--- generations ---');
  const gen = await queryTable('generations', `id=eq.${TARGET_ID}`);
  console.log('generations result:', JSON.stringify(gen, null, 2));

  console.log('\n--- activity_events by subject_id ---');
  const act = await queryTable('activity_events', `subject_id=eq.${TARGET_ID}`);
  console.log('activity_events result:', JSON.stringify(act, null, 2));

  console.log('\n--- dlo_intakes ---');
  const dlo = await queryTable('dlo_intakes', `id=eq.${TARGET_ID}`);
  console.log('dlo_intakes result:', JSON.stringify(dlo, null, 2));

  console.log('\n--- generation_revisions ---');
  const rev = await queryTable('generation_revisions', `generation_id=eq.${TARGET_ID}`);
  console.log('generation_revisions count:', Array.isArray(rev) ? rev.length : rev);
  if (Array.isArray(rev) && rev.length > 0) {
    console.log(JSON.stringify(rev, null, 2));
  }

  console.log('\n--- video_projects ---');
  const vid = await queryTable('video_projects', `id=eq.${TARGET_ID}`);
  console.log('video_projects result:', JSON.stringify(vid, null, 2));

  console.log('\n--- transcriptions ---');
  const trans = await queryTable('transcriptions', `id=eq.${TARGET_ID}`);
  console.log('transcriptions result:', JSON.stringify(trans, null, 2));
}

main().catch(console.error);
