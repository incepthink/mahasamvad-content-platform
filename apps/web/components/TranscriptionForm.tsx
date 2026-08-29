'use client';

// /transcribe's input step: attach recordings, press once, done. Deliberately the smallest
// form in the app — a transcription has no category, no heading and no style reference,
// because nothing downstream reads them.
//
// It is ONE card that carries its own action — the shape app/page.tsx uses:
//
//   TranscribeComposer — the recordings, the link panel, and the submit that acts on them
//
// It used to be three stacked cards with a plain button at the end of them, then one
// composer over a `GenerateBar` pinned to the foot of the viewport. The pinned bar earns
// its place where a form is several blocks long and the button would otherwise sit below
// optional material; here the composer IS the form, and everything under it (the result,
// the past runs) is output rather than input. So the action sits with the controls it acts
// on. This component still owns every piece of state the run is built from.
//
// The action is DISABLED until at least one source exists, so "nothing was supplied" is a
// dead button rather than an error after a press; the message survives for the share-target
// path below, which submits without anyone pressing anything.
//
// There is still no sessionStorage draft, unlike DloIntakeForm. A File is a live browser
// handle that cannot be serialized, and here it is the ONLY input: a draft that could
// remember nothing but the file names would be a promise this form cannot keep. The run
// itself survives a reload — it is a row, and the list below finds it again.

import { useEffect, useRef, useState } from 'react';
import {
  isAudioFileName,
  TRANSCRIPTION_MAX_FILES,
  type YouTubeVideo,
} from '@dgipr/schemas';
import { createTranscription } from '../lib/api';
import { consumeSharedAudio } from '../lib/sharedAudio';
import { TranscribeComposer } from './transcribe/TranscribeComposer';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';

export function TranscriptionForm({
  onStarted,
  busy,
}: {
  // Called with the new run's id, so the page can show its progress immediately.
  onStarted: (id: string) => void;
  // A run of this browser's is still going. Submitting a second is allowed by the API, but
  // the result card shows one run at a time, so the button waits.
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
      setError(errorMessage(e));
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
        // Kind only — the route has no per-file size ceiling any more, so neither may this
        // (a picker refusing what the server would accept costs the officer a recording).
        const accepted = shared
          .filter((file) => isAudioFileName(file.name))
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
    <TranscribeComposer
      files={files}
      onFilesChange={setFiles}
      youtube={youtube}
      onYoutubeChange={setYoutube}
      onError={setError}
      error={error}
      submitLabel={submitting ? STR.submitting : STR.transcribeSubmit}
      canSubmit={files.length > 0 || youtube.length > 0}
      submitBusy={submitting || busy}
      onSubmit={submit}
      disabled={submitting}
    />
  );
}
