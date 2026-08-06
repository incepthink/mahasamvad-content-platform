'use client';

// /transcribe's input step: pick recordings, submit, done. Deliberately the smallest form in
// the app — a transcription has no category, no heading and no style reference, because
// nothing downstream reads them.
//
// It is two cards, matching /dlo's intake form: the shared <AudioFilePicker> holds the files,
// and <TranscriptionSubmit> below it holds the action. This component owns only the state the
// two share, so the picker looks identical on both surfaces by construction rather than by
// two sets of markup being kept in step.
//
// There is no sessionStorage draft either, unlike DloIntakeForm. A File is a live browser
// handle that cannot be serialized, and here it is the ONLY input: a draft that could
// remember nothing but the file names would be a promise this form cannot keep. The run
// itself survives a reload — it is a row, and the list below finds it again.

import { useEffect, useRef, useState } from 'react';
import {
  isAudioFileName,
  TRANSCRIPTION_MAX_FILES,
  UPLOAD_FILE_MAX_BYTES,
  type YouTubeVideo,
} from '@dgipr/schemas';
import { createTranscription } from '../lib/api';
import { consumeSharedAudio } from '../lib/sharedAudio';
import { AudioFilePicker } from './AudioFilePicker';
import { TranscriptionSubmit } from './TranscriptionSubmit';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';

export function TranscriptionForm({
  onStarted,
  busy,
}: {
  // Called with the new run's id, so the page can show its progress immediately.
  onStarted: (id: string) => void;
  busy: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [youtube, setYoutube] = useState<readonly YouTubeVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handledShare = useRef(false);

  const submitSources = async (
    selectedFiles: readonly File[],
    selectedYoutube: readonly YouTubeVideo[],
  ) => {
    if (selectedFiles.length === 0 && selectedYoutube.length === 0) {
      setError(STR.transcribeNeedFile);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of selectedFiles) {
        form.append('files', file, file.name);
      }
      // Links, not bytes — nothing about the video travels in this request.
      if (selectedYoutube.length > 0) {
        form.append('youtube', JSON.stringify(selectedYoutube));
      }
      const id = await createTranscription(form);
      // The run owns these sources now, so both lists are emptied — otherwise the next
      // submit would silently transcribe (and archive) the same ones again.
      setFiles([]);
      setYoutube([]);
      onStarted(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => void submitSources(files, youtube);

  // An Android Share Target launch is intentionally zero-form: recover the recordings the
  // service worker held on the phone and start transcription immediately. Remove the query
  // token first so a refresh cannot submit the same recording twice. If upload fails, the
  // File objects remain in state and the ordinary submit button is a retry.
  useEffect(() => {
    if (handledShare.current) return;
    const url = new URL(window.location.href);
    const shareId = url.searchParams.get('share');
    const shareError = url.searchParams.get('share_error');
    if (!shareId && !shareError) return;
    handledShare.current = true;
    url.searchParams.delete('share');
    url.searchParams.delete('share_error');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );

    if (shareError) {
      // The service worker distinguishes "nothing usable was shared" from "every recording
      // was over the per-file ceiling", which are different things to do next.
      setError(
        shareError === 'too-large'
          ? STR.fileTooLargeError
          : STR.transcribeSharedReadError,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    void consumeSharedAudio(shareId!)
      .then((shared) => {
        const accepted = shared
          .filter(
            (file) =>
              isAudioFileName(file.name) && file.size <= UPLOAD_FILE_MAX_BYTES,
          )
          .slice(0, TRANSCRIPTION_MAX_FILES);
        if (accepted.length === 0) {
          setSubmitting(false);
          setError(STR.dloFileTypeError);
          return;
        }
        setFiles(accepted);
        return submitSources(accepted, []);
      })
      .catch((caught: unknown) => {
        console.error('[share-target] Could not consume shared audio:', caught);
        setSubmitting(false);
        setError(STR.transcribeSharedReadError);
      });
    // The share token is a one-shot navigation input, deliberately read on mount only.
  }, []);

  return (
    <>
      <AudioFilePicker
        title={STR.transcribeNewTitle}
        hint={STR.transcribeHint}
        uploadLabel={STR.transcribeUpload}
        filesTitle={STR.transcribeFilesTitle}
        files={files}
        onChange={setFiles}
        onError={setError}
        maxFiles={TRANSCRIPTION_MAX_FILES}
        disabled={submitting}
      />

      <YouTubeLinkInput
        videos={youtube}
        onChange={setYoutube}
        onError={setError}
        disabled={submitting}
        maxLinks={TRANSCRIPTION_MAX_FILES}
      />

      <TranscriptionSubmit
        onSubmit={submit}
        submitting={submitting}
        busy={busy}
        error={error}
      />
    </>
  );
}
