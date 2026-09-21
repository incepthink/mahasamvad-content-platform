process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { writeArticleDraft, articleProvider, articleProviderModel } from '../packages/content-engine/src/generation/article-provider.js';

async function main() {
  console.log('Testing writeArticleDraft with provider:', articleProvider());
  console.log('Model:', articleProviderModel());

  const messages = [
    {
      role: 'system',
      content: 'तुम्ही महाराष्ट्र शासनाचे अधिकृत जिल्हा माहिती अधिकारी (DIO / DLO) आहात. शासकीय निर्णय (GR) आणि माहितीवरून अधिकृत, प्रभावी आणि सुटसुटीत मराठी वृत्त/लेख तयार करणे हे तुमचे काम आहे.'
    },
    {
      role: 'user',
      content: 'महाराष्ट्र शासनाने सुरू केलेल्या "मुख्यमंत्री माझी लाडकी बहीण योजना" यावर २ ओळींचे प्रसिद्धी पत्रक लिहा.'
    }
  ];

  let streamed = '';
  const result = await writeArticleDraft(messages, {
    maxTokens: 256,
    reasoningEffort: 'low',
    onDelta: (chunk) => {
      streamed += chunk;
      process.stdout.write(chunk);
    }
  });

  console.log('\n\n--- Result complete ---');
  console.log('Length:', result.length);
}

main().catch(console.error);
