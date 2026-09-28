// The edit assistant's planner: read the officer's conversation about a finished poster or
// caption, and decide what to DO — revise the caption, write a first one, edit the poster,
// redesign it, set an article poster's exact text, ask one question, or simply reply.
//
// It replaced a fold whose two pills made the officer choose the target ("कॅप्शन" or
// "पोस्टर") and phrase the request as an instruction. Here they just say what they want,
// across as many turns as it takes, and the plan is carried out through the SAME routes the
// fold used — so this module decides and never executes. The API returns the plan; the web
// calls the existing endpoints, whose guards and jobs apply unchanged.
//
// INSTRUCT, THEN GUARANTEE — the repo's standing shape. One strict-JSON call proposes a plan;
// `finalizeEditPlan` (pure, free, harness-checked) then decides what it may actually do:
//   - an action the surface cannot perform, or whose target is busy, is DROPPED with a
//     Marathi reason rather than attempted and refused by a route;
//   - an instruction whose digits are not in the officer's own words, the caption or the
//     note is REPLACED by the officer's words — the assistant may rephrase a request, never
//     slip a figure into one (the digit-grounding rule every generated line here obeys);
//   - an exact poster heading must occur in what the officer typed, or it is not set: a
//     heading is printed verbatim as the poster's only text, so it may never be the model's;
//   - a mark the officer already wrote a note beside keeps THEIR note.
// A plan that ends up with nothing to do becomes a question, never a silent no-op.
//
// Runs on the poster-copy tier at LOW effort: the answer is short and structured, but it is
// the routing decision for a paid render, so it gets the judgement tier rather than luna.

import { pathToFileURL } from 'node:url';
import type {
  EditAssistantAction,
  EditAssistantMessage,
  EditAssistantPlan,
  PosterClearAction,
} from '@dgipr/schemas';
import { POSTER_HEADING_MAX_CHARS } from '@dgipr/schemas';
import { chatComplete, type ReasoningEffort } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';
import { digitsAreGrounded } from './digit-grounding.js';

export const EDIT_ASSISTANT_MODEL =
  process.env.OPENAI_EDIT_ASSISTANT_MODEL?.trim() || POSTER_COPY_MODEL;

function editAssistantReasoningEffort(): ReasoningEffort {
  const value = process.env.OPENAI_EDIT_ASSISTANT_REASONING_EFFORT?.trim();
  return value === 'none' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high'
    ? value
    : 'low';
}

// The route that consumes an instruction caps it at 4,000 characters; a mark's note at 500.
const INSTRUCTION_MAX_CHARS = 4_000;
const MARKER_NOTE_MAX_CHARS = 500;
// A request shorter than this is not a usable instruction on its own (the routes' own floor).
const MIN_INSTRUCTION_CHARS = 3;
const NOTE_CONTEXT_MAX_CHARS = 3_000;
const CAPTION_CONTEXT_MAX_CHARS = 2_500;

export type EditAssistantLane = 'social' | 'carousel' | 'article' | 'thumbnail';

export type EditAssistantContext = Readonly<{
  lane: EditAssistantLane;
  /** The officer's original note — the run's only factual source. */
  note: string;
  /** The current caption, or null when the run has none. */
  caption: string | null;
  /** The article poster's exact text override, when one is set. */
  posterHeading: string | null;
  /** What this surface may do right now, before busy-ness is considered. */
  can: Readonly<{
    reviseCaption: boolean;
    generateCaption: boolean;
    editPoster: boolean;
    redesignPoster: boolean;
    changeHeading: boolean;
  }>;
  busy: Readonly<{ caption: boolean; poster: boolean }>;
  markers: readonly Readonly<{ note: string }>[];
  clearRegions: readonly Readonly<{
    action: PosterClearAction;
    note: string;
  }>[];
}>;

