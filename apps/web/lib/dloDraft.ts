'use client';

// Two small pieces of browser-local state for /dlo, kept together because both exist to stop
// an officer losing work they have not submitted yet.
//
// 1. THE DRAFT (sessionStorage). What is typed into the new-intake form before it becomes an
//    intake: notes, category, heading, style reference, and the ids of the document upload
//    slots. The slot ids matter more than they look — each <DocumentIntake> card already
//    survives a reload by keeping its ephemeral job id under `dgipr.dlo.document.${slotId}`,
//    but only if the SAME slot ids come back, so `nextSlotId` is stored too.
//
// 2. THE OWNERSHIP LIST (localStorage). The intake ids this browser created.
//
//    *** This is ORDERING ONLY. It is not auth and must never become auth. ***
//
//    There is no login in this product and `dlo_intakes` has no owner column, so every intake
//    is visible to everyone and openable by anyone — that is the intended design, not an
//    oversight. This list exists purely so an officer's own work sorts to the top of a shared
//    list instead of being hunted for. The API never receives it, never reads it and never
//    filters on it. Losing it (cleared storage, a different machine, a new profile) costs
//    ordering and nothing else: the intake is still in the list, one group down.
//
// The picked MP3s are deliberately NOT here. A File is a live handle behind a user gesture;
// sessionStorage takes strings, and copying a whole recording (up to UPLOAD_FILE_MAX_BYTES)
// into IndexedDB would
// still yield a handle the browser will not re-grant. Within one SPA session they ride in the
// module-scoped `pendingAudio` below — a module variable is not a component, so Next.js never
// unmounts it — and across a reload only their NAMES survive, so the form can ask for them
// back by name rather than silently submitting without them.

import type { DloCategory } from '@dgipr/schemas';

const DRAFT_KEY = 'dgipr.dlo.draft';
const MINE_KEY = 'dgipr.dlo.mine';

// Enough to cover any realistic day's work without letting the list grow forever.
const MAX_REMEMBERED = 50;

export type DloDraft = Readonly<{
  notes: string;
  category: DloCategory;
  heading: string;
  styleReference: string;
  documentSlotIds: readonly number[];
  nextSlotId: number;
  // Names only — see the header. Used to ask for the recordings back after a reload.
  audioNames: readonly string[];
}>;

export const EMPTY_DRAFT: DloDraft = {
  notes: '',
  category: 'news',
  heading: '',
  styleReference: '',
  documentSlotIds: [0],
  nextSlotId: 1,
  audioNames: [],
};

// Recordings picked but not yet submitted. Module scope, so they survive client-side
// navigation away from /dlo and back — the one thing the old always-mounted workspace did
// that a route page cannot. Cleared on a successful create and on "start over".
let pendingAudio: File[] = [];

export function getPendingAudio(): File[] {
  return pendingAudio;
}

export function setPendingAudio(files: readonly File[]): void {
  pendingAudio = [...files];
}

export function clearPendingAudio(): void {
  pendingAudio = [];
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readDraft(): DloDraft | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DloDraft>;
    // Hand-validated rather than zod'd: this is private browser state with one writer, and a
    // shape mismatch should degrade to "no draft" rather than throw during a render.
    const slotIds = Array.isArray(parsed.documentSlotIds)
      ? parsed.documentSlotIds.filter((id) => Number.isInteger(id))
      : EMPTY_DRAFT.documentSlotIds;
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      category: parsed.category === 'scheme' ? 'scheme' : 'news',
      heading: typeof parsed.heading === 'string' ? parsed.heading : '',
      styleReference:
        typeof parsed.styleReference === 'string' ? parsed.styleReference : '',
      documentSlotIds:
        slotIds.length > 0 ? slotIds : EMPTY_DRAFT.documentSlotIds,
      nextSlotId:
        typeof parsed.nextSlotId === 'number' && parsed.nextSlotId > 0
          ? parsed.nextSlotId
          : Math.max(...slotIds, 0) + 1,
      audioNames: Array.isArray(parsed.audioNames)
        ? parsed.audioNames.filter(
            (name): name is string => typeof name === 'string',
          )
        : [],
    };
  } catch {
    return null;
  }
}

export function writeDraft(draft: DloDraft): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A full or disabled sessionStorage must not break the form.
  }
}

export function clearDraft(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

// ---------- the ordering list (see the header: NOT a permission) ----------

export function readMyIntakeIds(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function rememberMyIntakeId(id: string): void {
  if (!isBrowser()) return;
  const next = [id, ...readMyIntakeIds().filter((known) => known !== id)].slice(
    0,
    MAX_REMEMBERED,
  );
  try {
    window.localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// Drop ids the server no longer returns, so the list cannot grow stale forever. Called with
// the ids currently on screen; an id simply older than the list window is kept, because the
// list is capped at 20 and forgetting a real intake would move it out of "तुमचे काम".
export function pruneMyIntakeIds(knownIds: readonly string[]): void {
  if (!isBrowser() || knownIds.length === 0) return;
  const mine = readMyIntakeIds();
  if (mine.length <= MAX_REMEMBERED) return;
  const known = new Set(knownIds);
  const next = mine.filter((id) => known.has(id)).slice(0, MAX_REMEMBERED);
  try {
    window.localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// A per-tab id stamped into every saved review blob, so a client can tell its OWN last save
// from someone else's. Random rather than time-based: two saves can land in the same
// millisecond, and this only has to be distinct, never meaningful.
let writerId: string | null = null;

export function reviewWriterId(): string {
  writerId ??= `w-${Math.random().toString(36).slice(2, 10)}`;
  return writerId;
}
