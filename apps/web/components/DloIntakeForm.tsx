'use client';

// The /dlo input step: free-text notes + MP3 recordings + documents, submitted as a new
// intake. On success it navigates to /dlo/[id], where the rest of the flow lives.
//
// There is no article-type question here: this lane produces बातमी only, so the category is
// fixed (DLO_CATEGORY below) rather than asked for.
//
// Every file source is ASKED FOR in one card (<DloSourcesCard>) — recordings, photographs and
// documents share one row of buttons, because "what do you want to add?" is one question and
// three cards asking it made the officer scroll past two they were not using. This component
// still owns the lists themselves: it is what drafts and submits them.
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
//
// The one action sits in a bar pinned to the bottom of the viewport rather than in a card above
// the fields. The form is several cards long, so a button at the top scrolls out of reach the
// moment the officer starts working and a button at the bottom is only reachable after all the
// optional material they did not fill in; pinned, it is in the same place throughout. It is
// DISABLED until at least one source exists (see hasInput), so the "nothing was supplied"
// refusal is expressed as a dead button instead of as an error after a press.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heading1, NotebookPen } from 'lucide-react';
import type {
  DloCategory,
  DloPreReadDocument,
  YouTubeVideo,
} from '@dgipr/schemas';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from '@dgipr/schemas';
import { createDloIntake } from '../lib/api';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearPendingAudio,
  clearPendingImages,
  getPendingAudio,
  getPendingImages,
  readDraft,
  rememberMyIntakeId,
  setPendingAudio,
  setPendingImages,
  writeDraft,
} from '../lib/dloDraft';
import { AiInstructionsField } from './AiInstructionsField';
import { ComposeSafeInput, ComposeSafeTextarea } from './ComposeSafeInput';
import { DloSourcesCard } from './DloSourcesCard';
import { DocumentIntake, type DocumentSnapshot } from './DocumentIntake';
import { StyleReferenceField } from './StyleReferenceField';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { ErrorNotice } from './ErrorNotice';

// This picker takes recordings only; documents go through <DocumentIntake>. Which
// containers count as a recording is @dgipr/schemas' AUDIO_FILE_* — the same list the API
// validates against, so the picker can never offer a file the upload would refuse.

// One document upload card. Slots are identified by a counter rather than by array index so
// that removing one cannot make the next card adopt its neighbour's in-flight job.
type DocumentSlot = Readonly<{ id: number; snapshot: DocumentSnapshot | null }>;