// The model's raw answer. Flat and fully required because the call is strict json_schema,
// which cannot express a discriminated union; finalizeEditPlan turns it into actions.
export type RawEditPlan = Readonly<{
  kind: 'act' | 'clarify' | 'reply';
  message: string;
  caption_action: 'none' | 'revise' | 'generate';
  caption_instruction: string;
  poster_action: 'none' | 'edit' | 'redesign' | 'heading';
  poster_instruction: string;
  marker_notes: readonly string[];
  poster_heading: string;
}>;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'message',
    'caption_action',
    'caption_instruction',
    'poster_action',
    'poster_instruction',
    'marker_notes',
    'poster_heading',
  ],
  properties: {
    kind: { type: 'string', enum: ['act', 'clarify', 'reply'] },
    message: { type: 'string' },
    caption_action: { type: 'string', enum: ['none', 'revise', 'generate'] },
    caption_instruction: { type: 'string' },
    poster_action: {
      type: 'string',
      enum: ['none', 'edit', 'redesign', 'heading'],
    },
    poster_instruction: { type: 'string' },
    marker_notes: { type: 'array', items: { type: 'string' } },
    poster_heading: { type: 'string' },
  },
} as const;

// ── Marathi messages the guard can emit ──────────────────────────────────────────────
export const EDIT_ASSISTANT_TEXT = {
  clarify:
    'नक्की काय बदलायचे आहे ते थोडक्यात सांगाल का? उदा. कॅप्शनमधील एखादी ओळ, किंवा पोस्टरवरील मजकूर, फोटो किंवा रंग.',
  headingClarify:
    'पोस्टरवर नेमका कोणता मजकूर हवा आहे? तो जसाच्या तसा अवतरणात लिहा.',
  posterBusy:
    'पोस्टरचे काम सध्या सुरू आहे. ते पूर्ण झाल्यावर पोस्टरमधील बदल पुन्हा सांगा.',
  captionBusy:
    'कॅप्शनचे काम सध्या सुरू आहे. ते पूर्ण झाल्यावर कॅप्शनमधील बदल पुन्हा सांगा.',
  unavailable: 'हे या ठिकाणाहून करता येत नाही.',
  failed: 'विनंती समजून घेताना अडचण आली. कृपया पुन्हा थोडक्यात सांगा.',
  captionRevise: 'कॅप्शनमध्ये बदल करत आहे.',
  captionGenerate: 'कॅप्शन तयार करत आहे.',
  posterEdit: 'पोस्टरमध्ये बदल करत आहे.',
  posterRedesign: 'पोस्टरचे नवीन डिझाइन तयार करत आहे.',
  posterHeading: 'पोस्टरवरील मजकूर बदलून पुन्हा तयार करत आहे.',
} as const;

const LANE_DESCRIPTION: Record<EditAssistantLane, string> = {
  social:
    'a finished social-media post (Twitter/X or Facebook): one poster image plus a caption that is posted beside it',
  carousel:
    'a finished carousel post: several poster slides plus one caption. Slide edits are made on the slides themselves; from here only the CAPTION can be changed',
  article:
    'a finished landscape poster that accompanies a news/scheme article. The poster carries one Marathi headline over a picture',
  thumbnail: 'a finished YouTube thumbnail image',
};

