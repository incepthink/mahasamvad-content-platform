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
  onClose,
}: {
  detail: TranscriptionDetail | null;
  error: string | null;
  onClose: () => void;
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
      <section className="card">
        <p className="form-error">{error}</p>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="card">
        <p className="hint">{STR.transcribeListLoading}</p>
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
    <section className="card">
      <div className="article-head">
        <h2>{STR.transcribeResultTitle}</h2>
        <StatusChip status={detail.status} />
      </div>
      <p className="hint">{detail.title}</p>

      {detail.status === 'queued' ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {STR.transcribeQueued}
        </p>
      ) : null}
      {detail.status === 'running' ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {STR.transcribeRunning}
        </p>
      ) : null}

      {/* The RUN's error — every recording failed, so there is no text at all. A single
          recording that failed among several is reported per file below instead. */}
      {detail.status === 'failed' && detail.error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {detail.error}
        </p>
      ) : null}

      {failed.length > 0 ? (
        <div className="info-callout warn" style={{ marginTop: 12 }}>
          <p>{STR.transcribeFileFailed}:</p>
          <ul>
            {failed.map((file) => (
              <li key={file.name}>
                {file.name}
                {file.error ? ` — ${file.error}` : ''}
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
                        {file.name}
                      </a>
                    ) : (
                      <span className="file-name">{file.name}</span>
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

          <p className="social-caption" style={{ marginTop: 14 }}>
            {text}
          </p>
          <p className="hint" style={{ marginTop: 6 }}>
            {text.length.toLocaleString('mr-IN')} {STR.transcribeCharsSuffix}
          </p>

          <div className="btn-row" style={{ marginTop: 16 }}>
            {/* First and primary: reading the transcript is the step before writing the
                article, so this is what the officer reaches for next. */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={toArticle}
            >
              {STR.transcribeToArticle}
            </button>
            <button type="button" className="btn" onClick={copy}>
              {copied ? STR.copied : STR.copyText}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadBlob(
                  `${STR.transcribeDownloadName}-${detail.id.slice(0, 8)}.txt`,
                  text,
                  'text/plain',
                )
              }
            >
              {STR.downloadTxt}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {STR.transcribeClose}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {STR.transcribeToArticleHint}
          </p>
        </>
      ) : null}
    </section>
  );
}
