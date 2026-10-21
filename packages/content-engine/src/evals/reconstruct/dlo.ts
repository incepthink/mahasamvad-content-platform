// DLO (`/dlo`): one intake — the officer's notes, recordings, documents, photographs and links —
// the machine's reading of each source beside the officer's correction of it, the reviewed note,
// and every article generated from it with its feedback rounds.

import {
  DLO_UPLOADS_BUCKET,
  type DloIntakeFileEntry,
  type DloIntakeRow,
  type GenerationRow,
  type RevisionRow,
} from '@dgipr/database';
import { combineIntakeSources } from '@dgipr/schemas';
import {
  activitySpans,
  compact,
  EARLIER_DRAFT_NOT_STORED,
  lastTimestamp,
  sortSpans,
  storageMedia,
  traceId,
  type ActivityLite,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';
import { generationMetadata, revisionSpans } from './generation-common.js';

export type DloGenerationBundle = Readonly<{
  generation: GenerationRow;
  revisions: readonly RevisionRow[];
}>;

// The intake's source mix, for sampling and for the trace's metadata.
export type DloSourceLane =
  'typed' | 'pdf' | 'audio' | 'youtube' | 'image' | 'document' | 'mixed';

export function dloSourceLane(
  notes: string,
  files: readonly Pick<DloIntakeFileEntry, 'kind'>[],
): DloSourceLane {
  const kinds = new Set(
    files.map((file) =>
      file.kind === 'docx' || file.kind === 'txt' ? 'document' : file.kind,
    ),
  );
  if (kinds.size === 0) return 'typed';
  if (kinds.size > 1) return 'mixed';
  return [...kinds][0] as DloSourceLane;
}

type ReviewOverlay = Readonly<{
  edits: Readonly<Record<string, string>>;
  excluded: ReadonlySet<string>;
  instructions: string | null;
  styleReference: string | null;
  designations: unknown;
}>;

// review_state is owned by DloReviewStateSchema; read only the fields this trace shows, and
// tolerate anything else rather than fail a harness run on an old blob.
export function reviewOverlay(value: unknown): ReviewOverlay {
  const blob =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const edits: Record<string, string> = {};
  if (typeof blob.edits === 'object' && blob.edits !== null) {
    for (const [key, text] of Object.entries(blob.edits)) {
      if (typeof text === 'string') edits[key] = text;
    }
  }
  const excluded = new Set(
    Array.isArray(blob.excluded)
      ? blob.excluded.filter((k): k is string => typeof k === 'string')
      : [],
  );
  return {
    edits,
    excluded,
    instructions:
      typeof blob.instructions === 'string' ? blob.instructions : null,
    styleReference:
      typeof blob.styleReference === 'string' ? blob.styleReference : null,
    designations: blob.designations ?? null,
  };
}

function sourceMedia(file: DloIntakeFileEntry) {
  if (file.kind === 'youtube') return null;
  return file.storagePath
    ? storageMedia(DLO_UPLOADS_BUCKET, file.storagePath, {
        filename: file.name,
      })
    : null;
}

// One span per source: what the machine read next to what the officer changed it to.
function extractionSpans(
  intake: DloIntakeRow,
  overlay: ReviewOverlay,
): TraceSpan[] {
  return intake.files.map((file, index) => {
    const machine = file.openaiFileId
      ? 'Read natively by the article model; no transcript of this source is stored.'
      : file.pages
        ? file.pages.map((page) => ({ page: page.page, text: page.text }))
        : (file.text ?? null);
    const corrections = file.pages
      ? file.pages.flatMap((page) => {
          const key = `${index}:${page.page}`;
          const edited = overlay.edits[key];
          return [
            ...(edited !== undefined && edited !== page.text
              ? [{ page: page.page, correctedText: edited }]
              : []),
            ...(overlay.excluded.has(key)
              ? [{ page: page.page, excludedByOfficer: true }]
              : []),
          ];
        })
      : (() => {
          const edited = overlay.edits[String(index)];
          return edited !== undefined && edited !== file.text
            ? [{ correctedText: edited }]
            : [];
        })();
    return {
      key: `source:${index}`,
      name: `source ${index + 1}: ${file.kind} — ${file.name}`,
      type: 'tool' as const,
      startedAt: intake.createdAt,
      input: compact({
        file: sourceMedia(file),
        youtubeUrl: file.sourceUrl,
        trim: file.trim,
      }),
      output: compact({
        machineText: machine,
        officerCorrections: corrections,
        excludedWholeSource: overlay.excluded.has(String(index)) || null,
      }),
      metadata: compact({
        kind: file.kind,
        status: file.status,
        error: file.error,
        pdfSource: file.pdfSource,
        chars: file.chars,
      }),
    };
  });
}

// The note as the review step would assemble it, used only when no generation recorded the
// note that was actually submitted.
export function reconstructReviewedNote(
  intake: DloIntakeRow,
  overlay: ReviewOverlay,
): string {
  const notes = overlay.edits.notes ?? intake.notes;
  const sources = intake.files.flatMap((file, index) => {
    if (overlay.excluded.has(String(index))) return [];
    if (file.pages) {
      const text = file.pages
        .filter((page) => !overlay.excluded.has(`${index}:${page.page}`))
        .map((page) => overlay.edits[`${index}:${page.page}`] ?? page.text)
        .join('\n\n');
      return [{ label: file.name, text }];
    }
    const text = overlay.edits[String(index)] ?? file.text ?? '';
    return [{ label: file.name, text }];
  });
  return combineIntakeSources(notes, sources);
}

export function buildDloTrace(
  intake: DloIntakeRow,
  bundles: readonly DloGenerationBundle[],
  activity: readonly ActivityLite[],
): ReconstructedTrace {
  const overlay = reviewOverlay(intake.reviewState);
  const notes: string[] = [];
  const spans: TraceSpan[] = [];
  const generations = [...bundles].sort((a, b) =>
    a.generation.createdAt.localeCompare(b.generation.createdAt),
  );

  const input = compact({
    notes: intake.notes,
    category: intake.category,
    heading: intake.heading,
    sources: intake.files.map((file) =>
      compact({
        name: file.name,
        kind: file.kind,
        file: sourceMedia(file),
        youtubeUrl: file.sourceUrl,
        trim: file.trim,
      }),
    ),
  });
  spans.push({
    key: 'input',
    name: 'officer input',
    type: 'function',
    startedAt: intake.createdAt,
    input,
  });
  spans.push(...extractionSpans(intake, overlay));

  const first = generations[0]?.generation;
  const notesEdit = overlay.edits.notes;
  spans.push({
    key: 'review',
    name: 'officer review',
    type: 'function',
    // The review happens between extraction and the first article.
    startedAt: first?.createdAt ?? intake.updatedAt,
    output: compact({
      reviewedNote: first
        ? first.note
        : reconstructReviewedNote(intake, overlay),
      reviewedNoteSource: first
        ? 'generations.note (as submitted)'
        : 'reconstructed from review_state (no article was generated)',
      notesCorrection:
        notesEdit !== undefined && notesEdit !== intake.notes
          ? notesEdit
          : null,
      instructions: first?.instructions ?? overlay.instructions,
      styleReference: first?.styleReference ?? overlay.styleReference,
      approvedDesignations: first?.nameDesignations ?? overlay.designations,
    }),
  });

  for (const [n, { generation, revisions }] of generations.entries()) {
    const ordered = [...revisions].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const articleRevised = ordered.some((r) => r.target === 'article');
    if (articleRevised) notes.push(EARLIER_DRAFT_NOT_STORED);
    spans.push({
      key: `generation:${generation.id}`,
      name: `article ${n + 1} (v1)`,
      type: 'llm',
      startedAt: generation.createdAt,
      input: compact({
        reviewedNote: n === 0 ? null : generation.note,
        heading: generation.heading,
        instructions: generation.instructions,
        category: generation.category,
      }),
      output: compact({
        article: articleRevised
          ? 'Earlier draft not stored.'
          : generation.article,
        factCheck: articleRevised ? null : generation.factCheck,
      }),
      metadata: generationMetadata(generation),
    });
    spans.push(...revisionSpans(ordered, `revision:${generation.id}`));
    if (generation.status === 'failed') {
      spans.push({
        key: `failure:${generation.id}`,
        name: `article ${n + 1} failed`,
        type: 'function',
        startedAt: generation.updatedAt,
        output: compact({ error: generation.error, step: generation.step }),
      });
    }
  }

  spans.push(...activitySpans(activity));
  if (intake.status === 'failed') {
    spans.push({
      key: 'intake-failure',
      name: 'intake failed',
      type: 'function',
      startedAt: intake.updatedAt,
      output: compact({ error: intake.error, step: intake.step }),
    });
  }

  const latest = generations[generations.length - 1]?.generation;
  const sorted = sortSpans(spans);
  return {
    id: traceId('dlo', intake.id),
    feature: 'dlo',
    rowId: intake.id,
    name: `dlo · ${dloSourceLane(intake.notes, intake.files)}`,
    startedAt: intake.createdAt,
    endedAt: lastTimestamp(intake.updatedAt, sorted),
    input,
    output: compact({
      article: latest?.article,
      factCheck: latest?.factCheck,
      articleEnglish: latest?.articleEnglish,
      articleHindi: latest?.articleHindi,
      note: latest ? null : 'No article was generated from this intake.',
    }),
    metadata: compact({
      feature: 'dlo',
      lane: dloSourceLane(intake.notes, intake.files),
      reconstructed: true,
      intakeStatus: intake.status,
      intakeError: intake.error,
      status: latest?.status ?? intake.status,
      createdAt: intake.createdAt,
      generationCount: generations.length,
      feedbackRounds: generations.reduce(
        (sum, b) => sum + b.revisions.length,
        0,
      ),
      costUsd: generations.reduce(
        (sum, b) => sum + (b.generation.costUsd ?? 0),
        0,
      ),
      styleReferenceMeta: latest?.styleReferenceMeta,
      generationIds: generations.map((b) => b.generation.id),
    }),
    spans: sorted,
    notes: [...new Set(notes)],
  };
}
