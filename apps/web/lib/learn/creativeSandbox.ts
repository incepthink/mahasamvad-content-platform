// The practice run behind /learn's first lesson — a fake generation that lives in memory.
//
// The lesson renders the REAL create form and the REAL social poster card. What it cannot do
// is let them reach the API: practice must create no run and spend nothing. So this module
// holds the state a real run would keep on its row (status, step, the poster versions) and
// builds a `GenerationDetail` from it that parses against the real schema — the card cannot
// tell the difference, which is the point.
//
// The posters are NOT made here. They were rendered ONCE through the real pipeline from
// SAMPLE_NOTE (a fresh Creative, then two marker edits on its headline from v1) and committed
// under public/learn/creative/. That is why the lesson asks for the sample text, and why only
// two edits can be shown: those are the results that exist.
//
// No localStorage here — the lesson page persists `getState()` itself, so this stays pure
// enough for the free harness to drive with fake timers.

import type {
  FeedbackRegion,
  GenerationDetail,
  GenerationStep,
} from '@dgipr/schemas';
import type { ScriptedEdit } from './matchScriptedEdit';

export const SAMPLE_ID = 'learn-creative-sample';

// Fictional, neutral, and deliberately short so the poster carries a clear headline. The
// place and date are invented; no real official is named.
export const SAMPLE_NOTE = `आनंदवाडी येथे मोफत आरोग्य तपासणी शिबिर

जिल्हा आरोग्य विभागातर्फे आनंदवाडी येथील प्राथमिक आरोग्य केंद्रात १२ ऑक्टोबर रोजी सकाळी ९ ते सायंकाळी ५ या वेळेत मोफत आरोग्य तपासणी शिबिर होणार आहे. शिबिरात रक्तदाब, मधुमेह आणि डोळ्यांची तपासणी मोफत केली जाईल. गरजू रुग्णांना औषधेही मोफत दिली जातील. नागरिकांनी येताना आधार कार्ड सोबत आणावे.`;

// The headline of the sample poster, normalised 0..1 — measured off v1's pixels (the orange
// headline runs x 72..671, y 116..446 on the 1280x1600 render).
export const HEADLINE_REGION: FeedbackRegion = {
  x: 0.056,
  y: 0.072,
  width: 0.468,
  height: 0.206,
};

export type PosterFile = 'v1' | 'v2-size' | 'v2-colour';

const FILE_FOR_EDIT: Record<ScriptedEdit, PosterFile> = {
  size: 'v2-size',
  colour: 'v2-colour',
};

export function posterFileUrl(file: PosterFile, plain = false): string {
  return `/learn/creative/${file}${plain ? '-plain' : ''}.webp`;
}

export type SandboxState = Readonly<{
  v: 1;
  created: boolean;
  createdAt: string | null;
  status: 'running' | 'completed';
  step: GenerationStep | null;
  // What the fake job is doing right now, so a reload mid-job can finish it.
  busy: 'create' | 'edit' | null;
  pendingEdit: ScriptedEdit | null;
  versions: readonly Readonly<{ file: PosterFile; createdAt: string }>[];
  // Index into `versions` of the poster on screen (the row's posterPath).
  current: number;
  // The learner opened the ORIGINAL after an edit — the lesson's last stage asks for it.
  sawOriginalAfterEdit: boolean;
}>;

export function freshSandboxState(): SandboxState {
  return {
    v: 1,
    created: false,
    createdAt: null,
    status: 'completed',
    step: null,
    busy: null,
    pendingEdit: null,
    versions: [],
    current: 0,
    sawOriginalAfterEdit: false,
  };
}

// A saved state read back from storage. Anything unrecognised starts the lesson over rather
// than rendering a half-understood run.
export function parseSandboxState(value: unknown): SandboxState | null {
  if (typeof value !== 'object' || value === null) return null;
  const s = value as Partial<SandboxState>;
  if (s.v !== 1 || typeof s.created !== 'boolean') return null;
  if (!Array.isArray(s.versions) || typeof s.current !== 'number') return null;
  const files: readonly string[] = ['v1', 'v2-size', 'v2-colour'];
  if (!s.versions.every((v) => files.includes(v?.file))) return null;
  return settle({ ...freshSandboxState(), ...s } as SandboxState);
}

// Finish whatever fake job was in flight — used on resume, where its timer is gone.
export function settle(state: SandboxState): SandboxState {
  const now = new Date().toISOString();
  if (state.busy === 'create') {
    return {
      ...state,
      busy: null,
      status: 'completed',
      step: 'done',
      versions: [{ file: 'v1', createdAt: state.createdAt ?? now }],
      current: 0,
    };
  }
  if (state.busy === 'edit' && state.pendingEdit) {
    const versions = [
      ...state.versions,
      { file: FILE_FOR_EDIT[state.pendingEdit], createdAt: now },
    ];
    return {
      ...state,
      busy: null,
      pendingEdit: null,
      status: 'completed',
      step: 'done',
      versions,
      current: versions.length - 1,
    };
  }
  return { ...state, busy: null, status: 'completed' };
}

