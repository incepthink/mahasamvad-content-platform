// The practice run behind /learn's DLO lesson — a fake /dlo intake and the article made from
// it, living in memory.
//
// The lesson renders the REAL /dlo intake form and the REAL article view. What it cannot do is
// let them reach the API: practice must create no intake, no run, and spend nothing. So this
// module holds the state a real run would keep on its row (status, step, the article versions)
// and builds a `GenerationDetail` from it that parses against the real schema — the article
// view cannot tell the difference, which is the point.
//
// The articles are NOT written here. They were written ONCE by the real article engine from
// SAMPLE_NOTE — the /dlo draft call, then the article-feedback revision for the screen's own
// quick suggestion «आणखी थोडक्यात लिहा» — and are kept in ./dloSamples.ts. That is why the
// lesson asks for the sample note, and why only that change can be shown: it is the result
// that exists.
//
// One thing the real flow has that this does not: between the intake form and the article, a
// real run first waits on /dlo/[id] while recordings and documents are read. The practice
// sends only typed text, so it goes straight to the article being written — which is also the
// longest wait an officer sees, and the one worth showing.
//
// No localStorage here — the lesson page persists `getState()` itself, so this stays pure
// enough for the free harness to drive with a fake clock.

import type {
  ArticleVersionText,
  GenerationDetail,
  GenerationStep,
} from '@dgipr/schemas';
import type { ArticleEdit } from './matchArticleEdit';
import { DLO_SAMPLE_ARTICLES } from './dloSamples';

export const SAMPLE_ID = 'learn-dlo-sample';
export const SAMPLE_INTAKE_ID = 'learn-dlo-intake';

// Fictional and neutral: the district is invented and no real official is named. Meeting
// notes as a DLO actually brings them — a heading, where and when, then the points.
export const SAMPLE_NOTE = `जिल्हा रस्ता सुरक्षा समितीची आढावा बैठक
ठिकाण: जिल्हाधिकारी कार्यालय, आनंदपूर
दिनांक: ८ ऑक्टोबर

- जिल्ह्यात गेल्या वर्षभरात ४२ अपघातप्रवण ठिकाणे निश्चित झाली. त्यापैकी २८ ठिकाणी दुरुस्तीची कामे पूर्ण झाली.
- उर्वरित १४ ठिकाणांची कामे ३१ डिसेंबरपर्यंत पूर्ण करण्याचे निर्देश जिल्हाधिकारी यांनी दिले.
- शाळा व महाविद्यालयांजवळ वेगमर्यादेचे फलक आणि गतिरोधक बसवावेत.
- हेल्मेट व सीटबेल्ट वापराबाबत १५ ते ३० ऑक्टोबर दरम्यान जिल्हाभर जनजागृती मोहीम राबवली जाईल.
- अपघातग्रस्तांना तातडीने रुग्णालयात पोहोचवणाऱ्या नागरिकांचा प्रशस्तिपत्र देऊन सन्मान केला जाईल.
- अपघात झाल्यास नागरिकांनी ११२ या क्रमांकावर संपर्क साधावा.`;

export type ArticleFile = 'v1' | ArticleEdit;

const FILES: readonly ArticleFile[] = ['v1', 'short'];

export function articleText(file: ArticleFile): string {
  return DLO_SAMPLE_ARTICLES[file];
}

// The PDF each article exports as, rendered once by the real PDF renderer (Chromium) and kept
// under public/learn/dlo/.
export function articlePdfUrl(file: ArticleFile): string {
  return `/learn/dlo/${file}.pdf`;
}

export type SandboxVersion = Readonly<{
  file: ArticleFile;
  // The learner's own words that produced this version; null on the first article.
  feedback: string | null;
  createdAt: string;
}>;

export type SandboxState = Readonly<{
  v: 1;
  created: boolean;
  createdAt: string | null;
  status: 'running' | 'completed';
  step: GenerationStep | null;
  // What the fake job is doing right now, so a reload mid-job can finish it.
  busy: 'create' | 'edit' | null;
  pendingEdit: Readonly<{ file: ArticleEdit; feedback: string }> | null;
  // How much of the article being written is on screen, 0..1 — the live draft.
  streamed: number;
  versions: readonly SandboxVersion[];
  // Index into `versions` of the article on the row.
  current: number;
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
    streamed: 0,
    versions: [],
    current: 0,
  };
}

// A saved state read back from storage. Anything unrecognised starts the lesson over rather
// than rendering a half-understood run.
export function parseSandboxState(value: unknown): SandboxState | null {
  if (typeof value !== 'object' || value === null) return null;
  const s = value as Partial<SandboxState>;
  if (s.v !== 1 || typeof s.created !== 'boolean') return null;
  if (!Array.isArray(s.versions) || typeof s.current !== 'number') return null;
  if (!s.versions.every((v) => FILES.includes(v?.file))) return null;
  if (s.pendingEdit && !FILES.includes(s.pendingEdit.file)) return null;
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
      streamed: 0,
      versions: [
        { file: 'v1', feedback: null, createdAt: state.createdAt ?? now },
      ],
      current: 0,
    };
  }
  if (state.busy === 'edit' && state.pendingEdit) {
    const versions = [
      ...state.versions,
      {
        file: state.pendingEdit.file,
        feedback: state.pendingEdit.feedback,
        createdAt: now,
      },
    ];
    return {
      ...state,
      busy: null,
      pendingEdit: null,
      status: 'completed',
      step: 'done',
      streamed: 0,
      versions,
      current: versions.length - 1,
    };
  }
  return { ...state, busy: null, status: 'completed', streamed: 0 };
}

