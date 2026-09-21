const apiKey = process.env.RUNPOD_API_KEY || process.env.GEMMA_API_KEY;
const endpointId = 'mnipu7ao8cf6bg';

async function main() {
  const query = `
    query {
      __type(name: "Endpoint") {
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  console.log('Myself endpoints:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