// The only article type this lane produces. The picker is gone from this form, so a draft
// saved before that change (category: 'scheme') is simply not read back.
const DLO_CATEGORY: DloCategory = 'news';

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
  // Photographs of documents. They ride the SAME multipart `files` field as the recordings —
  // the API classifies an upload by its extension — so this is a second picker, not a second
  // upload path; the two are separate state only because they are separate cards.
  const [images, setImages] = useState<File[]>(() => getPendingImages());
  const [lostImageNames, setLostImageNames] = useState<readonly string[]>(() =>
    getPendingImages().length === 0 ? draft.imageNames : [],
  );
  const [documents, setDocuments] = useState<DocumentSlot[]>(() =>
    draft.documentSlotIds.map((id) => ({ id, snapshot: null })),
  );
  // YouTube sources. Restored from the draft in full, unlike the recordings — a link is a
  // string, so a reload loses nothing.
  const [youtube, setYoutube] = useState<readonly YouTubeVideo[]>(draft.youtube);
  const nextSlotId = useRef(draft.nextSlotId);
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
        category: DLO_CATEGORY,
        heading,
        styleReference,
        instructions,
        documentSlotIds: documents.map((slot) => slot.id),
        nextSlotId: nextSlotId.current,
        audioNames: files.map((file) => file.name),
        imageNames: images.map((file) => file.name),
        youtube,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    notes,
    heading,
    styleReference,
    instructions,
    documents,
    files,
    images,
    youtube,
  ]);

  // Recordings ride in a module variable so client-side navigation away and back keeps them.
  useEffect(() => {
    setPendingAudio(files);
  }, [files]);

  useEffect(() => {
    setPendingImages(images);
  }, [images]);

  // The picker decides which picks are allowed in and reports the rest; this only has to
  // notice that a recording a reload could not keep has been attached again.
  const changeFiles = (next: File[]) => {
    setFiles(next);
    setLostAudioNames((prev) =>
      prev.filter((name) => !next.some((file) => file.name === name)),
    );
  };

  const changeImages = (next: File[]) => {
    setImages(next);
    setLostImageNames((prev) =>
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

  // What the submit guard below tests, lifted out so the bar's button can be disabled by the
  // same condition rather than by a second, drifting copy of it. "Any valid input" is any ONE
  // source: typed notes, a recording, a photograph, a document with something to send, or a
  // link. Everything else on the form (heading, instructions, style reference) is direction for
  // material that does not exist yet, so none of it can enable the run on its own.
  const hasInput =
    notes.trim().length > 0 ||
    files.length > 0 ||
    images.length > 0 ||
    attachedDocuments.length > 0 ||
    youtube.length > 0;

  // The one slot that was just asked for, so its card opens the file dialog on arrival and no
  // other card ever does. A ref rather than state: it is read during the very render the
  // setDocuments below schedules, and it must NOT be restored from the draft — a reload
  // recreating slots is not the officer pressing "attach a document".
  const autoOpenSlotId = useRef<number | null>(null);

  // No ceiling on the number of documents: a meeting can produce a dozen GRs, and the API
  // stopped capping the array for the same reason (DloCreateDocumentsSchema).
  const addDocumentSlot = () => {
    const id = nextSlotId.current++;
    autoOpenSlotId.current = id;
    setDocuments((prev) => [...prev, { id, snapshot: null }]);
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
    setImages([]);
    clearPendingAudio();
    clearPendingImages();
    clearDraft();
  };

  // No upper bound on the typed notes: /dlo's material is a meeting's worth of source, and
  // the API's create route validates only that SOMETHING was supplied. The reviewed text
  // that becomes the article is likewise uncapped (DloGenerateRequestSchema).
  const submit = async () => {
    // Kept as a guard even though the button is disabled without it: the disabled state is a
    // courtesy, this is the rule.
    if (!hasInput) {
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
      form.append('category', DLO_CATEGORY);
      form.append('heading', heading);
      // Neither is used until the article is generated, and neither has a column on
      // dlo_intakes — the create route seeds them into the intake's review state, which is
      // what makes the review step open with what was typed here instead of empty boxes.
      if (instructions.trim()) form.append('instructions', instructions.trim());
      if (styleReference.trim()) {
        form.append('styleReference', styleReference.trim());
      }
      // Recordings and photographs share one field: the route classifies each part by its
      // extension, so a second field would only be a second way to say the same thing.
      for (const file of files) form.append('files', file, file.name);
      for (const image of images) form.append('files', image, image.name);
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
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* The card's own title and blurb are deliberately absent: the page header above already
          says what /dlo is for, and the notes label below says what this box takes. Repeating
          either put three sentences between the officer and the first thing they type. */}
      <section className="card">
        <label className="field-label" htmlFor="dlo-notes">
          <NotebookPen size={18} className="label-icon" aria-hidden="true" />
          {STR.dloNotesLabel}
        </label>
        <p className="hint">{STR.dloNotesHint}</p>
        {/* Uncontrolled by design: this is the box officers type Marathi into all day, and an
            InScript keyboard assembles each character in stages a controlled box can overwrite
            half-formed. See ComposeSafeInput. */}
        <ComposeSafeTextarea
          id="dlo-notes"
          className="note-input"
          placeholder={STR.dloNotesPlaceholder}
          value={notes}
          onChange={setNotes}
          style={{ marginTop: 10 }}
        />
        {notes.length > 0 ? (
          <p className="hint" style={{ marginTop: 6 }}>
            {notes.length.toLocaleString('mr-IN')} {STR.dloCharsSuffix}
          </p>
        ) : null}
      </section>

      {/* Every file source in one card: recordings, photographs and documents share the
          question "what do you want to add?", so they share a card and a row of buttons. How
          each is READ still differs and the card says so — a recording is transcribed whole
          during प्रक्रिया, a photograph is one page read in the same phase, and a document is
          read here and now, page by page, with a scan stopping to ask which pages are worth
          OCR'ing before a credit is spent. That last one is why documents keep a block of
          their own inside the card. */}
      <DloSourcesCard
        files={files}
        onFilesChange={changeFiles}
        images={images}
        onImagesChange={changeImages}
        documentCount={documents.length}
        onAddDocument={addDocumentSlot}
        onError={setError}
        audioNotice={
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
        imageNotice={
          lostImageNames.length > 0 ? (
            <div className="info-callout" style={{ marginTop: 12 }}>
              <p>{STR.dloDraftImagesLost}</p>
              <ul>
                {lostImageNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          ) : null
        }
      >
        {documents.map((slot) => (
          <DocumentIntake
            key={slot.id}
            storageKey={documentStorageKey(slot.id)}
            feature="article"
            accept={['pdf', 'docx', 'txt']}
            title={STR.dloDocsCardTitle}
            hint={STR.dloDocsIntakeHint}
            // A block inside the sources card rather than a card of its own — a nested card
            // reads as a separate form, and the heading drops to an <h3> in the same move.
            embedded
            // No per-file ceiling, deliberately: the shared document service this card
            // uploads to has none (DOCUMENT_MAX_BYTES is unlimited), so a cap here would
            // refuse a scanned booklet the server would happily have read — and a refusal at
            // the door is one the officer can do nothing about. The spend gate is unchanged
            // and is what still keeps a big scan cheap: nothing is OCR'd until pages are
            // ticked. What remains is the box's memory, the intake job holding the bytes for
            // its TTL.
            // /dlo is the one surface that can read a scan later: its live initial selection is
            // the handover, and the intake job reads exactly those pages from the archived
            // original. Waiting for OCR in this card is optional, not the price of going on.
            allowDeferredRead
            // "कागदपत्र जोडा" already said what the officer wants; this block appearing with
            // its own file button was a second identical press. Only the slot that press just
            // created carries it, so restoring a draft never pops a dialog.
            autoOpenPicker={slot.id === autoOpenSlotId.current}
            onTextChange={(_text, snapshot) => {
              setDocuments((prev) =>
                // Every card reports once on mount with nothing loaded; rebuilding the list
                // for that would re-render the whole step for no change.
                prev.some(
                  (entry) =>
                    entry.id === slot.id && entry.snapshot !== snapshot,
                )
                  ? prev.map((entry) =>
                      entry.id === slot.id ? { ...entry, snapshot } : entry,
                    )
                  : prev,
              );
              if (snapshot) setError(null);
            }}
            // Removable as soon as there are documents at all: the sources card's own button
            // is what adds one, so a lone block is no longer the only way back to an empty
            // state the way it was when the card WAS the control.
            onRemove={() => removeDocumentSlot(slot.id)}
          />
        ))}
      </DloSourcesCard>

      {/* After the files, because it is the same kind of source arriving a different way: a
          pasted link is transcribed in the very same phase. It stays its own card — it is a
          field to type into, not a file to attach — and nothing is downloaded here or by the
          job, the transcriber fetches the video itself. */}
      <YouTubeLinkInput
        videos={youtube}
        onChange={setYoutube}
        onError={setError}
      />

      <section className="card">
        <label className="field-label" htmlFor="dlo-heading">
          <Heading1 size={18} className="label-icon" aria-hidden="true" />
          {STR.headingLabel}
        </label>
        <p className="hint">{STR.headingHint}</p>
        <ComposeSafeInput
          id="dlo-heading"
          type="text"
          placeholder={STR.headingPlaceholder}
          value={heading}
          onChange={setHeading}
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

      {/* The action, pinned to the bottom of the content column (globals.css clears the left
          rail with --sidebar-w). Every complaint the form can raise is rendered here rather
          than beside the field that caused it — this strip is the one part of the page that is
          always on screen, so a message put here cannot be missed, and the officer never
          presses a button whose refusal is scrolled off somewhere above. */}
      <div className="dlo-submitbar">
        <div className="dlo-submitbar-inner">
          {error ? <ErrorNotice message={error} /> : null}
          <button
            type="button"
            className="btn btn-primary dlo-submit"
            onClick={submit}
            disabled={submitting || !hasInput}
          >
            {submitting ? STR.submitting : STR.dloSubmit}
          </button>
        </div>
      </div>
    </>
  );
}
