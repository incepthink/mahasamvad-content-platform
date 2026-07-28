'use client';

// /transcribe — recordings in, Marathi text out, on ONE page.
//
// Unlike /dlo this is deliberately not a list-plus-workspace: a transcription has a single
// output with no review step, no category and no downstream generation, so a second route
// would only add a navigation to come back from. The result opens in place, under the form,
// and the history list below reopens any past run the same way.
//
// The selected run's id is kept in sessionStorage so a reload comes back to what was on
// screen. The RUN itself never depended on that — it is a row, and the list finds it either
// way; the storage only spares the officer having to look for it.

import { useEffect, useState } from 'react';
import { TranscriptionForm } from '../../components/TranscriptionForm';
import { TranscriptionList } from '../../components/TranscriptionList';
import { TranscriptionResult } from '../../components/TranscriptionResult';
import { useTranscription } from '../../lib/useTranscription';
import { useTranscriptionList } from '../../lib/useTranscriptionList';
import { STR } from '../../lib/strings';

const SELECTED_KEY = 'dgipr.transcribe.selected';

export default function TranscribePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { detail, error } = useTranscription(selectedId);
  const { items, loading, error: listError, refresh } = useTranscriptionList();

  // Read post-hydration so the server and first client render agree.
  useEffect(() => {
    setSelectedId(window.sessionStorage.getItem(SELECTED_KEY));
  }, []);

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) window.sessionStorage.setItem(SELECTED_KEY, id);
    else window.sessionStorage.removeItem(SELECTED_KEY);
  };

  // A new run has to appear in the list immediately: the list only polls while something is
  // already running, so without this nudge a first submit would leave it empty until the
  // next mount.
  const start = (id: string) => {
    select(id);
    void refresh();
  };

  // The selected run finishing is what the list is waiting for, so refresh once on the
  // transition rather than polling it in step with the detail.
  const settled = detail?.status === 'ready' || detail?.status === 'failed';
  useEffect(() => {
    if (settled) void refresh();
  }, [settled, detail?.id, refresh]);

  const busy = detail?.status === 'queued' || detail?.status === 'running';

  return (
    <main className="page">
      <h1 className="page-title">{STR.transcribeTitle}</h1>
      <p className="page-intro">{STR.transcribeIntro}</p>

      <TranscriptionForm onStarted={start} busy={busy} />

      {selectedId ? (
        <TranscriptionResult
          detail={detail}
          error={error}
          onClose={() => select(null)}
        />
      ) : null}

      <TranscriptionList
        items={items}
        loading={loading}
        error={listError}
        selectedId={selectedId}
        onOpen={select}
      />
    </main>
  );
}
