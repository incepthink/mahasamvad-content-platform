// These constants are the complete natural-language instructions used by the
// active /video text-generation flow. Output structure is supplied separately
// through the API's structured-output schema.

import { pathToFileURL } from 'node:url';
import type {
  AnyChatMessage,
  ChatContentPart,
} from '../generation/openai-chat.js';

export const NOTE_VIDEO_TASK = 'make a script from the provided text';

export const READY_SCRIPT_VIDEO_TASK =
  'make a storyboard from the Provided script. Each scene can only be up to 5 seconds, so divide the narration accordingly and create more scenes.';

// Attach reference pictures to the final user input without adding another
// textual instruction.
export function withPromptImages(
  messages: readonly AnyChatMessage[],
  imageUrls: readonly string[],
): AnyChatMessage[] {
  if (imageUrls.length === 0) return [...messages];
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  if (lastUser === -1) return [...messages];
  const target = messages[lastUser]!;
  const textParts: ChatContentPart[] =
    typeof target.content === 'string'
      ? [{ type: 'text', text: target.content }]
      : [...target.content];
  return messages.map((message, index) =>
    index === lastUser
      ? {
          role: message.role,
          content: [
            ...textParts,
            ...imageUrls.map((url): ChatContentPart => ({
              type: 'image_url',
              image_url: { url },
            })),
          ],
        }
      : message,
  );
}

// Free prompt-contract harness:
//   npx tsx src/video/script-brief.ts
function check(): void {
  const failures: string[] = [];
  const assert = (label: string, condition: boolean) => {
    if (!condition) failures.push(label);
  };

  assert(
    'the note lane uses only the requested instruction',
    NOTE_VIDEO_TASK === 'make a script from the provided text',
  );
  assert(
    'the ready-script lane uses only the requested instruction',
    READY_SCRIPT_VIDEO_TASK ===
      'make a storyboard from the Provided script. Each scene can only be up to 5 seconds, so divide the narration accordingly and create more scenes.',
  );

  const messages: AnyChatMessage[] = [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ];
  assert(
    'no images leaves the turn a plain string',
    withPromptImages(messages, [])[1]!.content === 'U',
  );
  const attached = withPromptImages(messages, [
    'https://x/a.png',
    'https://x/b.png',
  ]);
  assert('the system turn is untouched', attached[0]!.content === 'S');
  const parts = attached[1]!.content as readonly ChatContentPart[];
  assert('the text survives first', parts[0]!.type === 'text');
  assert(
    'both pictures are attached in order without extra text',
    parts.length === 3 &&
      parts[1]!.type === 'image_url' &&
      (parts[1] as { image_url: { url: string } }).image_url.url ===
        'https://x/a.png' &&
      parts[2]!.type === 'image_url' &&
      (parts[2] as { image_url: { url: string } }).image_url.url ===
        'https://x/b.png',
  );

  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('script-brief: all checks passed.');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  check();
}
