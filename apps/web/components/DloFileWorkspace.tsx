'use client';

// One piece of article work whose SOURCES ARE FILES THE MODEL READS FOR ITSELF.
//
// TWO STATES, and that is the whole of it. While recordings are being transcribed the page
// waits; once the intake is ready the officer confirms who the article names and presses
// generate. There is no review step between them, because there is no transcribed text to
// review — the documents and photographs go to the article call as `input_file` parts (see
// intake/openai-source-files.ts).
//
// Shared by BOTH article lanes, /dlo/[id] and /new-dlo/[id], so the two cannot drift apart.
// The only thing that differs is what each surface's intake FORM collects on the way in,
// which is why the props below exist and why there is nothing else lane-specific here.
//
// WHAT IS DELIBERATELY NOT HERE, all of which the old DloWorkspace has:
//   - a per-PAGE reading state. Nothing is read page by page any more, so there is no
//     progress to show at that grain and no partial page list to fill in.
//   - a per-page display component. `DocumentPages`, the page rows, the range picker and the
//     OCR-override confirm all exist to review transcribed pages; none of them has anything
//     to render here.
//   - a per-source editable transcript. A recording's transcript is still what the article is
//     written from, but the officer's correction now happens on the finished article, which
//     is the one text this lane produces.
// The cost of that last one is real and is recorded in generate-article-from-sources.ts: a
// misread figure is no longer caught before the article is written.
//
// The intake row is the state of record, so a reload lands back here and a second officer can
// open the same work.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Music,
  Heading1,
  Paperclip,
} from 'lucide-react';
import type { DloIntakeFile } from '@dgipr/schemas';

import { AiInstructionsField } from '@/components/AiInstructionsField';
import { CardTitle } from '@/components/CardTitle';
import { ComposeSafeInput } from '@/components/ComposeSafeInput';
import { DesignationReview } from '@/components/DesignationReview';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FileName } from '@/components/FileName';
import { errorMessage, storedErrorMessage } from '@/lib/errorMessage';
import { generateFromNewDloIntake, prepareNewDloNames } from '@/lib/newDlo';
import { STR } from '@/lib/strings';
import { useDesignationReview } from '@/lib/useDesignationReview';
import { useNewDloIntake } from '@/lib/useNewDloIntake';

const KIND_ICON = {
  audio: Music,
  youtube: Music,
  image: ImageIcon,
  pdf: FileText,
  docx: FileText,
  txt: FileText,
} as const;

type GenerateOrigin = 'sources' | 'designations';

function WorkspaceBackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="back-link">
      <ArrowLeft size={18} aria-hidden="true" />
      मागे
    </Link>
  );
}

function GenerateAction({
  error,
  submitting,
  disabled,
  divided = true,
  onClick,
}: {
  error: string | null;
  submitting: boolean;
  disabled: boolean;
  divided?: boolean;
  onClick: () => void;
}) {
  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      {/* `divided` is kept as the caller's spacing choice: the review card puts this
          under a long list and wants the extra separation, the sources card does not. */}
      <div className="btn-row" style={{ marginTop: divided ? 20 : 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onClick}
          disabled={submitting || disabled}
        >
          {submitting ? STR.submitting : STR.dloGenerate}
        </button>
      </div>
    </>
  );
}

/**
 * One row per attached source — never per page.
 *
 * A document says "ready" the moment it is attached, because uploading it IS the whole of
 * preparing it. Only a recording has work left to show, which is why this list is short and
 * usually entirely settled.
 */
function SourceRow({ file }: { file: DloIntakeFile }) {
  const Icon = KIND_ICON[file.kind] ?? FileText;
  return (
    <li className="file-row">
      <Icon size={20} aria-hidden="true" />
      <FileName name={file.name} className="file-name" />
      {file.status === 'failed' ? (
        <span className="file-size file-size--failed">
          {file.error
            ? storedErrorMessage(file.error, STR.genericError)
            : STR.genericError}
        </span>
      ) : file.status === 'done' ? (
        <span className="file-size">{STR.dloFileReady}</span>
      ) : (
        <span className="file-size">
          <span className="spinner" aria-hidden="true" />
          {STR.dloFileWorking}
        </span>
      )}
    </li>
  );
}

