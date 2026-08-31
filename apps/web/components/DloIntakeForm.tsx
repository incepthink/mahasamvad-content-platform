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
// EVERY SOURCE TAKES ONE ROUTE IN: recordings, photographs and documents all ride the multipart
// `files` field and the API classifies each part by its extension. What differs is who reads
// them on the other side — a recording is transcribed by the intake job, while a document and a
// photograph are uploaded to OpenAI and read by the ARTICLE CALL ITSELF as a file input.
//
// That is why there is no page picker on this form any more. Page selection existed because
// OCR was billed per page and the officer had to say which pages were worth reading; nothing
// is OCR'd on this lane, so there is nothing to choose and attaching a document is the whole
// interaction. The page-by-page reader still serves every surface that needs a STRING out of a
// file (/translate, /proofread, the media room) — see <DocumentIntake>.
//
// Everything typed here is drafted to sessionStorage (lib/dloDraft), so navigating to another
// tab — or reloading — does not lose it. The one exception is the picked FILES: a File is a live
// browser handle that cannot be serialized, so within a session they ride in a module variable
// and across a reload only their names survive, and the form asks for them back by name. That
// now covers documents too, which used to survive as an ephemeral job id because they had
// already been read here.
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
import type { DloCategory, YouTubeVideo } from '@dgipr/schemas';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from '@dgipr/schemas';
import { createDloIntake } from '../lib/api';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearPendingAudio,
  clearPendingDocuments,
  clearPendingImages,
  getPendingAudio,
  getPendingDocuments,
  getPendingImages,
  readDraft,
  rememberMyIntakeId,
  setPendingAudio,
  setPendingDocuments,
  setPendingImages,
  writeDraft,
} from '../lib/dloDraft';
import { AiInstructionsField } from './AiInstructionsField';
import { ComposeSafeInput, ComposeSafeTextarea } from './ComposeSafeInput';
import { DloSourcesCard } from './DloSourcesCard';
import { StyleReferenceField } from './StyleReferenceField';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';

// Which containers count as a recording is @dgipr/schemas' AUDIO_FILE_* and which count as a
// document is <DocumentIntake>'s own list — the same lists the API validates against, so a
// picker can never offer a file the upload would refuse.

// The only article type this lane produces. The picker is gone from this form, so a draft
// saved before that change (category: 'scheme') is simply not read back.
const DLO_CATEGORY: DloCategory = 'news';

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
  // Documents. They ride the SAME multipart `files` field as the recordings and the
  // photographs — the API classifies an upload by its extension — and are read by the
  // article call as a file input, so this is a third picker rather than a third upload path.
  const [documents, setDocuments] = useState<File[]>(() =>
    getPendingDocuments(),
  );
  const [lostDocumentNames, setLostDocumentNames] = useState<readonly string[]>(
    () => (getPendingDocuments().length === 0 ? draft.documentNames : []),
  );
  // YouTube sources. Restored from the draft in full, unlike the recordings — a link is a
  // string, so a reload loses nothing.
  const [youtube, setYoutube] = useState<readonly YouTubeVideo[]>(
    draft.youtube,
  );
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
        audioNames: files.map((file) => file.name),
        imageNames: images.map((file) => file.name),
        documentNames: documents.map((file) => file.name),
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

  useEffect(() => {
    setPendingDocuments(documents);
  }, [documents]);

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

  const changeDocuments = (next: File[]) => {
    setDocuments(next);
    setLostDocumentNames((prev) =>
      prev.filter((name) => !next.some((file) => file.name === name)),
    );
  };

  // What the submit guard below tests, lifted out so the bar's button can be disabled by the
  // same condition rather than by a second, drifting copy of it. "Any valid input" is any ONE
  // source: typed notes, a recording, a photograph, a document, or a
  // link. Everything else on the form (heading, instructions, style reference) is direction for
  // material that does not exist yet, so none of it can enable the run on its own.
  const hasInput =
    notes.trim().length > 0 ||
    files.length > 0 ||
    images.length > 0 ||
    documents.length > 0 ||
    youtube.length > 0;

  // A submitted run CONSUMES its inputs: the intake now owns every file that was attached,
  // so the lists are emptied and the draft goes with them. Called only after the create
  // succeeds — a failed create must leave everything exactly where it was.
  const clearInputs = () => {
    setDocuments([]);
    setYoutube([]);
    setImages([]);
    clearPendingAudio();
    clearPendingImages();
    clearPendingDocuments();
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
      // Every file shares one field: the route classifies each part by its extension, so a
      // second field would only be a second way to say the same thing.
      for (const file of files) form.append('files', file, file.name);
      for (const image of images) form.append('files', image, image.name);
      // Documents ride the same field. They are NOT read here — the route uploads each one
      // to OpenAI and the article call reads it as a file input — which is what removed the
      // page picker and the OCR wait from this step.
      for (const document of documents) {
        form.append('files', document, document.name);
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
          question "what do you want to add?", so they share a card, a row of buttons and
          one list idiom. Nothing is read at this step — a recording is transcribed during
          प्रक्रिया, and a photograph or a document is uploaded to the model and read by the
          article call itself — so all three rows say the same thing: a name, a size and a
          way to take it back off. */}
      <DloSourcesCard
        files={files}
        onFilesChange={changeFiles}
        images={images}
        onImagesChange={changeImages}
        documents={documents}
        onDocumentsChange={changeDocuments}
        onError={setError}
        audioNotice={
          lostAudioNames.length > 0 ? (
            <div className="info-callout" style={{ marginTop: 12 }}>
              <p>{STR.dloDraftAudioLost}</p>
              <ul>
                {lostAudioNames.map((name) => (
                  <li key={name}>
                    <FileName name={name} />
                  </li>
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
                  <li key={name}>
                    <FileName name={name} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        documentNotice={
          lostDocumentNames.length > 0 ? (
            <div className="info-callout" style={{ marginTop: 12 }}>
              <p>{STR.dloDraftDocumentsLost}</p>
              <ul>
                {lostDocumentNames.map((name) => (
                  <li key={name}>
                    <FileName name={name} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
      />

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
