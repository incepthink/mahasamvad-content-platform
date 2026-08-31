'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  MediaCard,
  MediaCardSkeleton,
} from '@/components/media-room/MediaCard';
import { MasonryGrid } from '@/components/media-room/MasonryGrid';
import { aspectOf, estimateCardHeight, type MediaKind } from '@/lib/mediaRoom';
import { ChevronRight, Plus } from 'lucide-react';
import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createGeneration, listGenerations } from '@/lib/api';
import { errorMessage } from '@/lib/errorMessage';
import { useTasks } from '@/lib/TasksProvider';
import {
  isSocialCategory,
  POSTER_TEXT_MIN_CHARS,
  type CreateGenerationRequest,
  type GenerationSummary,
} from '@dgipr/schemas';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 2500;

const generationTypes = [
  'Creative',
  'Youtube',
  'Caption',
  'Banner',
  'Video',
] as const;

// Placeholders for the first paint, before the list arrives. They deliberately
// mix the three real artwork ratios rather than repeating one shape: the point of
// this gallery is that the four output types are not the same size, and a
// uniform loading grid would settle into a layout the real data then breaks.
const SKELETON_SHAPES = [
  'creative',
  'youtube',
  'banner',
  'creative',
  'caption',
  'banner',
  'creative',
  'youtube',
].map((kind, index) => ({
  id: `skeleton-${index}`,
  aspect: aspectOf(kind as MediaKind),
}));

type GenerationType = (typeof generationTypes)[number];
type GalleryGenerationType = Exclude<GenerationType, 'Video'>;

function isMediaRoomGeneration(item: GenerationSummary): boolean {
  if (item.category === 'youtube') return true;
  if (isSocialCategory(item.category)) return true;
  return item.category === 'scheme' && item.outputType !== 'article';
}

function requestFor(
  type: GalleryGenerationType,
  note: string,
  asItIsText: boolean,
  generateCaption: boolean,
): CreateGenerationRequest {
  switch (type) {
    case 'Creative':
      return {
        note,
        outputType: 'poster',
        category: 'twitter',
        designMode: asItIsText ? 'fresh_verbatim' : 'fresh',
        templateBrand: 'dgipr',
        generateCaption,
      };
    case 'Youtube':
      return {
        note,
        outputType: 'poster',
        category: 'youtube',
      };
    case 'Caption':
      return {
        note,
        outputType: 'article',
        category: 'facebook',
        generateCaption: true,
      };
    case 'Banner':
      return {
        note,
        outputType: 'poster',
        category: 'scheme',
        providedArticle: asItIsText || undefined,
      };
  }
}

function optimisticSummary(
  id: string,
  request: CreateGenerationRequest,
): GenerationSummary {
  return {
    id,
    createdAt: new Date().toISOString(),
    outputType: request.outputType,
    category: request.category,
    status: 'queued',
    step: null,
    noteExcerpt: request.note.slice(0, 160),
    headline: null,
    posterUrl: null,
    costUsd: null,
  };
}

