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
import { acceptFilePicks } from '../lib/filePicks';
import { consumeSharedAudio } from '../lib/sharedAudio';
import {
  splitRecordingPicks,
  useVideoExtraction,
} from '../lib/useVideoExtraction';
import { TranscribeComposer } from './transcribe/TranscribeComposer';
import { useAudioTrims } from '@/lib/useAudioTrims';
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
  // Which part of each recording the officer chose on the trim slider (lib/useAudioTrims).
  // Keyed on the picked `File`, so it is deliberately not persisted anywhere: a reload cannot
  // bring those objects back, and a restored window would belong to a recording that is gone.
  const audioTrims = useAudioTrims();
  const handledShare = useRef(false);

  // No size ceiling, matching /transcribe's own route — a picker refusing a two-hour
  // recording the server would have accepted costs the officer a source.
  const acceptRecordings = (picked: readonly File[]) => {
    const {
      files: next,
      added,
      error: pickError,
    } = acceptFilePicks({
      current: files,
      picked,
      isAllowedName: isAudioFileName,
      typeError: STR.dloFileTypeError,
    });
    setError(pickError);
    if (added > 0) setFiles(next.slice(0, TRANSCRIPTION_MAX_FILES));
  };

  // A picked VIDEO is converted to its audio track in the browser (lib/useVideoExtraction)
  // and joins the list above only once it is an ordinary recording — the video is never
  // uploaded.
  const extraction = useVideoExtraction((file) => acceptRecordings([file]));

  const pickRecordings = (picked: readonly File[]) => {
    const { audio, videos } = splitRecordingPicks(picked);
    if (audio.length > 0) acceptRecordings(audio);
    void extraction.start(videos);
  };

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
      // The chosen windows, keyed by position among the recordings just appended. Omitted
      // entirely when nothing was trimmed, which is what keeps an ordinary run's request
      // byte-for-byte what it was.
      const trimField = audioTrims.fieldValue(selectedFiles);
      if (trimField !== null) form.append('audioTrims', trimField);
      // Links, not bytes — nothing about the video travels in this request.
      if (selectedYoutube.length > 0) {
        form.append('youtube', JSON.stringify(selectedYoutube));
      }
      const id = await createTranscription(form);
      // The run owns these sources now, so both lists are emptied — otherwise the next
      // submit would silently transcribe (and archive) the same ones again.
      setFiles([]);
      setYoutube([]);
      audioTrims.clear();
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
      .then(async (shared) => {
        // Kind only — the route has no per-file size ceiling any more, so neither may this
        // (a picker refusing what the server would accept costs the officer a recording).
        // A shared VIDEO (WhatsApp, the camera app) is converted first, on the phone, with
        // the same progress card a picked one gets; the auto-submit waits for it.
        const { audio, videos } = splitRecordingPicks(
          shared.slice(0, TRANSCRIPTION_MAX_FILES),
        );
        const accepted = audio.filter((file) => isAudioFileName(file.name));
        if (accepted.length === 0 && videos.length === 0) {
          setSubmitting(false);
          setError(STR.dloFileTypeError);
          return;
        }
        setFiles(accepted);
        const extracted = await extraction.start(videos);
        const ready = [...accepted, ...extracted].slice(
          0,
          TRANSCRIPTION_MAX_FILES,
        );
        // Every shared video failed and nothing else came with them: the reason is on each
        // card, so there is nothing to submit and nothing more to say.
        if (ready.length === 0) {
          setSubmitting(false);
          return;
        }
        return submitSources(ready, []);
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
      audioTrims={audioTrims}
      extraction={extraction}
      onPickRecordings={pickRecordings}
      onFilesChange={(next) => {
        setFiles(next);
        // A removed recording's window goes with it, or re-attaching that same file later
        // would bring back a selection the officer had already discarded.
        audioTrims.retain(next);
      }}
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
