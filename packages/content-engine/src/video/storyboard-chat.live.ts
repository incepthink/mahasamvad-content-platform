// LIVE check of STORYBOARD MODE against the real OpenAI API (cents; no image is rendered —
// the image tool is answered by a stub, so only text tokens are billed).
//
// Run from packages/content-engine:
//   npx tsx --env-file=../../.env src/video/storyboard-chat.live.ts
//
// Proves what the no-network test cannot: that the configured model accepts this request shape
// (a strict function tool, streaming, tool_choice), that it writes a storyboard with separated
// scenes, that a continued turn works off previous_response_id, and that it CALLS the image
// tool only when a picture is explicitly asked for.

import { runStoryboardTurn, STORYBOARD_CHAT_MODEL } from './storyboard-chat.js';
import type {
  StoryboardChatTurn,
  StoryboardImageRequest,
} from './storyboard-chat.js';

async function main(): Promise<void> {
  console.log(`model: ${STORYBOARD_CHAT_MODEL}`);
  const asked: StoryboardImageRequest[] = [];
  const stub = async (request: StoryboardImageRequest) => {
    asked.push(request);
    return {
      id: `stub-${asked.length}`,
      url: 'https://example.test/stub.png',
      label: request.label,
      prompt: request.prompt,
    };
  };

  const first: StoryboardChatTurn[] = [
    {
      role: 'user',
      content:
        'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजनेवर ३० सेकंदांच्या व्हिडिओचा ४ दृश्यांचा स्टोरीबोर्ड तयार करा. योजनेत २ लाखांपर्यंत कर्जमाफी आहे आणि अर्जाची अंतिम तारीख ३१ ऑगस्ट २०२६ आहे.',
    },
  ];
  const started = Date.now();
  const one = await runStoryboardTurn({
    turns: first,
    onDelta: () => undefined,
    generateImage: stub,
  });
  console.log(`\n--- turn 1 (${Date.now() - started} ms) ---\n${one.text}`);
  const headings = one.text
    .split('\n')
    .filter((line) => /^#{2,4}\s/.test(line));
  console.log(
    `\nheadings=${headings.length} rules=${(one.text.match(/^---$/gm) ?? []).length} images=${asked.length}`,
  );

  const second: StoryboardChatTurn[] = [
    ...first,
    { role: 'assistant', content: one.text },
    { role: 'user', content: 'सुरुवातीच्या दृश्याचे एक चित्र तयार करा.' },
  ];
  const two = await runStoryboardTurn({
    turns: second,
    previousResponseId: one.responseId,
    onDelta: () => undefined,
    generateImage: stub,
  });
  console.log(`\n--- turn 2 ---\n${two.text}`);
  console.log(`\nimage calls after an explicit ask: ${asked.length}`);
  for (const request of asked) console.log(JSON.stringify(request));

  const outOfScope: StoryboardChatTurn[] = [
    { role: 'user', content: 'मला पुण्यातील हवामानाबद्दल माहिती द्या.' },
  ];
  const three = await runStoryboardTurn({
    turns: outOfScope,
    onDelta: () => undefined,
    generateImage: stub,
  });
  console.log(`\n--- out of scope ---\n${three.text}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