export type DloFileWorkspaceProps = Readonly<{
  intakeId: string;
  /** Where "start over" goes — each lane's own entry point, never the other's. */
  startOverHref: string;
  /** Use the same single direction box as /dlo's intake form. */
  unifiedInstructions?: boolean;
  /**
   * Skip the name-confirm step entirely: write the article as soon as the sources are ready
   * and hand the officer straight to it.
   *
   * /dlo uses this because its intake form already asks for everything a run needs — the
   * sources and the AI direction — so the only screen between पुढे and the article was a
   * question about names. /new-dlo keeps the step.
   *
   * TWO REAL COSTS, both deliberate. The पदनाम review is gone, so `applyDesignations` runs
   * with no approved pairs and a person is named exactly as the sources name them. And that
   * same route is what pays for the name digest (`rememberNameContext`), which is the ONLY
   * text this lane produces about its documents — so on a file-only intake the prompt's
   * NAME DICTIONARY is empty and the verified spellings never reach the model. Skipping it
   * also saves that model call.
   */
  autoGenerate?: boolean;
}>;

export function DloFileWorkspace({
  intakeId,
  startOverHref,
  unifiedInstructions = false,
  autoGenerate = false,
}: DloFileWorkspaceProps) {
  const router = useRouter();
  const { intake, loading, error, refresh } = useNewDloIntake(intakeId);

  const [heading, setHeading] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOrigin, setSubmitOrigin] = useState<GenerateOrigin | null>(null);
  const submittingRef = useRef(false);

  const fetchNames = useCallback(
    () => prepareNewDloNames(intakeId),
    [intakeId],
  );
  const designations = useDesignationReview(fetchNames);

  // What the officer typed on the intake form, carried here through the intake's saved review
  // state (0036) — those fields have no column of their own and are only USED at generate
  // time, so the form seeds them and this screen is where they are answered against sources
  // that now exist. Seeded ONCE, and never over the top of typing: a poll landing after the
  // officer has started editing must not put the form's wording back.
  const seeded = useRef(false);
  const seededInstructions = useRef('');
  // The pasted style model has no box on this screen at all — it is asked for once, on the
  // intake form — so it is only ever carried, never edited here. A ref rather than state
  // for that reason, and for the auto lane's reason below.
  const seededStyleReference = useRef('');
  useEffect(() => {
    if (seeded.current || !intake?.reviewState) return;
    seeded.current = true;
    if (intake.reviewState.styleReference) {
      seededStyleReference.current = intake.reviewState.styleReference;
    }
    if (intake.reviewState.instructions) {
      setInstructions(intake.reviewState.instructions);
      // Also kept in a ref, which is what the auto lane reads. Two reasons the state cannot
      // serve it there: this effect and the poll that feeds it settle in the SAME commit, so
      // `instructions` is still empty in that render; and only the FIRST poll asks for the
      // heavy payload (see useNewDloIntake), so by the time the intake reports `ready`
      // `intake.reviewState` is null again.
      seededInstructions.current = intake.reviewState.instructions;
    }
  }, [intake?.reviewState]);

  // The heading is a COLUMN on the intake (0018), not part of the review blob, so it is
  // seeded separately and survives the poll dropping the heavy payload. Without this an
  // officer who typed a शीर्षक on the intake form watched it title this screen and then
  // vanish from the article — the generate call sends only what this component holds.
  const seededHeading = useRef('');
  useEffect(() => {
    if (seededHeading.current || !intake?.heading) return;
    seededHeading.current = intake.heading;
    setHeading((current) => (current ? current : (intake.heading ?? '')));
  }, [intake?.heading]);

  // The name lookup is PAID, so it fires exactly once, on the first poll that reports the
  // intake ready. A ref rather than a state flag: both this effect and the poll that triggers
  // it settle in the same commit, so a state guard would let a second call through one render
  // before it took effect — the `restoredFromSave` finding on the old lane, same mechanism.
  //
  // Never on the auto lane: there is no card to answer, so the call would be paid for and
  // thrown away.
  const namesRequested = useRef(false);
  useEffect(() => {
    if (autoGenerate || intake?.status !== 'ready' || namesRequested.current) {
      return;
    }
    namesRequested.current = true;
    void designations.run();
  }, [autoGenerate, intake?.status, designations]);

  const generate = useCallback(
    async (
      origin: GenerateOrigin,
      // What to send instead of this screen's own boxes. The auto lane passes the officer's
      // direction straight off the intake rather than reading `instructions`: the seeding
      // effect and the poll that feeds it settle in the SAME commit, so the state is still
      // empty in that render and an auto run would silently drop what was typed on the form.
      override?: Readonly<{ heading?: string; instructions?: string }>,
    ) => {
      // There are two visible copies of this action. State disables both on the next render;
      // the ref also closes the same-tick gap so two rapid clicks cannot start two
      // generations — and on the auto lane it is the ONLY guard, since nobody is clicking.
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitOrigin(origin);
      setSubmitError(null);
      const wantedHeading = (override?.heading ?? heading ?? '').trim();
      const wantedInstructions = (
        override?.instructions ?? instructions
      ).trim();
      try {
        const generationId = await generateFromNewDloIntake(intakeId, {
          ...(wantedHeading ? { heading: wantedHeading } : {}),
          ...(wantedInstructions ? { instructions: wantedInstructions } : {}),
          // Style only, never a factual source — the article prompt's tier-1 reference
          // (migration 0035). Carried straight from the intake form; there is no box for
          // it here, so there is nothing to override it with.
          ...(seededStyleReference.current
            ? { styleReference: seededStyleReference.current }
            : {}),
          // Empty on the auto lane — the review that fills this never ran.
          designations: designations.collect(),
        });
        // The ordinary generation detail page: an article from this lane is an ordinary row,
        // so feedback, translation, the PDF export and attaching a poster all work there
        // already. `replace` on the auto lane, where this screen is a wait rather than a
        // step: leaving it in the history would send Back to a page that generates again.
        if (autoGenerate) router.replace(`/generations/${generationId}`);
        else router.push(`/generations/${generationId}`);
      } catch (caught) {
        setSubmitError(errorMessage(caught));
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [autoGenerate, designations, heading, instructions, intakeId, router],
  );

  // The auto lane's whole behaviour: the moment the sources are ready, write the article and
  // go to it. The officer never sees this screen settle.
  //
  // An intake is never "consumed" — it stays `ready` and may legitimately produce several
  // articles — so an intake that ALREADY has one is opened rather than billed again. That is
  // what makes reopening a finished piece of work from the /dlo list safe: without it, every
  // visit would buy another article.
  //
  // Re-runs on every render (`generate` is not stable — `designations` is a fresh object each
  // time), which is exactly why the guard is a ref: it is set before the first await, so a
  // second render cannot start a second article.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoStarted.current) return;
    if (intake?.status !== 'ready') return;
    autoStarted.current = true;
    // Newest first (listGenerationsForDloIntakes orders by created_at desc), so [0] is the
    // one to open.
    const existing = intake.generations[0];
    if (existing) {
      router.replace(`/generations/${existing.id}`);
      return;
    }
    void generate('sources', {
      heading: seededHeading.current,
      instructions: seededInstructions.current,
    });
  }, [autoGenerate, generate, intake, router]);

  if (loading && !intake) {
    return (
      <main className="page">
        <WorkspaceBackLink href={startOverHref} />
        <p className="translating-note">
          <span className="spinner" aria-hidden="true" />
          उघडत आहे…
        </p>
      </main>
    );
  }

  if (error && !intake) {
    return (
      <main className="page">
        <WorkspaceBackLink href={startOverHref} />
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      </main>
    );
  }

  if (!intake) return null;

  const failedFiles = intake.files.filter((file) => file.status === 'failed');
  const ready = intake.status === 'ready';
  // On the auto lane this screen is a WAIT, not a step: nothing on it is answered, so the
  // review card, the direction boxes and both generate buttons are not rendered at all. The
  // source list stays — it is the only account of what is being read — and a failed run keeps
  // its error, which is the one thing here an officer can act on.
  const awaitingAuto = autoGenerate && intake.status !== 'failed';

  return (
    <main className="page">
      <WorkspaceBackLink href={startOverHref} />

      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{intake.heading || 'नवीन काम'}</h1>
          <p className="page-sub">
            {awaitingAuto
              ? 'स्रोत तयार होताच बातमी लिहिली जाईल. हे पान आपोआप पुढे जाईल.'
              : ready
                ? 'नावे तपासा आणि लेख तयार करा. जोडलेली कागदपत्रे लेख लिहिताना थेट वाचली जातील.'
                : 'जोडलेल्या ध्वनिमुद्रणांवर प्रक्रिया सुरू आहे. कागदपत्रे आधीच तयार आहेत.'}
          </p>
        </div>
      </header>

      {intake.status === 'failed' ? (
        <section className="card">
          <ErrorNotice
            message={storedErrorMessage(intake.error, STR.genericError)}
          />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Link className="btn btn-small" href={startOverHref}>
              पुन्हा सुरुवात करा
            </Link>
          </div>
        </section>
      ) : null}

      {intake.files.length > 0 ? (
        <section className="card">
          <CardTitle icon={Paperclip}>जोडलेले स्रोत</CardTitle>
          <ul className="file-list">
            {intake.files.map((file, index) => (
              <SourceRow key={`${file.name}-${index}`} file={file} />
            ))}
          </ul>
          {failedFiles.length > 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>
              वरील फाईल्स वाचता आल्या नाहीत. त्या वगळून लेख तयार होईल.
            </p>
          ) : null}
          {ready && !autoGenerate ? (
            <GenerateAction
              error={submitOrigin === 'sources' ? submitError : null}
              submitting={submitting}
              disabled={designations.loading}
              divided={!unifiedInstructions}
              onClick={() => void generate('sources')}
            />
          ) : null}
        </section>
      ) : null}

      {awaitingAuto ? (
        <section className="card">
          {submitError ? (
            // The one thing an officer can act on here. The retry is a plain button rather
            // than a fresh visit, because reopening this page would auto-start again — and
            // `autoStarted` has already fired, so only this can re-arm the run.
            <>
              <ErrorNotice message={submitError} />
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() =>
                    void generate('sources', {
                      instructions: seededInstructions.current,
                    })
                  }
                  disabled={submitting}
                >
                  {submitting ? STR.submitting : STR.retry}
                </button>
              </div>
            </>
          ) : (
            <p className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {ready ? 'बातमी तयार करत आहोत…' : 'प्रक्रिया सुरू आहे…'}
            </p>
          )}
        </section>
      ) : ready ? (
        <>
          <DesignationReview
            names={designations.names}
            known={designations.known}
            edits={designations.edits}
            extras={designations.extras}
            loading={designations.loading}
            error={designations.error}
            busy={submitting}
            onEditDesignation={designations.editDesignation}
            onToggleRemember={designations.toggleRemember}
            onToggleAccepted={designations.toggleAccepted}
            onChangeExtra={designations.changeExtra}
            onAddExtra={designations.addExtra}
            onRegenerate={() => void designations.run()}
            onVerify={(marathi) => void designations.verify(marathi)}
            verifying={designations.verifying}
            verifyError={designations.verifyError}
            hint={
              unifiedInstructions
                ? STR.designationsCompactHint
                : STR.designationsHint
            }
            showRememberHint={!unifiedInstructions}
            footer={
              <GenerateAction
                error={submitOrigin === 'designations' ? submitError : null}
                submitting={submitting}
                disabled={designations.loading}
                divided={!unifiedInstructions}
                onClick={() => void generate('designations')}
              />
            }
          />

          {!unifiedInstructions ? (
            <section className="card">
              <label className="field-label" htmlFor="dlo-file-heading">
                <Heading1 size={18} className="label-icon" aria-hidden="true" />
                {STR.headingLabel}
              </label>
              <p className="hint">{STR.headingHint}</p>
              <ComposeSafeInput
                id="dlo-file-heading"
                type="text"
                placeholder={STR.headingPlaceholder}
                value={heading}
                onChange={setHeading}
                disabled={submitting}
                style={{ marginTop: 10 }}
              />
            </section>
          ) : null}

          <AiInstructionsField
            value={instructions}
            onChange={setInstructions}
            disabled={submitting}
          />
        </>
      ) : intake.status !== 'failed' ? (
        <section className="card">
          <p className="translating-note">
            <span className="spinner" aria-hidden="true" />
            प्रक्रिया सुरू आहे…
          </p>
        </section>
      ) : null}
    </main>
  );
}