function newestFirst(items: readonly GenerationSummary[]): GenerationSummary[] {
  return [...items].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

const Page = () => {
  const router = useRouter();
  const { addTask } = useTasks();
  const [generations, setGenerations] = React.useState<
    GenerationSummary[] | null
  >(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [generationType, setGenerationType] =
    React.useState<GenerationType>('Creative');
  const [asItIsText, setAsItIsText] = React.useState(false);
  const [generateCaption, setGenerateCaption] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const optimisticIds = React.useRef(new Set<string>());

  const loadGenerations = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoadError(null);

    try {
      const rows = (await listGenerations()).filter(isMediaRoomGeneration);
      const serverIds = new Set(rows.map((item) => item.id));
      serverIds.forEach((id) => optimisticIds.current.delete(id));

      setGenerations((previous) => {
        const optimisticRows = (previous ?? []).filter(
          (item) =>
            optimisticIds.current.has(item.id) && !serverIds.has(item.id),
        );
        return newestFirst([...rows, ...optimisticRows]);
      });
      setLoadError(null);
    } catch (error) {
      if (!quiet) setLoadError(errorMessage(error));
    }
  }, []);

  React.useEffect(() => {
    void loadGenerations();
  }, [loadGenerations]);

  const hasActiveGeneration =
    generations?.some(
      (item) => item.status === 'queued' || item.status === 'running',
    ) ?? false;

  React.useEffect(() => {
    if (!hasActiveGeneration) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      await loadGenerations(true);
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasActiveGeneration, loadGenerations]);

  const showAsItIsText =
    generationType === 'Creative' || generationType === 'Banner';
  const showGenerateCaption = generationType === 'Creative';

  const handleGenerateClick = async () => {
    if (generationType === 'Video') {
      router.push('/video');
      return;
    }

    const note = prompt.trim();
    if (note.length < POSTER_TEXT_MIN_CHARS || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    const request = requestFor(
      generationType,
      note,
      asItIsText,
      generateCaption,
    );

    try {
      const generationId = await createGeneration(request);
      const optimistic = optimisticSummary(generationId, request);
      optimisticIds.current.add(generationId);
      setGenerations((previous) =>
        newestFirst([optimistic, ...(previous ?? [])]),
      );
      setPrompt('');
      addTask(generationId);
      void loadGenerations(true);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative h-screen overflow-hidden">
      <div className="h-full overflow-y-auto p-4 pb-48">
        {generations === null && !loadError ? (
          <MasonryGrid
            items={SKELETON_SHAPES}
            keyOf={(shape) => shape.id}
            estimateHeight={(shape) => 1 / shape.aspect}
          >
            {(shape) => <MediaCardSkeleton aspect={shape.aspect} />}
          </MasonryGrid>
        ) : null}

        {loadError ? (
          <div className="card">
            <p>{loadError}</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void loadGenerations()}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {generations && generations.length > 0 ? (
          <MasonryGrid
            items={generations}
            keyOf={(generation) => generation.id}
            estimateHeight={estimateCardHeight}
          >
            {(generation) => <MediaCard item={generation} />}
          </MasonryGrid>
        ) : null}

        {generations && generations.length === 0 && !loadError ? (
          <div className="card">
            <p className="hint">
              Your Creative, Youtube, Caption and Banner generations will appear
              here.
            </p>
          </div>
        ) : null}
      </div>

      <div className="absolute bottom-4 left-1/2 w-full max-w-6xl -translate-x-1/2 rounded-2xl bg-white p-4 shadow-md">
        {submitError ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" type="button">
                <Plus />
              </Button>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={1}
                aria-label="Describe the image you want to see"
                placeholder="Describe the image you want to see..."
                className="min-h-10 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base leading-6 shadow-none outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0 md:text-sm"
              />
            </div>
            <div className="flex gap-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" type="button">
                    {generationType}
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    {generationTypes.map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onSelect={() => {
                          setGenerationType(type);
                          setAsItIsText(false);
                          setGenerateCaption(false);
                        }}
                      >
                        {type}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {showAsItIsText ? (
                <label
                  className={buttonVariants({
                    variant: 'outline',
                    className: 'cursor-pointer select-none',
                  })}
                >
                  <input
                    type="checkbox"
                    checked={asItIsText}
                    onChange={(event) => setAsItIsText(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  As it is Text
                </label>
              ) : null}

              {showGenerateCaption ? (
                <label
                  className={buttonVariants({
                    variant: 'outline',
                    className: 'cursor-pointer select-none',
                  })}
                >
                  <input
                    type="checkbox"
                    checked={generateCaption}
                    onChange={(event) =>
                      setGenerateCaption(event.target.checked)
                    }
                    className="size-4 accent-primary"
                  />
                  Generate Caption
                </label>
              ) : null}
            </div>
          </div>
          <Button
            variant="default"
            size="lg"
            className="h-[100px] cursor-pointer self-end text-lg font-semibold"
            onClick={handleGenerateClick}
            disabled={
              submitting ||
              (generationType !== 'Video' &&
                prompt.trim().length < POSTER_TEXT_MIN_CHARS)
            }
          >
            {submitting ? 'Generating...' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Page;