const SYSTEM_PROMPT = [
  'You are the edit assistant on the Maharashtra government DGIPR content platform. An officer is looking at a piece of work the platform already produced and talks to you in Marathi or English, in their own words, about what they want changed. They do NOT pick actions or use special wording — understanding what they mean is your job.',
  '',
  'Read the WHOLE conversation and the CURRENT STATE, decide what the officer wants done NOW, and answer with a plan.',
  '',
  'ACTIONS (use only those listed as available in CURRENT STATE):',
  '- caption_action "revise": change the existing caption (length, tone, wording, hashtags, emoji, order, adding or removing a line, numerals written in Marathi/English script, etc.). Write caption_instruction as ONE complete, self-contained instruction that folds in everything from the conversation that still applies (e.g. an earlier "make it shorter" plus the latest "add the helpline hashtag").',
  '- caption_action "generate": write a first caption. Only when the run has no caption and the officer asks for one.',
  '- poster_action "edit": change something on the existing poster image while keeping the rest — its text, a photo or picture, colours, sizes, an element to add, remove or move. Write poster_instruction as ONE complete, self-contained instruction. If the officer has put numbered red marks on the poster (listed in CURRENT STATE), write marker_notes with exactly one note per mark, in order, saying what should change at that mark, using what the officer said about it; otherwise marker_notes is an empty array. Blue lettered boxes mean "free this space" and need nothing from you.',
  '- poster_action "redesign": a completely new design of the same content, when the officer wants a different poster altogether ("पूर्ण नवीन डिझाइन", "पुन्हा तयार करा", "हे आवडले नाही, दुसरे करा") rather than a specific change. A specific change is always "edit".',
  '- poster_action "heading": article posters only — print exactly the words the officer supplied as the poster\'s text. poster_heading must be those exact words, copied character for character from the conversation.',
  'When the officer asks for changes to both the caption and the poster, do both.',
  '',
  'DECIDING:',
  '- kind "act" when you can tell what should change. Do not ask about details the platform can decide by itself (exact colour shade, exact wording of a shorter caption).',
  '- kind "clarify" with ONE short question only when you genuinely cannot tell what to change or whether they mean the caption or the poster. Never ask more than one thing.',
  '- kind "reply" when the officer asks a question, thanks you, or says something that needs no change. Also when they ask for something not available here (publishing, downloading, another format) — then briefly say it cannot be done from here.',
  '- Earlier assistant turns describe work already started. Do not repeat it unless the officer asks again; act on the latest request, using earlier turns only for context. A short answer ("हो", "दोन्ही", "पोस्टर") answers your previous question.',
  '- Leave instructions and notes empty ("") for actions you are not taking.',
  '',
  'FACTS AND TEXT:',
  '- Instructions steer the change; they never add facts. Never introduce a name, date, amount, number, designation, scheme name or place the officer did not write. Keep any words, names, numbers and hashtags the officer quotes exactly as they wrote them.',
  '- Write instructions in the language the officer used.',
  '',
  'message: one or two short, plain Marathi sentences — what you are doing (for act), your question (for clarify), or your answer (for reply). No markdown. Never mention which AI model, company or vendor you are.',
].join('\n');

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildEditAssistantMessages(
  context: EditAssistantContext,
  conversation: readonly EditAssistantMessage[],
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const available: string[] = [];
  if (context.can.reviseCaption) available.push('caption_action "revise"');
  if (context.can.generateCaption) available.push('caption_action "generate"');
  if (context.can.editPoster) available.push('poster_action "edit"');
  if (context.can.redesignPoster) available.push('poster_action "redesign"');
  if (context.can.changeHeading) available.push('poster_action "heading"');

  const busy: string[] = [];
  if (context.busy.caption)
    busy.push('the caption is being rewritten right now');
  if (context.busy.poster) busy.push('the poster is being rendered right now');

  const marks: string[] = [];
  context.markers.forEach((m, i) =>
    marks.push(
      `red mark ${i + 1}: ${m.note ? `officer's note "${m.note}"` : 'no note yet'}`,
    ),
  );
  context.clearRegions.forEach((c, i) =>
    marks.push(
      `blue box ${String.fromCharCode(65 + i)}: free this space (${c.action === 'remove' ? 'remove what is there' : 'move what is there elsewhere'})${c.note ? `, note "${c.note}"` : ''}`,
    ),
  );

  const state = [
    '<CURRENT_STATE>',
    `WORK: ${LANE_DESCRIPTION[context.lane]}.`,
    `AVAILABLE ACTIONS: ${available.length > 0 ? available.join(', ') : 'none — reply or clarify only'}.`,
    ...(busy.length > 0 ? [`BUSY: ${busy.join('; ')}.`] : []),
    `MARKS ON THE POSTER: ${marks.length > 0 ? marks.join('; ') : 'none'}.`,
    ...(context.posterHeading
      ? [`POSTER TEXT OVERRIDE CURRENTLY SET: "${context.posterHeading}"`]
      : []),
    'CURRENT CAPTION:',
    context.caption
      ? truncate(context.caption, CAPTION_CONTEXT_MAX_CHARS)
      : '(none)',
    "OFFICER'S ORIGINAL NOTE (the only factual source):",
    truncate(context.note, NOTE_CONTEXT_MAX_CHARS) || '(empty)',
    '</CURRENT_STATE>',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: state },
    {
      role: 'assistant',
      content: 'समजले. तुम्हाला काय बदलायचे आहे?',
    },
    ...conversation.map((m) => ({ role: m.role, content: m.text })),
  ];
}