export function currentFile(state: SandboxState): ArticleFile | null {
  return state.versions[state.current]?.file ?? null;
}

// The first `fraction` of `text`, cut at a space so a word — and a Devanagari syllable — is
// never shown half-written.
export function streamPrefix(text: string, fraction: number): string {
  if (fraction >= 1) return text;
  if (fraction <= 0) return '';
  const cut = Math.floor(text.length * fraction);
  const space = text.lastIndexOf(' ', cut);
  return text.slice(0, space > 0 ? space : 0);
}

// The live draft while a fake job writes — the article appearing, as the real page streams it.
export function draftText(state: SandboxState): string {
  if (state.busy === 'create')
    return streamPrefix(articleText('v1'), state.streamed);
  if (state.busy === 'edit' && state.pendingEdit) {
    return streamPrefix(articleText(state.pendingEdit.file), state.streamed);
  }
  return '';
}

export function versionTexts(state: SandboxState): ArticleVersionText[] {
  return state.versions.map((version, index) => ({
    version: index + 1,
    createdAt: version.createdAt,
    feedback: version.feedback,
    current: index === state.current,
    article: articleText(version.file),
    factCheck: null,
  }));
}

export function sampleDetail(state: SandboxState): GenerationDetail {
  const created = state.createdAt ?? new Date(0).toISOString();
  const file = currentFile(state);
  const lastAt = state.versions.at(-1)?.createdAt ?? created;
  return {
    id: SAMPLE_ID,
    status: state.status,
    step: state.step,
    // A /dlo run: an article and nothing else.
    outputType: 'article',
    category: 'news',
    articlePipeline: 'simple',
    designMode: null,
    templateBrand: 'dgipr',
    note: SAMPLE_NOTE,
    heading: null,
    posterHeading: null,
    referenceImageId: null,
    referenceTypeId: null,
    article: file ? articleText(file) : null,
    articleEnglish: null,
    articleHindi: null,
    factCheck: null,
    copy: null,
    fiveWOneH: null,
    posterUrl: null,
    sceneUrl: null,
    sourceImageUrl: null,
    motionUrl: null,
    motionGifUrl: null,
    motionPrompt: null,
    motionVersions: [],
    carouselSlides: [],
    carouselBusySlides: [],
    posterVersions: [],
    articleVersions: versionTexts(state).map(
      ({ version, createdAt, feedback, current }) => ({
        version,
        createdAt,
        feedback,
        current,
      }),
    ),
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

// How long the fake jobs take. Short on purpose — the coach says a real run takes minutes;
// the practice only has to show that there IS a wait and what it looks like.
export const CREATE_DRAFT_AT_MS = 1500;
export const CREATE_STREAM_MS = 5000;
export const CREATE_DONE_MS = CREATE_DRAFT_AT_MS + CREATE_STREAM_MS + 500;
export const EDIT_STREAM_AT_MS = 800;
export const EDIT_STREAM_MS = 3500;
export const EDIT_DONE_MS = EDIT_STREAM_AT_MS + EDIT_STREAM_MS + 500;
// How often the live draft grows.
const STREAM_TICK_MS = 150;

export type DloSandbox = Readonly<{
  getState: () => SandboxState;
  subscribe: (listener: () => void) => () => void;
  startCreate: () => void;
  startEdit: (file: ArticleEdit, feedback: string) => void;
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

export function createDloSandbox(
  initial: SandboxState = freshSandboxState(),
  scheduler: Scheduler = REAL_SCHEDULER,
): DloSandbox {
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
  // The live draft growing from nothing to the whole article over `duration`.
  const stream = (from: number, duration: number) => {
    const ticks = Math.max(1, Math.round(duration / STREAM_TICK_MS));
    for (let i = 1; i <= ticks; i++) {
      later(
        () => write({ ...state, streamed: i / ticks }),
        from + (duration * i) / ticks,
      );
    }
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
        step: 'retrieve',
        busy: 'create',
      });
      later(() => write({ ...state, step: 'draft' }), CREATE_DRAFT_AT_MS);
      stream(CREATE_DRAFT_AT_MS, CREATE_STREAM_MS);
      later(() => write(settle(state)), CREATE_DONE_MS);
    },
    startEdit: (file, feedback) => {
      write({
        ...state,
        status: 'running',
        step: 'revise_article',
        busy: 'edit',
        pendingEdit: { file, feedback },
        streamed: 0,
      });
      stream(EDIT_STREAM_AT_MS, EDIT_STREAM_MS);
      later(() => write(settle(state)), EDIT_DONE_MS);
    },
    selectVersion: (version) => {
      const index = version - 1;
      if (index < 0 || index >= state.versions.length) return;
      write({ ...state, current: index });
    },
    dispose: () => {
      for (const handle of timers) scheduler.clear(handle);
      timers.clear();
      listeners.clear();
    },
  };
}
