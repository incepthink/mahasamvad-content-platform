import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/^RUNPOD_API_KEY=(.+)/m)[1].trim();

async function check() {
  const queries = [
    `query { myself { invoices { id amount createdAt } } }`,
    `query { myself { billingHistory { id amount createdAt } } }`,
    `query { myself { transactions { id amount createdAt } } }`,
    `query { myself { balanceHistory { id amount createdAt } } }`,
    `query { myself { userSpend { currentMonth previousMonth } } }`
  ];
  for (const q of queries) {
    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({ query: q }),
    });
    const data = await res.json();
    console.log('Query:', q.slice(17, 40), 'Result:', data);
  }
}

check().catch(console.error);