export function parseRawEditPlan(raw: string): RawEditPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const str = (key: string): string =>
    typeof v[key] === 'string' ? (v[key] as string) : '';
  const kind = str('kind');
  if (kind !== 'act' && kind !== 'clarify' && kind !== 'reply') return null;
  const captionAction = str('caption_action');
  const posterAction = str('poster_action');
  return {
    kind,
    message: str('message'),
    caption_action:
      captionAction === 'revise' || captionAction === 'generate'
        ? captionAction
        : 'none',
    caption_instruction: str('caption_instruction'),
    poster_action:
      posterAction === 'edit' ||
      posterAction === 'redesign' ||
      posterAction === 'heading'
        ? posterAction
        : 'none',
    poster_instruction: str('poster_instruction'),
    marker_notes: Array.isArray(v.marker_notes)
      ? v.marker_notes.filter((n): n is string => typeof n === 'string')
      : [],
    poster_heading: str('poster_heading'),
  };
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Quotes an officer wraps an exact heading in — straight, curly and the Marathi-press ‘…’.
function stripQuotes(text: string): string {
  return text.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
}

/**
 * Turn the model's proposal into what may actually happen. Pure and deterministic — the
 * harness below pins every rule.
 */
export function finalizeEditPlan(
  raw: RawEditPlan,
  context: EditAssistantContext,
  conversation: readonly EditAssistantMessage[],
): EditAssistantPlan {
  const userTurns = conversation
    .filter((m) => m.role === 'user')
    .map((m) => m.text.trim());
  const latest = userTurns[userTurns.length - 1] ?? '';
  // What the officer has said recently, for when the model's instruction cannot be used.
  // The latest turn alone may be a one-word answer to a question ("पोस्टर").
  const recent = truncate(
    userTurns.slice(-3).join('\n'),
    INSTRUCTION_MAX_CHARS,
  );
  const fallbackInstruction =
    latest.length >= 12 || userTurns.length === 1 ? latest : recent;
  // Where a figure in an instruction may legitimately come from.
  const groundSource = [
    userTurns.join('\n'),
    context.caption ?? '',
    context.note,
  ].join('\n');

  const usable = (text: string, max: number): string | null => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_INSTRUCTION_CHARS) return null;
    if (!digitsAreGrounded(trimmed, groundSource)) return null;
    return truncate(trimmed, max);
  };
  const instructionOf = (text: string): string =>
    usable(text, INSTRUCTION_MAX_CHARS) ??
    truncate(fallbackInstruction, INSTRUCTION_MAX_CHARS);

  const baseMessage = normalizeSpace(raw.message);
  if (raw.kind !== 'act') {
    return {
      kind: raw.kind,
      message:
        baseMessage ||
        (raw.kind === 'clarify'
          ? EDIT_ASSISTANT_TEXT.clarify
          : EDIT_ASSISTANT_TEXT.unavailable),
      actions: [],
    };
  }

  const actions: EditAssistantAction[] = [];
  const notes: string[] = [];
  let needsHeadingClarify = false;

  // ── caption ──
  let captionAction = raw.caption_action;
  if (captionAction === 'revise' && context.caption === null) {
    // Nothing to revise: a first caption is the nearest honest reading.
    captionAction = context.can.generateCaption ? 'generate' : 'none';
  }
  if (captionAction === 'generate' && context.caption !== null) {
    captionAction = context.can.reviseCaption ? 'revise' : 'none';
  }
  if (captionAction !== 'none') {
    const allowed =
      captionAction === 'revise'
        ? context.can.reviseCaption
        : context.can.generateCaption;
    if (!allowed) {
      notes.push(EDIT_ASSISTANT_TEXT.unavailable);
    } else if (context.busy.caption) {
      notes.push(EDIT_ASSISTANT_TEXT.captionBusy);
    } else if (captionAction === 'revise') {
      actions.push({
        type: 'caption_revise',
        instruction: instructionOf(raw.caption_instruction),
      });
    } else {
      actions.push({ type: 'caption_generate' });
    }
  }

  // ── poster ──
  const posterAction = raw.poster_action;
  if (posterAction !== 'none') {
    const allowed =
      posterAction === 'edit'
        ? context.can.editPoster
        : posterAction === 'redesign'
          ? context.can.redesignPoster
          : context.can.changeHeading;
    if (!allowed) {
      notes.push(EDIT_ASSISTANT_TEXT.unavailable);
    } else if (context.busy.poster) {
      notes.push(EDIT_ASSISTANT_TEXT.posterBusy);
    } else if (posterAction === 'edit') {
      const hasMarks =
        context.markers.length > 0 || context.clearRegions.length > 0;
      const instruction =
        usable(raw.poster_instruction, INSTRUCTION_MAX_CHARS) ??
        (hasMarks && raw.poster_instruction.trim() === ''
          ? ''
          : truncate(fallbackInstruction, INSTRUCTION_MAX_CHARS));
      const markerNotes = context.markers.map((marker, i) => {
        const own = marker.note.trim();
        if (own.length >= MIN_INSTRUCTION_CHARS) return own;
        const proposed = usable(
          raw.marker_notes[i] ?? '',
          MARKER_NOTE_MAX_CHARS,
        );
        if (proposed) return proposed;
        return truncate(
          instruction.length >= MIN_INSTRUCTION_CHARS
            ? instruction
            : fallbackInstruction,
          MARKER_NOTE_MAX_CHARS,
        );
      });
      // A round must carry SOMETHING the route accepts: text of at least the floor, or marks.
      const sendable =
        instruction.length >= MIN_INSTRUCTION_CHARS ||
        context.markers.length > 0 ||
        context.clearRegions.length > 0;
      if (
        sendable &&
        markerNotes.every((n) => n.length >= MIN_INSTRUCTION_CHARS)
      ) {
        actions.push({ type: 'poster_edit', instruction, markerNotes });
      } else {
        notes.push(EDIT_ASSISTANT_TEXT.clarify);
      }
    } else if (posterAction === 'redesign') {
      actions.push({ type: 'poster_redesign' });
    } else {
      const heading = normalizeSpace(stripQuotes(raw.poster_heading));
      const said = normalizeSpace(userTurns.join(' '));
      if (
        heading.length > 0 &&
        heading.length <= POSTER_HEADING_MAX_CHARS &&
        said.includes(heading)
      ) {
        actions.push({ type: 'poster_heading', heading });
      } else {
        needsHeadingClarify = true;
      }
    }
  }

  if (actions.length === 0) {
    if (needsHeadingClarify) {
      return {
        kind: 'clarify',
        message: EDIT_ASSISTANT_TEXT.headingClarify,
        actions: [],
      };
    }
    const reason = notes.find((n) => n !== EDIT_ASSISTANT_TEXT.clarify);
    return reason
      ? { kind: 'reply', message: reason, actions: [] }
      : { kind: 'clarify', message: EDIT_ASSISTANT_TEXT.clarify, actions: [] };
  }

  const described = actions
    .map((a) =>
      a.type === 'caption_revise'
        ? EDIT_ASSISTANT_TEXT.captionRevise
        : a.type === 'caption_generate'
          ? EDIT_ASSISTANT_TEXT.captionGenerate
          : a.type === 'poster_edit'
            ? EDIT_ASSISTANT_TEXT.posterEdit
            : a.type === 'poster_redesign'
              ? EDIT_ASSISTANT_TEXT.posterRedesign
              : EDIT_ASSISTANT_TEXT.posterHeading,
    )
    .join(' ');
  // The model's own sentence is kept only when every one of its proposals survived — if the
  // guard dropped one, a sentence promising it would be untrue.
  const allKept = notes.length === 0 && !needsHeadingClarify;
  const message = [
    allKept && baseMessage ? baseMessage : described,
    ...notes.filter((n) => n !== EDIT_ASSISTANT_TEXT.clarify),
    ...(needsHeadingClarify ? [EDIT_ASSISTANT_TEXT.headingClarify] : []),
  ].join(' ');
  return { kind: 'act', message, actions };
}

