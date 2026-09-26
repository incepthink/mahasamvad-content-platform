process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/^RUNPOD_API_KEY=(.+)/m)[1].trim();

async function check() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + key,
  };

  const initRes = await fetch('https://mcp.getrunpod.io/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'antigravity', version: '1.0.0' },
      },
    }),
  });
  console.log('Init status:', initRes.status);
  const initText = await initRes.text();
  console.log('Init response:', initText);

  // Parse SSE or JSON
  const toolsRes = await fetch('https://mcp.getrunpod.io/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });
  console.log('Tools status:', toolsRes.status);
  const toolsText = await toolsRes.text();
  console.log('Tools response:', toolsText);
}

check().catch(console.error);
