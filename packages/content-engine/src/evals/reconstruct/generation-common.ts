// Shared pieces for every trace built from a `generations` row: the creative lanes, the /dlo
// article and the translation stand-in all read the same columns and the same revision log.

import {
  POSTERS_BUCKET,
  VIDEOS_BUCKET,
  type GenerationRow,
  type RevisionRow,
} from '@dgipr/database';
import {
  compact,
  storageMedia,
  type MediaRef,
  type TraceSpan,
} from '../trace.js';

const SOCIAL = new Set(['twitter', 'facebook']);

// Which creative lane a generation ran on, in the words of the sidebar's format picker.
export type CreativeLane =
  | 'social-poster'
  | 'caption-only'
  | 'article-poster'
  | 'youtube'
  | 'carousel'
  | 'dynamic-poster';

export function creativeLane(
  row: Pick<GenerationRow, 'category' | 'outputType'>,
): CreativeLane {
  if (row.category === 'carousel') return 'carousel';
  if (row.category === 'dynamic_poster') return 'dynamic-poster';
  if (row.category === 'youtube') return 'youtube';
  if (SOCIAL.has(row.category))
    return row.outputType === 'article' ? 'caption-only' : 'social-poster';
  return 'article-poster';
}

export function posterMedia(path: string, derived = false): MediaRef {
  return storageMedia(POSTERS_BUCKET, path, derived ? { derived: true } : {});
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

type StoredSlide = Readonly<{
  index: number;
  title: string;
  path: string | null;
  versions: readonly Readonly<{
    path: string;
    createdAt: string;
    feedback: string | null;
  }>[];
}>;

// generations.carousel, read tolerantly: a hand-edited or partially written row must degrade to
// "no slides", never throw inside a harness run.
export function carouselSlides(value: unknown): StoredSlide[] {
  if (typeof value !== 'object' || value === null) return [];
  const slides = (value as { slides?: unknown }).slides;
  if (!Array.isArray(slides)) return [];
  return slides.flatMap((slide): StoredSlide[] => {
    if (typeof slide !== 'object' || slide === null) return [];
    const s = slide as Record<string, unknown>;
    const versions = Array.isArray(s.versions)
      ? s.versions.flatMap((v) => {
          if (typeof v !== 'object' || v === null) return [];
          const r = v as Record<string, unknown>;
          return typeof r.path === 'string' && typeof r.createdAt === 'string'
            ? [
                {
                  path: r.path,
                  createdAt: r.createdAt,
                  feedback: typeof r.feedback === 'string' ? r.feedback : null,
                },
              ]
            : [];
        })
      : [];
    return [
      {
        index: typeof s.index === 'number' ? s.index : 0,
        title: typeof s.title === 'string' ? s.title : '',
        path: typeof s.path === 'string' ? s.path : null,
        versions,
      },
    ];
  });
}

// What the officer supplied on the create form.
export function generationInput(row: GenerationRow): Record<string, unknown> {
  return compact({
    note: row.note,
    heading: row.heading,
    instructions: row.instructions,
    imagePrompt: row.imagePrompt,
    posterHeading: row.posterHeading,
    styleReference: row.styleReference,
    category: row.category,
    outputType: row.outputType,
    designMode: row.designMode,
    templateBrand: row.templateBrand,
    pinnedReferenceImageId: row.referenceImageId,
    pinnedReferenceTypeId: row.referenceTypeId,
    articleProvided: row.articleProvided || null,
    nameDesignations: row.nameDesignations,
    promptImages: stringArray(row.promptImagePaths).map((path) =>
      posterMedia(path),
    ),
    sourcePoster: row.sourceImagePath ? posterMedia(row.sourceImagePath) : null,
    motionAspect: row.motionAspect,
    motionRegion: row.motionRegion,
  });
}

// The final artifact(s) as the row holds them now.
export function generationOutput(row: GenerationRow): Record<string, unknown> {
  const social = SOCIAL.has(row.category) || row.category === 'carousel';
  return compact({
    poster: row.posterPath ? posterMedia(row.posterPath) : null,
    carouselSlides: carouselSlides(row.carousel)
      .filter((slide) => slide.path)
      .map((slide) => ({
        slide: slide.index + 1,
        title: slide.title,
        image: posterMedia(slide.path!),
      })),
    motionClip: row.motionPath
      ? storageMedia(VIDEOS_BUCKET, row.motionPath)
      : null,
    motionPrompt: row.motionPrompt,
    caption: social ? row.article : null,
    article: social ? null : row.article,
    factCheck: row.factCheck,
    posterCopy: row.copy,
    referenceTitle: row.referenceTitle,
    publishedUrl: row.publishedUrl,
  });
}

export function generationMetadata(
  row: GenerationRow,
): Record<string, unknown> {
  return compact({
    category: row.category,
    outputType: row.outputType,
    status: row.status,
    step: row.status === 'completed' ? null : row.step,
    error: row.error,
    createdAt: row.createdAt,
    costUsd: row.costUsd,
    styleReferenceMeta: row.styleReferenceMeta,
    posterStyle: row.posterStyle,
    referenceUrl: row.referenceUrl,
    imageModel: row.imageModel,
    threadRootId: row.threadRootId,
    sourceGenerationId: row.sourceGenerationId,
  });
}

const TARGET_LABELS: Readonly<Record<string, string>> = {
  article: 'article feedback',
  poster_copy: 'poster text feedback',
  poster_scene: 'poster scene feedback',
  manual_copy: 'poster text edited by hand',
  poster_image: 'poster image feedback',
  caption: 'caption feedback',
  manual_caption: 'caption edited by hand',
  motion: 'motion follow-up',
};

// One span per revision row: the officer's words in, the new snapshot out. A revision row stores
// the RESULT of the round, which is why v1 is not in this list (see EARLIER_DRAFT_NOT_STORED).
export function revisionSpans(
  revisions: readonly RevisionRow[],
  keyPrefix = 'revision',
): TraceSpan[] {
  return revisions.map((revision, index) => ({
    key: `${keyPrefix}:${revision.id}`,
    name: `${TARGET_LABELS[revision.target] ?? revision.target} (round ${index + 1})`,
    type: 'task' as const,
    startedAt: revision.createdAt,
    input: compact({ feedback: revision.feedback, target: revision.target }),
    output: compact({
      article: revision.article,
      factCheck: revision.factCheck,
      posterCopy: revision.copy,
      scenePrompt: revision.scenePrompt,
      poster: revision.posterPath ? posterMedia(revision.posterPath) : null,
      motionClip: revision.motionPath
        ? storageMedia(VIDEOS_BUCKET, revision.motionPath)
        : null,
    }),
  }));
}

export const POSTER_V1_NOTE =
  'The first poster is shown from its conventional path (poster-v1.png); the uploader reports it if that object no longer exists.';

// The first poster's path is a convention (runner.ts posterPath(id, 1)), not a stored value —
// marked `derived` so a missing object is reported rather than treated as an error.
export function firstPosterPath(generationId: string): string {
  return `generations/${generationId}/poster-v1.png`;
}

export function firstMotionPath(generationId: string): string {
  return `dynamic-posters/${generationId}/motion-v1.mp4`;
}
