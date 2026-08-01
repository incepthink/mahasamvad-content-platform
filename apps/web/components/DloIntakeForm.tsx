'use client';

// The /dlo input step: free-text notes + MP3 recordings + documents + article type, submitted
// as a new intake. On success it navigates to /dlo/[id], where the rest of the flow lives.
//
// Recordings and documents take DIFFERENT routes in, and the split is about what each costs to
// read. A recording has to be transcribed by Sarvam, so it is uploaded with the intake and read
// by the job. A document is read RIGHT HERE by the shared ephemeral service (<DocumentIntake>),
// which is what puts the page picker in front of the officer the moment a scanned PDF is
// attached instead of several minutes and one form-submit later. Reading it here is optional
// though — the live page SELECTION is handed over unread by default and the intake job reads
// exactly those pages during प्रक्रिया, which the run was going to sit through anyway.
//
// Everything typed here is drafted to sessionStorage (lib/dloDraft), so navigating to another
// tab — or reloading — does not lose it. The one exception is the picked MP3s: a File is a live
// browser handle that cannot be serialized, so within a session they ride in a module variable
// and across a reload only their names survive, and the form asks for them back by name.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DloCategory,
  DloPreReadDocument,
  YouTubeVideo,
} from '@dgipr/schemas';
import {
  ARTICLE_INSTRUCTIONS_MAX_CHARS,
  UPLOAD_FILE_MAX_BYTES,
} from '@dgipr/schemas';
import { createDloIntake } from '../lib/api';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearPendingAudio,
  getPendingAudio,
  readDraft,
  rememberMyIntakeId,
  setPendingAudio,
  writeDraft,
} from '../lib/dloDraft';
import { AiInstructionsField } from './AiInstructionsField';
import { AudioFilePicker } from './AudioFilePicker';
import { DloCategoryPicker } from './DloCategoryPicker';
import { DocumentIntake, type DocumentSnapshot } from './DocumentIntake';
import { StyleReferenceField } from './StyleReferenceField';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';

// This picker takes recordings only; documents go through <DocumentIntake>. Which
// containers count as a recording is @dgipr/schemas' AUDIO_FILE_* — the same list the API
// validates against, so the picker can never offer a file the upload would refuse.

// One document upload card. Slots are identified by a counter rather than by array index so
// that removing one cannot make the next card adopt its neighbour's in-flight job.
type DocumentSlot = Readonly<{ id: number; snapshot: DocumentSnapshot | null }>;

// Same ceiling the API puts on the documents array.
const MAX_DOCUMENTS = 10;

// Where each slot's card remembers its in-flight job across a refresh — a long OCR must
// survive one. Cleared by hand when a slot is dropped or the run is submitted, or the card
// would silently re-attach a document that has already been used.
function documentStorageKey(id: number): string {
  return `dgipr.dlo.document.${id}`;
}

// The wire shape: a PDF travels as the pages the officer kept (with their corrections), a
// DOCX/TXT as one string. `jobId` lets the API archive the original from the ephemeral job it
// is still holding, rather than making the browser upload the same bytes twice.
//
// A scan handed over from the initial picker is the exception: it has no text yet, so it
// travels as the page SELECTION alone and the intake job reads exactly those pages out of that
// archive. That makes the archive load-bearing rather than a convenience — without it there is
// nothing to read, which is why the API fails such a file instead of dropping it quietly.
function toPreReadDocument(snapshot: DocumentSnapshot): DloPreReadDocument {
  if (snapshot.pendingPages.length > 0) {
    return {
      jobId: snapshot.jobId,
      name: snapshot.fileName,
      kind: snapshot.kind,
      ...(snapshot.pageCount !== null ? { pageCount: snapshot.pageCount } : {}),
      pendingPages: [...snapshot.pendingPages],
    };
  }
  return {
    jobId: snapshot.jobId,
    name: snapshot.fileName,
    kind: snapshot.kind,
    ...(snapshot.pageCount !== null ? { pageCount: snapshot.pageCount } : {}),
    ...(snapshot.kind === 'pdf'
      ? {
          // Which backend read it is a PDF question — the review step badges it, and it
          // gates the "read it with OCR instead" offer. A .txt has no second reader.
          ...(snapshot.source !== null ? { pdfSource: snapshot.source } : {}),
          pages: snapshot.pages.map((page) => ({ ...page })),
        }
      : {
          text: snapshot.pages
            .map((page) => page.text)
            .filter((text) => text.trim().length > 0)
            .join('\n\n'),
        }),
  };
}

