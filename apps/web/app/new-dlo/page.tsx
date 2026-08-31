'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon, Loader2, Mic, Paperclip, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FileName } from '@/components/FileName';
import { createNewDloIntake } from '@/lib/newDlo';
import { errorMessage } from '@/lib/errorMessage';

/**
 * The DLO lane. The composer sits at the bottom of the page, where the cursor already is.
 *
 * ONE SUBMIT, AND NOTHING TO ANSWER BEFORE IT. The officer types what they want and attaches
 * whatever they have; the documents and photographs go to the article model as files, so
 * there is no page picker, no per-page reading state and no per-page card to work through.
 * That is the entire difference from /dlo, and it is why this page has no steps on it.
 *
 * Everything the composer holds is sent on ONE multipart field. The route classifies each
 * file by extension and decides for itself which are read by the model and which are
 * transcribed — a distinction the officer has no reason to make, and which the old lane made
 * them see as two separate pickers.
 */

type AttachmentKind = 'document' | 'image';

const Page = () => {
  const router = useRouter();
  const [prompt, setPrompt] = React.useState('');
  const [documents, setDocuments] = React.useState<File[]>([]);
  const [images, setImages] = React.useState<File[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const documentInput = React.useRef<HTMLInputElement>(null);
  const imageInput = React.useRef<HTMLInputElement>(null);

  const attachments: { file: File; kind: AttachmentKind }[] = [
    ...documents.map((file) => ({ file, kind: 'document' as const })),
    ...images.map((file) => ({ file, kind: 'image' as const })),
  ];

  const removeAttachment = (kind: AttachmentKind, name: string) => {
    const drop = (files: File[]) => files.filter((file) => file.name !== name);
    if (kind === 'document') setDocuments(drop);
    else setImages(drop);
  };

  // A note alone is a legitimate run, and so is a file alone — the same rule the route
  // enforces, stated here so the button is honest rather than so the server is spared.
  const canSubmit =
    !submitting && (prompt.trim().length > 0 || attachments.length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('notes', prompt.trim());
      for (const { file } of attachments) form.append('files', file);
      const id = await createNewDloIntake(form);
      // push, not replace: the composer is where a second piece of work is started, so
      // getting back to it must stay one gesture.
      router.push(`/new-dlo/${id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <div className="relative h-screen overflow-hidden">
      <div className="absolute bottom-4 left-1/2 w-full max-w-6xl -translate-x-1/2 rounded-2xl bg-white p-4 shadow-md">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        {attachments.length > 0 ? (
          <ul className="mb-3 flex flex-wrap gap-2">
            {attachments.map(({ file, kind }) => (
              <li
                key={`${kind}-${file.name}`}
                className="flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm"
              >
                {kind === 'image' ? (
                  <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Paperclip className="size-4 shrink-0" aria-hidden="true" />
                )}
                <FileName name={file.name} />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => removeAttachment(kind, file.name)}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 rounded p-0.5 hover:bg-muted disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={1}
              aria-label="Describe the article you want to write"
              placeholder="Describe the article you want to write..."
              className="max-h-28 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base leading-6 shadow-none outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none md:text-sm"
            />

            <div className="flex gap-2">
              {/* Not wired: recording is a real integration, not a layout. An MP3 the
                  officer already has goes in through the paperclip. */}
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label="Record audio"
              >
                <Mic />
              </Button>

              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label="Attach a document or recording"
                onClick={() => documentInput.current?.click()}
              >
                <Paperclip />
              </Button>

              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label="Attach an image"
                onClick={() => imageInput.current?.click()}
              >
                <ImageIcon />
              </Button>

              {/* sr-only rather than `hidden`: a display:none input cannot be
                  opened by a click in every browser. */}
              <input
                ref={documentInput}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm"
                className="sr-only"
                onChange={(event) => {
                  // Appended, not replaced: attaching a second time must not silently drop
                  // what the first pick added.
                  const picked = Array.from(event.target.files ?? []);
                  setDocuments((prev) => [...prev, ...picked]);
                  event.target.value = '';
                }}
              />
              <input
                ref={imageInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  setImages((prev) => [...prev, ...picked]);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <Button
            variant="default"
            size="lg"
            className="h-[100px] cursor-pointer self-end text-lg font-semibold"
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Starting…
              </>
            ) : (
              'Generate'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Page;
