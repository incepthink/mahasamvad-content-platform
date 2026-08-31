'use client';

// Everything the /dlo intake form KNOWS, with none of what it looks like — the
// `useCreateForm` split, applied to the article lane so the same reasoning holds on both
// create surfaces: the rules about what a run sends, drafts and refuses live in one
// place, and every component below is markup.
//
// Three things here are not obvious from the fields:
//
// EVERY SOURCE TAKES ONE ROUTE IN. Recordings, photographs and documents all ride the
// single multipart `files` field and the API classifies each by its extension. There is no
// second path any more: a document used to be read HERE first, by the shared ephemeral
// service, so that its text (or a scan's page selection) was in hand before the run was
// submitted. Nothing is read at this step now — the API uploads a document to OpenAI when
// it arrives and the article call reads the file itself — so the read service, the page
// selection and the deferred-OCR handover are all gone from this lane.
//
// EVERYTHING TYPED IS DRAFTED to sessionStorage (lib/dloDraft), so navigating away — or
// reloading — does not lose it. The one exception is the picked files: a File is a live
// browser handle that cannot be serialized, so within a session they ride in a module
// variable and across a reload only their names survive, and the form asks for them back
// by name.
//
// THE HEADING AND THE STYLE REFERENCE ARE NOT SEPARATE QUESTIONS any more. They were two of
// the three cards the single AI-prompt box replaced; the same box is shown again on the
// तपासणी step (DloFileWorkspace), seeded from the intake's saved review state so anything
// typed here still arrives there.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DloCategory, YouTubeVideo } from '@dgipr/schemas';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from '@dgipr/schemas';
import { createDloIntake } from '@/lib/api';
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
} from '@/lib/dloDraft';
import { errorMessage } from '@/lib/errorMessage';
import { STR } from '@/lib/strings';

// The only article type this lane produces. The picker is gone from this form, so a
// draft saved before that change (category: 'scheme') is simply not read back.
const DLO_CATEGORY: DloCategory = 'news';

export function useDloIntakeForm() {
  const router = useRouter();
  const restored = useRef<ReturnType<typeof readDraft>>(null);
  if (restored.current === null) restored.current = readDraft();
  const draft = restored.current ?? EMPTY_DRAFT;

  const [notes, setNotes] = useState(draft.notes);
  const [files, setFiles] = useState<File[]>(() => getPendingAudio());
  // Recordings that were picked before a reload and could not survive it — names only, so
  // the form can ask for them back instead of silently submitting without them.
  const [lostAudioNames, setLostAudioNames] = useState<readonly string[]>(() =>
    getPendingAudio().length === 0 ? draft.audioNames : [],
  );
  // Photographs of documents. They ride the SAME multipart `files` field as the
  // recordings — the API classifies an upload by its extension — so this is a second
  // picker, not a second upload path; the two are separate state only because they are
  // shown differently (a name for a recording, a thumbnail for a photograph).
  const [images, setImages] = useState<File[]>(() => getPendingImages());
  const [lostImageNames, setLostImageNames] = useState<readonly string[]>(() =>
    getPendingImages().length === 0 ? draft.imageNames : [],
  );
  // Documents. The same shape as the photographs above, and for the same reason: since
  // nothing is read at this step, a document is just a picked file waiting to be uploaded
  // with the run.
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
  // The officer's own direction for the article (generations.instructions, 0041). Only
  // USED at generate time, so it is handed to the review step through the intake's saved
  // review state rather than being asked for twice.
  const [instructions, setInstructions] = useState(draft.instructions);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep the draft current. Debounced, because this fires on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      writeDraft({
        notes,
        category: DLO_CATEGORY,
        // Neither is asked for on this form any more (see the header); the draft shape
        // still carries them for the review step's sake.
        heading: '',
        styleReference: '',
        instructions,
        audioNames: files.map((file) => file.name),
        imageNames: images.map((file) => file.name),
        documentNames: documents.map((file) => file.name),
        youtube,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [notes, instructions, documents, files, images, youtube]);

  // Picked files ride in a module variable so client-side navigation away and back keeps
  // them.
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
    setError(null);
  };

  // What the submit guard below tests, lifted out so the bar's button can be disabled by
  // the same condition rather than by a second, drifting copy of it. "Any valid input" is
  // any ONE source: typed notes, a recording, a photograph, a document or a link. The AI
  // prompt is direction for material that does not exist yet, so it cannot enable the run
  // on its own.
  const hasInput =
    notes.trim().length > 0 ||
    files.length > 0 ||
    images.length > 0 ||
    documents.length > 0 ||
    youtube.length > 0;

  // A submitted run CONSUMES its inputs: the intake owns the uploaded files now, so the
  // pickers are emptied and the draft goes with them. Called only after the create
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
    // Kept as a guard even though the button is disabled without it: the disabled state is
    // a courtesy, this is the rule.
    if (!hasInput) {
      setError(STR.dloNeedInput);
      return;
    }
    // Checked here as well as server-side so the officer gets a Marathi message instead of
    // an opaque 400 after the whole upload has gone up.
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
      // Not used until the article is generated, and it has no column on dlo_intakes —
      // the create route seeds it into the intake's review state, which is what makes the
      // review step open with what was typed here instead of an empty box.
      if (instructions.trim()) form.append('instructions', instructions.trim());
      // Every attached file shares ONE field: the route classifies each part by its
      // extension and decides for itself which are transcribed (recordings) and which are
      // uploaded to OpenAI for the article call to read (documents and photographs). A
      // second field would only be a second way to say the same thing — and it is a
      // distinction the officer has no reason to make.
      for (const file of files) form.append('files', file, file.name);
      for (const image of images) form.append('files', image, image.name);
      for (const document of documents) {
        form.append('files', document, document.name);
      }
      // Links, not bytes: nothing about the video travels in this request or is stored,
      // and the transcriber fetches the media itself during प्रक्रिया.
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

  return {
    notes,
    setNotes,
    files,
    changeFiles,
    lostAudioNames,
    images,
    changeImages,
    lostImageNames,
    documents,
    changeDocuments,
    lostDocumentNames,
    youtube,
    setYoutube,
    instructions,
    setInstructions,
    error,
    setError,
    submitting,
    hasInput,
    submit,
  };
}

export type DloIntakeFormState = ReturnType<typeof useDloIntakeForm>;
