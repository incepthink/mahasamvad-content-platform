'use client';

// The result card on /transcribe: progress while the run works, the Marathi text when it is
// done. Rendered on the same page as the form — there is no separate workspace, because
// there is nothing to do to a transcript here beyond reading, copying and saving it.
//
// The transcript is shown READ-ONLY. This page's contract is "the recording, verbatim"; an
// editable box would invite corrections that nothing would then persist. Correcting text
// before it becomes an article is /dlo's review step, which exists for exactly that.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// CirclePlay stands in for a YouTube mark: lucide 1.x carries no brand icons.
import { CirclePlay } from 'lucide-react';
import type { TranscriptionDetail } from '@dgipr/schemas';
import { downloadBlob } from '../lib/download';
import { seedDraftNotes } from '../lib/dloDraft';
import { STR, TRANSCRIPTION_STATUS_LABELS } from '../lib/strings';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';
import { Button } from './ui/button';
import { storedErrorMessage } from '../lib/errorMessage';

const RESULT_CARD_CLASS = 'bg-card rounded-2xl border p-4 shadow-sm sm:p-5';

function StatusChip({ status }: { status: TranscriptionDetail['status'] }) {
  const entry = TRANSCRIPTION_STATUS_LABELS[status] ?? {
    label: status,
    chip: 'queued' as const,
  };
  return <span className={`chip chip-${entry.chip}`}>{entry.label}</span>;
}

export function TranscriptionResult({
  detail,
  error,
  onRetry,
}: {
  detail: TranscriptionDetail | null;
  error: string | null;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  // Reset the "copied ✓" flash when a different run is opened, or it would greet the next
  // transcript already claiming to have been copied.
  useEffect(() => {
    setCopied(false);
  }, [detail?.id]);

  if (error && !detail) {
    return (
      <section className={RESULT_CARD_CLASS}>
        <ErrorNotice
          message={error}
          fallback={STR.transcribeLoadFailed}
          onRetry={onRetry}
        />
      </section>
    );
  }
  if (!detail) {
    return (
      <section className={RESULT_CARD_CLASS}>
        <p className="text-muted-foreground m-0 text-sm">
          {STR.transcribeListLoading}
        </p>
      </section>
    );
  }

  const text = detail.combinedText ?? '';
  const failed = detail.files.filter((file) => file.status === 'failed');

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Hand this transcript to /dlo as the note of a new intake. The text travels through the
  // draft rather than through the URL: it is a whole meeting's worth of Marathi, which no
  // query string can carry, and the draft is already what /dlo's form reads on mount — so
  // the officer lands on a form that opens with the transcript in it and every other input
  // untouched.
  //
  // Whatever produced that text — an uploaded recording or a pasted YouTube link — only the
  // TEXT goes. The words have already been transcribed and paid for; re-attaching the source
  // would have the intake job transcribe it again and show it twice at review.
  const toArticle = () => {
    seedDraftNotes(text);
    router.push('/dlo');
  };

  return (
    <section className={RESULT_CARD_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-foreground m-0 text-base font-semibold">
          {STR.transcribeResultTitle}
        </h2>
        <StatusChip status={detail.status} />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{detail.title}</p>

      {detail.status === 'queued' ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {STR.transcribeQueued}
        </p>
      ) : null}
      {detail.status === 'running' ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {STR.transcribeRunning}
        </p>
      ) : null}

      {/* The RUN's error — every recording failed, so there is no text at all. A single
          recording that failed among several is reported per file below instead. */}
      {detail.status === 'failed' && detail.error ? (
        <ErrorNotice
          message={storedErrorMessage(detail.error, STR.genericError)}
        />
      ) : null}

      {failed.length > 0 ? (
        <div className="info-callout warn" style={{ marginTop: 12 }}>
          <p>{STR.transcribeFileFailed}:</p>
          <ul>
            {failed.map((file) => (
              <li key={file.name}>
                <FileName name={file.name} />
                {file.error
                  ? ` — ${storedErrorMessage(file.error, STR.genericError)}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {text ? (
        <>
          {/* Per-recording line, so a multi-file run shows which source produced what — and
              whether a transcript was reused rather than re-run. */}
          {detail.files.length > 1 ? (
            <ul className="transcribe-source-list">
              {detail.files
                .filter((file) => file.status === 'done')
                .map((file) => (
                  <li key={file.name}>
                    {/* A source that came from a link is named as one and stays clickable,
                        so the transcript can be checked against what was actually said. */}
                    {file.sourceUrl ? (
                      <a
                        className="file-name yt-source-link"
                        href={file.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <CirclePlay size={14} aria-hidden="true" />
                        <FileName name={file.name} />
                      </a>
                    ) : (
                      <FileName name={file.name} className="file-name" />
                    )}
                    <span className="file-size">
                      {(file.chars ?? 0).toLocaleString('mr-IN')}{' '}
                      {STR.transcribeCharsSuffix}
                      {file.cached ? ` · ${STR.transcribeCached}` : ''}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}

          <div className="article-body mt-4">{text}</div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* First and primary: reading the transcript is the step before writing the
                article, so this is what the officer reaches for next. */}
            <Button type="button" onClick={toArticle}>
              {STR.transcribeToArticle}
            </Button>
            <Button variant="outline" type="button" onClick={copy}>
              {copied ? STR.copied : STR.copyText}
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                downloadBlob(
                  `${STR.transcribeDownloadName}-${detail.id.slice(0, 8)}.txt`,
                  text,
                  'text/plain',
                )
              }
            >
              {STR.downloadTxt}
            </Button>
            <span className="text-muted-foreground ms-auto text-sm">
              {text.length.toLocaleString('mr-IN')}{' '}
              {STR.transcribeCharsSuffix}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
