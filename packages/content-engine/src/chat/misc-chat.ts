// The general assistant behind /chat.
//
// This lane is deliberately prompt-free. It sends the officer's conversation and native
// attachments to Gemini exactly as chat input; publication rules belong to the dedicated
// article/proofread surfaces, not here.
//
// PDFs are NATIVE model input. They are uploaded once through Gemini Files and referenced by
// URI here. Never route them through intake/gemini-doc.ts: that module's contract is exhaustive
// page-by-page transcription, while this surface's contract is an immediate answer to the
// officer's actual question.

import {
  FileState,
  GoogleGenAI,
  type File as GeminiFile,
  type Interactions,
} from '@google/genai';
import { recordGeminiChatUsage } from '../cost/cost-meter.js';

export const MISC_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL ?? 'gemini-3.7-flash';

function thinkingLevel(): 'low' | 'medium' | 'high' {
  const raw = process.env.GEMINI_CHAT_THINKING_LEVEL?.trim().toLowerCase();
  return raw === 'medium' || raw === 'high' ? raw : 'low';
}

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing required environment variable GEMINI_API_KEY.');
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export type GeminiChatFileHandle = Readonly<{
  name: string;
  uri: string;
  mimeType: 'application/pdf';
  expiresAt: string;
}>;

const FILE_POLL_MS = 1_000;
const FILE_POLL_MAX_TICKS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredHandle(file: GeminiFile): GeminiChatFileHandle {
  if (!file.name || !file.uri) {
    throw new Error('Gemini accepted the PDF but returned no reusable file handle.');
  }
  return {
    name: file.name,
    uri: file.uri,
    mimeType: 'application/pdf',
    // The API normally supplies this. The conservative fallback refreshes before Google's
    // documented 48-hour deletion even if an older response omitted it.
    expiresAt:
      file.expirationTime ?? new Date(Date.now() + 47 * 60 * 60_000).toISOString(),
  };
}

// Upload and wait until Gemini can answer against the file. Called as soon as the officer
// selects a PDF, so this work overlaps the time they spend typing their question.
export async function uploadGeminiChatDocument(
  displayName: string,
  data: Buffer,
): Promise<GeminiChatFileHandle> {
  const blob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
  let file = await gemini().files.upload({
    file: blob,
    config: { mimeType: 'application/pdf', displayName },
  });

  for (let tick = 0; tick < FILE_POLL_MAX_TICKS; tick += 1) {
    if (file.state === FileState.ACTIVE || file.state === undefined) {
      return requiredHandle(file);
    }
    if (file.state === FileState.FAILED) {
      throw new Error(file.error?.message ?? 'Gemini could not prepare this PDF.');
    }
    if (!file.name) throw new Error('Gemini returned an unnamed PDF upload.');
    await sleep(FILE_POLL_MS);
    file = await gemini().files.get({ name: file.name });
  }
  throw new Error('Gemini did not finish preparing this PDF in time.');
}

export type MiscChatTurn = Readonly<{
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly Readonly<{
    kind: 'image' | 'document' | 'audio' | 'youtube';
    name: string;
    imageUrl?: string | undefined;
    text?: string | undefined;
    documentUri?: string | undefined;
  }>[];
}>;

function attachmentBlock(name: string, text: string): string {
  return `--- ${name} ---\n${text}`;
}

function textOf(turn: MiscChatTurn, includeRole: boolean): string {
  const extracted = (turn.attachments ?? [])
    .filter((attachment) => attachment.text)
    .map((attachment) => attachmentBlock(attachment.name, attachment.text ?? ''));
  const body = [turn.content, ...extracted]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  if (!includeRole) return body === '' ? ' ' : body;
  const role = turn.role === 'user' ? 'User' : 'Assistant';
  return `${role}:\n${body === '' ? ' ' : body}`;
}

function interactionInput(
  turns: readonly MiscChatTurn[],
  continuing: boolean,
): Interactions.Content[] {
  const selected = continuing ? turns.slice(-1) : turns;
  const input: Interactions.Content[] = [];
  for (const turn of selected) {
    input.push({ type: 'text', text: textOf(turn, !continuing) });
    for (const attachment of turn.attachments ?? []) {
      if (attachment.kind === 'image' && attachment.imageUrl) {
        input.push({ type: 'image', uri: attachment.imageUrl });
      } else if (attachment.kind === 'document' && attachment.documentUri) {
        input.push({
          type: 'document',
          uri: attachment.documentUri,
          mime_type: 'application/pdf',
        });
      }
    }
  }
  return input;
}

export type MiscChatReply = Readonly<{
  text: string;
  model: string;
  interactionId: string;
}>;

// One native, stateful Gemini turn. The first call carries the recent transcript plus any
// files; later calls carry only the new turn and continue from the provider interaction id.
export async function streamMiscChatReply(
  turns: readonly MiscChatTurn[],
  onDelta: (chunk: string) => void,
  previousInteractionId?: string | undefined,
): Promise<MiscChatReply> {
  const model = MISC_CHAT_MODEL;
  const stream = await gemini().interactions.create({
    model,
    input: interactionInput(turns, previousInteractionId !== undefined),
    stream: true,
    store: true,
    ...(previousInteractionId
      ? { previous_interaction_id: previousInteractionId }
      : {}),
    generation_config: { thinking_level: thinkingLevel() },
  });

  let text = '';
  let interactionId = '';
  for await (const event of stream) {
    if (event.event_type === 'interaction.created') {
      interactionId = event.interaction.id ?? interactionId;
    } else if (event.event_type === 'step.delta' && event.delta.type === 'text') {
      text += event.delta.text;
      onDelta(event.delta.text);
    } else if (event.event_type === 'interaction.completed') {
      interactionId = event.interaction.id ?? interactionId;
      recordGeminiChatUsage(model, event.interaction.usage);
    }
  }
  if (interactionId === '') {
    throw new Error('Gemini finished without returning an interaction id.');
  }
  return { text, model, interactionId };
}
