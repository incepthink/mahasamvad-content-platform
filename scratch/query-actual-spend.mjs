process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/^RUNPOD_API_KEY=(.+)/m)[1].trim();

async function callTool(name, args = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + key,
  };
  const res = await fetch('https://mcp.getrunpod.io/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const jsonLine = text.split('\n').find((l) => l.startsWith('data: '));
  if (jsonLine) {
    return JSON.parse(jsonLine.slice(6));
  }
  return text;
}

async function main() {
  console.log('--- Calling list-billing ---');
  const b = await callTool('list-billing', {});
  console.log('list-billing:', JSON.stringify(b, null, 2));

  console.log('--- Calling list-endpoint-billing ---');
  const eb = await callTool('list-endpoint-billing', {});
  console.log('list-endpoint-billing:', JSON.stringify(eb, null, 2));

  console.log('--- Calling list-pod-billing ---');
  const pb = await callTool('list-pod-billing', {});
  console.log('list-pod-billing:', JSON.stringify(pb, null, 2));

  console.log('--- Calling list-serverless-billing ---');
  const sb = await callTool('list-serverless-billing', {});
  console.log('list-serverless-billing:', JSON.stringify(sb, null, 2));
}

main().catch(console.error);