// Each version gets its own URL even when two share a file (the same edit asked for twice
// from the original): the version strip keys and matches thumbnails by URL.
function versionUrl(file: PosterFile, index: number): string {
  return `${posterFileUrl(file)}?v=${index + 1}`;
}

export function currentFile(state: SandboxState): PosterFile | null {
  return state.versions[state.current]?.file ?? null;
}

export function sampleDetail(state: SandboxState): GenerationDetail {
  const created = state.createdAt ?? new Date(0).toISOString();
  const file = currentFile(state);
  const lastAt = state.versions.at(-1)?.createdAt ?? created;
  return {
    id: SAMPLE_ID,
    status: state.status,
    step: state.step,
    outputType: 'poster',
    category: 'twitter',
    articlePipeline: 'simple',
    designMode: 'fresh',
    templateBrand: 'dgipr',
    note: SAMPLE_NOTE,
    heading: null,
    posterHeading: null,
    referenceImageId: null,
    referenceTypeId: null,
    article: null,
    articleEnglish: null,
    articleHindi: null,
    factCheck: null,
    copy: null,
    fiveWOneH: null,
    posterUrl: file ? versionUrl(file, state.current) : null,
    sceneUrl: null,
    sourceImageUrl: null,
    motionUrl: null,
    motionGifUrl: null,
    motionPrompt: null,
    motionVersions: [],
    carouselSlides: [],
    carouselBusySlides: [],
    posterVersions: state.versions.map((version, index) => ({
      posterUrl: versionUrl(version.file, index),
      createdAt: version.createdAt,
    })),
    articleVersions: [],
    posterStyleLabel: null,
    publishedUrl: null,
    publishedAt: null,
    error: null,
    translating: false,
    translatingLanguage: null,
    translateError: null,
    translateWarnings: null,
    nameDesignations: [],
    designationWarnings: [],
    posterCapacityWarning: null,
    posterNumeralWarning: null,
    lengthWarning: null,
    learnedPreferences: [],
    articleRevising: false,
    articleReviseError: null,
    captionRevising: false,
    captionReviseError: null,
    editFailure: null,
    editRetryable: false,
    costUsd: null,
    costBreakdown: null,
    createdAt: created,
    updatedAt: lastAt,
    revisions: [],
  };
}

// ---------- the store ----------

// How long the fake jobs take. Short on purpose — the coach says a real run takes 1–2
// minutes; the practice only has to show that there IS a wait and what it looks like.
export const CREATE_STAGES: readonly Readonly<{
  step: GenerationStep;
  atMs: number;
}>[] = [
  { step: 'classify', atMs: 0 },
  { step: 'copy', atMs: 2000 },
  { step: 'image', atMs: 4000 },
];
export const CREATE_DONE_MS = 6500;
export const EDIT_DONE_MS = 5000;

export type CreativeSandbox = Readonly<{
  getState: () => SandboxState;
  subscribe: (listener: () => void) => () => void;
  startCreate: () => void;
  startEdit: (edit: ScriptedEdit) => void;
  selectVersion: (version: number) => void;
  dispose: () => void;
}>;

type Scheduler = Readonly<{
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}>;

const REAL_SCHEDULER: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCreativeSandbox(
  initial: SandboxState = freshSandboxState(),
  scheduler: Scheduler = REAL_SCHEDULER,
): CreativeSandbox {
  let state = initial;
  const listeners = new Set<() => void>();
  const timers = new Set<unknown>();

  const write = (next: SandboxState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const later = (fn: () => void, ms: number) => {
    const handle = scheduler.set(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startCreate: () => {
      write({
        ...freshSandboxState(),
        created: true,
        createdAt: new Date().toISOString(),
        status: 'running',
        step: null,
        busy: 'create',
      });
      for (const stage of CREATE_STAGES) {
        later(() => write({ ...state, step: stage.step }), stage.atMs);
      }
      later(() => write(settle(state)), CREATE_DONE_MS);
    },
    startEdit: (edit) => {
      write({
        ...state,
        status: 'running',
        step: 'revise_image',
        busy: 'edit',
        pendingEdit: edit,
      });
      later(() => write(settle(state)), EDIT_DONE_MS);
    },
    selectVersion: (version) => {
      const index = version - 1;
      if (index < 0 || index >= state.versions.length) return;
      write({
        ...state,
        current: index,
        sawOriginalAfterEdit:
          state.sawOriginalAfterEdit ||
          (index === 0 && state.versions.length > 1),
      });
    },
    dispose: () => {
      for (const handle of timers) scheduler.clear(handle);
      timers.clear();
      listeners.clear();
    },
  };
}
