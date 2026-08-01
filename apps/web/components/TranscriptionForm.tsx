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

import { useState } from 'react';
import { TRANSCRIPTION_MAX_FILES, type YouTubeVideo } from '@dgipr/schemas';
import { createTranscription } from '../lib/api';
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

  const submit = async () => {
    if (files.length === 0 && youtube.length === 0) {
      setError(STR.transcribeNeedFile);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file, file.name);
      // Links, not bytes — nothing about the video travels in this request.
      if (youtube.length > 0) form.append('youtube', JSON.stringify(youtube));
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
        onSubmit={() => void submit()}
        submitting={submitting}
        busy={busy}
        error={error}
      />
    </>
  );
}
