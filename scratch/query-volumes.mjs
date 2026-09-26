import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/^RUNPOD_API_KEY=(.+)/m)[1].trim();

async function check() {
  const query = `
    query {
      myself {
        networkVolumes {
          id
          name
          size
          dataCenterId
        }
      }
    }
  `;
  const res = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

check().catch(console.error);