/**
 * One planning turn. Never throws: a failed call answers as a reply asking the officer to
 * say it again, so the conversation carries on rather than breaking.
 */
export async function planEditRequest(
  context: EditAssistantContext,
  conversation: readonly EditAssistantMessage[],
): Promise<EditAssistantPlan> {
  try {
    const raw = await chatComplete(
      buildEditAssistantMessages(context, conversation),
      {
        model: EDIT_ASSISTANT_MODEL,
        reasoningEffort: editAssistantReasoningEffort(),
        maxTokens: 1_500,
        jsonSchema: { name: 'edit_plan', schema: PLAN_SCHEMA },
      },
    );
    const parsed = parseRawEditPlan(raw);
    if (!parsed) {
      console.warn('[edit-assistant] unparseable plan:', raw.slice(0, 300));
      return {
        kind: 'reply',
        message: EDIT_ASSISTANT_TEXT.failed,
        actions: [],
      };
    }
    return finalizeEditPlan(parsed, context, conversation);
  } catch (error) {
    console.warn(
      '[edit-assistant] planning failed:',
      error instanceof Error ? error.message : error,
    );
    return { kind: 'reply', message: EDIT_ASSISTANT_TEXT.failed, actions: [] };
  }
}

// ── Harness ──────────────────────────────────────────────────────────────────────────
// Free: `npx tsx src/generation/edit-assistant.ts --check`
// Live (cents): `npx tsx --env-file=../../.env src/generation/edit-assistant.ts --live`
async function main(): Promise<void> {
  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown): void => {
    if (ok) console.log(`  ok   ${label}`);
    else {
      failures += 1;
      console.log(`  FAIL ${label}`, detail ?? '');
    }
  };

  const social: EditAssistantContext = {
    lane: 'social',
    note: 'पुण्यात ५०० कोटींच्या प्रकल्पाचे उद्घाटन ३१ ऑगस्ट २०२६ रोजी होणार आहे.',
    caption: '📍पुणे\n५०० कोटींच्या प्रकल्पाचे उद्घाटन. @MahaDGIPR',
    posterHeading: null,
    can: {
      reviseCaption: true,
      generateCaption: false,
      editPoster: true,
      redesignPoster: true,
      changeHeading: false,
    },
    busy: { caption: false, poster: false },
    markers: [],
    clearRegions: [],
  };
  const raw = (over: Partial<RawEditPlan>): RawEditPlan => ({
    kind: 'act',
    message: '',
    caption_action: 'none',
    caption_instruction: '',
    poster_action: 'none',
    poster_instruction: '',
    marker_notes: [],
    poster_heading: '',
    ...over,
  });
  const say = (...texts: string[]): EditAssistantMessage[] =>
    texts.map((text, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text,
    }));

  if (process.argv.includes('--check') || !process.argv.includes('--live')) {
    console.log('edit-assistant: finalizeEditPlan');
    {
      const plan = finalizeEditPlan(
        raw({
          caption_action: 'revise',
          caption_instruction: 'कॅप्शन लहान करा',
          message: 'कॅप्शन लहान करत आहे.',
        }),
        social,
        say('कॅप्शन थोडं लहान कर'),
      );
      check(
        'a caption revise passes through with its instruction',
        plan.kind === 'act' &&
          plan.actions[0]?.type === 'caption_revise' &&
          plan.actions[0].instruction === 'कॅप्शन लहान करा',
        plan,
      );
      check(
        'the model message is kept',
        plan.message === 'कॅप्शन लहान करत आहे.',
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          caption_action: 'revise',
          caption_instruction: 'कॅप्शनमध्ये ७०० कोटी लिहा',
        }),
        social,
        say('कॅप्शनमध्ये रक्कम ठळक करा'),
      );
      const action = plan.actions[0];
      check(
        'an invented figure is replaced by the officer’s own words',
        action?.type === 'caption_revise' &&
          action.instruction === 'कॅप्शनमध्ये रक्कम ठळक करा',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          caption_action: 'revise',
          caption_instruction: 'कॅप्शनमध्ये 500 कोटी ठळक करा',
        }),
        social,
        say('रक्कम ठळक करा'),
      );
      check(
        'a figure from the note, re-scripted, is allowed',
        plan.actions[0]?.type === 'caption_revise' &&
          plan.actions[0].instruction.includes('500'),
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          caption_action: 'revise',
          caption_instruction: 'लहान करा',
          poster_action: 'edit',
          poster_instruction: 'पार्श्वभूमी निळी करा',
        }),
        social,
        say('कॅप्शन लहान कर आणि पोस्टरची पार्श्वभूमी निळी कर'),
      );
      check(
        'a combined request becomes caption then poster',
        plan.actions.map((a) => a.type).join(',') ===
          'caption_revise,poster_edit',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ poster_action: 'edit', poster_instruction: 'फोटो बदला' }),
        { ...social, busy: { caption: false, poster: true } },
        say('फोटो बदला'),
      );
      check(
        'a busy poster is not edited, and says why',
        plan.kind === 'reply' &&
          plan.actions.length === 0 &&
          plan.message === EDIT_ASSISTANT_TEXT.posterBusy,
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          caption_action: 'revise',
          caption_instruction: 'लहान करा',
          poster_action: 'edit',
          poster_instruction: 'फोटो बदला',
          message: 'दोन्ही बदलत आहे.',
        }),
        { ...social, busy: { caption: false, poster: true } },
        say('कॅप्शन लहान कर आणि फोटो बदल'),
      );
      check(
        'a partly blocked plan keeps what it can and drops the untrue promise',
        plan.kind === 'act' &&
          plan.actions.length === 1 &&
          plan.actions[0]?.type === 'caption_revise' &&
          !plan.message.includes('दोन्ही') &&
          plan.message.includes(EDIT_ASSISTANT_TEXT.posterBusy),
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ poster_action: 'edit', poster_instruction: 'फोटो बदला' }),
        {
          ...social,
          lane: 'carousel',
          can: { ...social.can, editPoster: false, redesignPoster: false },
        },
        say('फोटो बदला'),
      );
      check(
        'an action the surface cannot do is refused in Marathi',
        plan.kind === 'reply' &&
          plan.message === EDIT_ASSISTANT_TEXT.unavailable,
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ caption_action: 'revise', caption_instruction: 'लहान करा' }),
        {
          ...social,
          caption: null,
          can: { ...social.can, reviseCaption: false, generateCaption: true },
        },
        say('कॅप्शन हवे'),
      );
      check(
        'revising a missing caption becomes writing a first one',
        plan.actions[0]?.type === 'caption_generate',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          poster_action: 'edit',
          poster_instruction: '',
          marker_notes: ['हा फोटो काढा', ''],
        }),
        { ...social, markers: [{ note: '' }, { note: 'मजकूर मोठा करा' }] },
        say('१ वरचा फोटो काढ, बाकी खुणा सांगितल्याप्रमाणे'),
      );
      const action = plan.actions[0];
      check(
        'marks: the model note fills a blank mark, the officer’s own note wins',
        action?.type === 'poster_edit' &&
          action.markerNotes[0] === 'हा फोटो काढा' &&
          action.markerNotes[1] === 'मजकूर मोठा करा',
        plan,
      );
      check(
        'marks carry the round, so an empty instruction is allowed',
        action?.type === 'poster_edit' && action.instruction === '',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ poster_action: 'edit', poster_instruction: '' }),
        { ...social, markers: [{ note: '' }] },
        say('ही खूण मोठी कर'),
      );
      const action = plan.actions[0];
      check(
        'a blank mark with no usable model note falls back to the officer’s words',
        action?.type === 'poster_edit' &&
          action.markerNotes[0] === 'ही खूण मोठी कर',
        plan,
      );
    }
    const article: EditAssistantContext = {
      ...social,
      lane: 'article',
      caption: null,
      can: {
        reviseCaption: false,
        generateCaption: false,
        editPoster: true,
        redesignPoster: true,
        changeHeading: true,
      },
    };
    {
      const plan = finalizeEditPlan(
        raw({ poster_action: 'heading', poster_heading: '‘भारत टॅक्सी’' }),
        article,
        say('पोस्टरवर फक्त ‘भारत टॅक्सी’ एवढेच लिहा'),
      );
      check(
        'an exact heading the officer typed is set, quotes stripped',
        plan.actions[0]?.type === 'poster_heading' &&
          plan.actions[0].heading === 'भारत टॅक्सी',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({
          poster_action: 'heading',
          poster_heading: 'भारत टॅक्सी सेवा सुरू',
        }),
        article,
        say('पोस्टरवर योजनेचे नाव लिहा'),
      );
      check(
        'a heading the officer never typed is not printed — they are asked',
        plan.kind === 'clarify' &&
          plan.message === EDIT_ASSISTANT_TEXT.headingClarify,
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ kind: 'clarify', message: 'कॅप्शन की पोस्टर?' }),
        social,
        say('हे बदला'),
      );
      check(
        'a clarifying question carries no actions',
        plan.kind === 'clarify' &&
          plan.actions.length === 0 &&
          plan.message === 'कॅप्शन की पोस्टर?',
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(raw({}), social, say('हे बदला'));
      check(
        'an act with nothing to do becomes a question, never a silent no-op',
        plan.kind === 'clarify' && plan.message === EDIT_ASSISTANT_TEXT.clarify,
        plan,
      );
    }
    {
      const plan = finalizeEditPlan(
        raw({ poster_action: 'edit', poster_instruction: '' }),
        social,
        say('पोस्टरमध्ये बदल हवा आहे का?', 'कोणता बदल?', 'हो'),
      );
      check(
        'a one-word answer with no instruction cannot become a poster round from "हो" alone',
        plan.actions[0]?.type !== 'poster_edit' ||
          plan.actions[0].instruction.length >= MIN_INSTRUCTION_CHARS,
        plan,
      );
    }
    check(
      'the parser rejects junk and keeps a well-formed answer',
      parseRawEditPlan('nope') === null &&
        parseRawEditPlan(
          JSON.stringify({ ...raw({}), kind: 'reply', message: 'ठीक' }),
        )?.kind === 'reply',
    );
  }

  if (process.argv.includes('--live')) {
    console.log('edit-assistant: live');
    const cases: [
      string,
      EditAssistantContext,
      EditAssistantMessage[],
      string,
    ][] = [
      ['caption shorter', social, say('कॅप्शन खूप मोठे आहे'), 'caption_revise'],
      ['poster colour', social, say('पोस्टरचा रंग जरा उजळ हवा'), 'poster_edit'],
      [
        'both',
        social,
        say('कॅप्शनमध्ये #पुणे टाका आणि पोस्टरवरचा फोटो बदला'),
        'caption_revise,poster_edit',
      ],
      [
        'redesign',
        social,
        say('हे पोस्टर आवडले नाही, पूर्ण नवीन बनवा'),
        'poster_redesign',
      ],
      ['vague', social, say('हे नीट करा'), ''],
    ];
    for (const [label, ctx, convo, expected] of cases) {
      const plan = await planEditRequest(ctx, convo);
      const got = plan.actions.map((a) => a.type).join(',');
      check(`${label} → ${expected || plan.kind}`, got === expected, plan);
      console.log(`       ${plan.kind}: ${plan.message}`);
    }
  }

  console.log(
    failures === 0
      ? '\nAll edit-assistant checks passed.'
      : `\n${failures} check(s) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