export function DloIntakeForm() {
  const router = useRouter();
  const restored = useRef<ReturnType<typeof readDraft>>(null);
  if (restored.current === null) restored.current = readDraft();
  const draft = restored.current ?? EMPTY_DRAFT;

  const [notes, setNotes] = useState(draft.notes);
  const [files, setFiles] = useState<File[]>(() => getPendingAudio());
  // Recordings that were picked before a reload and could not survive it — names only, so the
  // form can ask for them back instead of silently submitting without them.
  const [lostAudioNames, setLostAudioNames] = useState<readonly string[]>(() =>
    getPendingAudio().length === 0 ? draft.audioNames : [],
  );
  const [documents, setDocuments] = useState<DocumentSlot[]>(() =>
    draft.documentSlotIds.map((id) => ({ id, snapshot: null })),
  );
  // YouTube sources. Restored from the draft in full, unlike the recordings — a link is a
  // string, so a reload loses nothing.
  const [youtube, setYoutube] = useState<readonly YouTubeVideo[]>(draft.youtube);
  const nextSlotId = useRef(draft.nextSlotId);
  const [category, setCategory] = useState<DloCategory>(draft.category);
  const [heading, setHeading] = useState(draft.heading);
  // Tier 1 of the article's style-reference hierarchy: a published article the officer wants
  // this one shaped like. Style only — never a factual source (see StyleReferenceField).
  const [styleReference, setStyleReference] = useState(draft.styleReference);
  // The officer's own direction for the article (generations.instructions, 0041). Like the
  // style reference it is only USED at generate time, so both are handed to the review step
  // through the intake's saved review state rather than being asked for twice.
  const [instructions, setInstructions] = useState(draft.instructions);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep the draft current. Debounced, because this fires on every keystroke of the notes box.
  useEffect(() => {
    const timer = setTimeout(() => {
      writeDraft({
        notes,
        category,
        heading,
        styleReference,
        instructions,
        documentSlotIds: documents.map((slot) => slot.id),
        nextSlotId: nextSlotId.current,
        audioNames: files.map((file) => file.name),
        youtube,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    notes,
    category,
    heading,
    styleReference,
    instructions,
    documents,
    files,
    youtube,
  ]);

  // Recordings ride in a module variable so client-side navigation away and back keeps them.
  useEffect(() => {
    setPendingAudio(files);
  }, [files]);

  // The picker decides which picks are allowed in and reports the rest; this only has to
  // notice that a recording a reload could not keep has been attached again.
  const changeFiles = (next: File[]) => {
    setFiles(next);
    setLostAudioNames((prev) =>
      prev.filter((name) => !next.some((file) => file.name === name)),
    );
  };

  // Every document with something to send: pages that were read, or — by default for a scan
  // still at its initial picker — the pages picked for the intake job to read. A slot whose
  // file is still loading, or whose pages are all unticked, contributes nothing either way and
  // is simply not sent.
  const attachedDocuments = documents.flatMap((slot) =>
    slot.snapshot &&
    (slot.snapshot.pages.length > 0 || slot.snapshot.pendingPages.length > 0)
      ? [slot.snapshot]
      : [],
  );

  const addDocumentSlot = () => {
    setDocuments((prev) =>
      prev.length >= MAX_DOCUMENTS
        ? prev
        : [...prev, { id: nextSlotId.current++, snapshot: null }],
    );
    setError(null);
  };

  // Dropping a slot must take its stored job id with it, or the next card mounted under
  // that key would re-attach the document that was just removed.
  const removeDocumentSlot = (id: number) => {
    window.sessionStorage.removeItem(documentStorageKey(id));
    setDocuments((prev) => prev.filter((slot) => slot.id !== id));
    setError(null);
  };

  // A submitted run CONSUMES its inputs: the intake now owns the documents' text, so the cards
  // are emptied and their job ids forgotten, and the draft goes with them. Called only after
  // the create succeeds — a failed create must leave everything exactly where it was.
  const clearInputs = () => {
    for (const slot of documents) {
      window.sessionStorage.removeItem(documentStorageKey(slot.id));
    }
    setDocuments([]);
    setYoutube([]);
    clearPendingAudio();
    clearDraft();
  };

  // No upper bound on the typed notes: /dlo's material is a meeting's worth of source, and
  // the API's create route validates only that SOMETHING was supplied. The reviewed text
  // that becomes the article is likewise uncapped (DloGenerateRequestSchema).
  const submit = async () => {
    if (
      notes.trim().length === 0 &&
      files.length === 0 &&
      attachedDocuments.length === 0 &&
      youtube.length === 0
    ) {
      setError(STR.dloNeedInput);
      return;
    }
    // Checked here as well as server-side so the officer gets a Marathi message instead of an
    // opaque 400 after the whole upload has gone up.
    if (instructions.trim().length > ARTICLE_INSTRUCTIONS_MAX_CHARS) {
      setError(STR.aiInstructionsTooLong);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('notes', notes);
      form.append('category', category);
      form.append('heading', heading);
      // Neither is used until the article is generated, and neither has a column on
      // dlo_intakes — the create route seeds them into the intake's review state, which is
      // what makes the review step open with what was typed here instead of empty boxes.
      if (instructions.trim()) form.append('instructions', instructions.trim());
      if (styleReference.trim()) {
        form.append('styleReference', styleReference.trim());
      }
      for (const file of files) form.append('files', file, file.name);
      // Documents were handled here, at the input step, so read ones travel as text rather
      // than bytes — which stops a scanned PDF being OCR'd a second time by the job. A scan
      // still at its initial picker travels as its page selection instead and IS read by the
      // job, once.
      if (attachedDocuments.length > 0) {
        form.append(
          'documents',
          JSON.stringify(attachedDocuments.map(toPreReadDocument)),
        );
      }
      // Links, not bytes: nothing about the video travels in this request or is stored, and
      // the transcriber fetches the media itself during प्रक्रिया.
      if (youtube.length > 0) {
        form.append('youtube', JSON.stringify(youtube));
      }
      const id = await createDloIntake(form);
      clearInputs();
      // Ordering only — see lib/dloDraft. This never becomes a permission.
      rememberMyIntakeId(id);
      router.push(`/dlo/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* The article type comes first: it is the one decision that frames everything typed
          below it, and it is a single click. */}
      <section className="card">
        <DloCategoryPicker value={category} onChange={setCategory} />
      </section>

      <section className="card">
        <h2>{STR.dloNewWorkTitle}</h2>
        <p className="hint">{STR.dloIntro}</p>
        <label
          className="field-label"
          htmlFor="dlo-notes"
          style={{ marginTop: 16 }}
        >
          {STR.dloNotesLabel}
        </label>
        <p className="hint">{STR.dloNotesHint}</p>
        <textarea
          id="dlo-notes"
          className="note-input"
          placeholder={STR.dloNotesPlaceholder}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          style={{ marginTop: 10 }}
        />
        {notes.length > 0 ? (
          <p className="hint" style={{ marginTop: 6 }}>
            {notes.length.toLocaleString('mr-IN')} {STR.dloCharsSuffix}
          </p>
        ) : null}
      </section>

      {/* Recordings and documents get a control each. A recording is transcribed whole and has
          nothing to pick; a document is read page by page and, if it is a scan, its pages are
          chosen before any OCR is paid for. Asking for them together made one picker stand for
          two different jobs. */}
      <AudioFilePicker
        title={STR.dloAudioTitle}
        hint={STR.dloAudioHint}
        uploadLabel={STR.dloAudioUpload}
        filesTitle={STR.dloAudioFilesTitle}
        files={files}
        onChange={changeFiles}
        onError={setError}
        notice={
          lostAudioNames.length > 0 ? (
            <div className="info-callout" style={{ marginTop: 12 }}>
              <p>{STR.dloDraftAudioLost}</p>
              <ul>
                {lostAudioNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          ) : null
        }
      />

      {/* Directly under the recordings, because it is the same kind of source arriving a
          different way: a pasted link is transcribed in the very same phase. Nothing is
          downloaded here or by the job — the transcriber fetches the video itself. */}
      <YouTubeLinkInput
        videos={youtube}
        onChange={setYoutube}
        onError={setError}
      />

      {/* One card per document, each probing its file HERE — so a scanned PDF asks which pages
          are worth OCR'ing the moment it is attached. The selected pages are handed to the
          intake job unread by default; reading them in this card remains optional. */}
      {documents.map((slot) => (
        <DocumentIntake
          key={slot.id}
          storageKey={documentStorageKey(slot.id)}
          accept={['pdf', 'docx', 'txt']}
          title={STR.dloDocsCardTitle}
          hint={STR.dloDocsIntakeHint}
          // Same per-file ceiling as this form's recordings. Only /dlo passes it: the shared
          // document service has no upload cap of its own, so this is a limit on what an
          // INTAKE will carry, not a new rule for /translate or /proofread.
          maxBytes={UPLOAD_FILE_MAX_BYTES}
          // /dlo is the one surface that can read a scan later: its live initial selection is
          // the handover, and the intake job reads exactly those pages from the archived
          // original. Waiting for OCR in this card is optional, not the price of going on.
          allowDeferredRead
          onTextChange={(_text, snapshot) => {
            setDocuments((prev) =>
              // Every card reports once on mount with nothing loaded; rebuilding the list for
              // that would re-render the whole step for no change.
              prev.some(
                (entry) => entry.id === slot.id && entry.snapshot !== snapshot,
              )
                ? prev.map((entry) =>
                    entry.id === slot.id ? { ...entry, snapshot } : entry,
                  )
                : prev,
            );
            if (snapshot) setError(null);
          }}
          {...(documents.length > 1
            ? { onRemove: () => removeDocumentSlot(slot.id) }
            : {})}
        />
      ))}

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-small"
            disabled={documents.length >= MAX_DOCUMENTS}
            onClick={addDocumentSlot}
          >
            {STR.dloDocsAdd}
          </button>
        </div>
      </section>

      <section className="card">
        <label className="field-label" htmlFor="dlo-heading">
          {STR.headingLabel}
        </label>
        <p className="hint">{STR.headingHint}</p>
        <input
          id="dlo-heading"
          type="text"
          placeholder={STR.headingPlaceholder}
          value={heading}
          onChange={(event) => setHeading(event.target.value)}
          style={{ marginTop: 10 }}
        />
      </section>

      {/* The two style-side inputs, in the order an officer thinks about them: what the
          article should do, then what it should read like. Both travel to the review step,
          where they can still be changed before anything is generated. */}
      <AiInstructionsField value={instructions} onChange={setInstructions} />

      <StyleReferenceField
        value={styleReference}
        onChange={setStyleReference}
      />

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? STR.submitting : STR.dloSubmit}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </>
  );
}
