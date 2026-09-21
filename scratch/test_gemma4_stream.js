process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/RUNPOD_API_KEY=(.+)/);
const key = match[1].trim();

async function main() {
  console.log('Testing streaming SSE on Runpod Serverless...');
  const res = await fetch('https://api.runpod.ai/v2/mnipu7ao8cf6bg/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model: 'google/gemma-4-31B-it',
      messages: [
        { role: 'user', content: 'नमस्कार, दोन ओळींत स्वतःचा परिचय द्या.' }
      ],
      max_tokens: 100,
      stream: true
    })
  });

  console.log('Stream HTTP status:', res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const json = JSON.parse(line.slice(6));
          const delta = json.choices?.[0]?.delta?.content || '';
          full += delta;
          process.stdout.write(delta);
        } catch (e) {}
      }
    }
  }
  console.log('\n--- Done streaming ---');
}

main().catch(console.error);

