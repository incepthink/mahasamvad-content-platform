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
import { FileText, Image as ImageIcon, Loader2, Music } from 'lucide-react';
import type { DloIntakeFile } from '@dgipr/schemas';

import { AiInstructionsField } from '@/components/AiInstructionsField';
import { DesignationReview } from '@/components/DesignationReview';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FileName } from '@/components/FileName';
import { StyleReferenceField } from '@/components/StyleReferenceField';
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
    <li className="flex items-center gap-3 border-b border-black/5 py-2 last:border-0">
      <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
      <span className="min-w-0 flex-1 overflow-hidden">
        <FileName name={file.name} />
      </span>
      {file.status === 'failed' ? (
        <span className="shrink-0 text-sm text-red-700">
          {file.error
            ? storedErrorMessage(file.error, STR.genericError)
            : STR.genericError}
        </span>
      ) : file.status === 'done' ? (
        <span className="shrink-0 text-sm opacity-60">तयार</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-sm opacity-60">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          सुरू आहे…
        </span>
      )}
    </li>
  );
}

export type DloFileWorkspaceProps = Readonly<{
  intakeId: string;
  /** Where "start over" goes — each lane's own entry point, never the other's. */
  startOverHref: string;
  /**
   * Whether to offer a published article as the STYLE model for this run. /dlo's intake form
   * stopped asking for one, so for that lane the question belongs on this screen; /new-dlo
   * has never asked it, and adding it there would be a new question rather than a moved one.
   */
  showStyleReference?: boolean;
}>;

export function DloFileWorkspace({
  intakeId,
  startOverHref,
  showStyleReference = false,
}: DloFileWorkspaceProps) {
  const router = useRouter();
  const { intake, loading, error, refresh } = useNewDloIntake(intakeId);

  const [heading, setHeading] = useState('');
  const [instructions, setInstructions] = useState('');
  const [styleReference, setStyleReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
  useEffect(() => {
    if (seeded.current || !intake?.reviewState) return;
    seeded.current = true;
    if (intake.reviewState.instructions) {
      setInstructions(intake.reviewState.instructions);
    }
    if (intake.reviewState.styleReference) {
      setStyleReference(intake.reviewState.styleReference);
    }
  }, [intake?.reviewState]);

  // The name lookup is PAID, so it fires exactly once, on the first poll that reports the
  // intake ready. A ref rather than a state flag: both this effect and the poll that triggers
  // it settle in the same commit, so a state guard would let a second call through one render
  // before it took effect — the `restoredFromSave` finding on the old lane, same mechanism.
  const namesRequested = useRef(false);
  useEffect(() => {
    if (intake?.status !== 'ready' || namesRequested.current) return;
    namesRequested.current = true;
    void designations.run();
  }, [intake?.status, designations]);

  const generate = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const generationId = await generateFromNewDloIntake(intakeId, {
        ...(heading.trim() ? { heading: heading.trim() } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(showStyleReference && styleReference.trim()
          ? { styleReference: styleReference.trim() }
          : {}),
        designations: designations.collect(),
      });
      // The ordinary generation detail page: an article from this lane is an ordinary row, so
      // feedback, translation, the PDF export and attaching a poster all work there already.
      router.push(`/generations/${generationId}`);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
      setSubmitting(false);
    }
  };

  if (loading && !intake) {
    return (
      <main className="page">
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
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      </main>
    );
  }

  if (!intake) return null;

  const failedFiles = intake.files.filter((file) => file.status === 'failed');
  const ready = intake.status === 'ready';

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{intake.heading || 'नवीन काम'}</h1>
          <p className="page-sub">
            {ready
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
          <h2 className="card-title">जोडलेले स्रोत</h2>
          <ul className="mt-2 list-none p-0">
            {intake.files.map((file, index) => (
              <SourceRow key={`${file.name}-${index}`} file={file} />
            ))}
          </ul>
          {failedFiles.length > 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>
              वरील फाईल्स वाचता आल्या नाहीत. त्या वगळून लेख तयार होईल.
            </p>
          ) : null}
        </section>
      ) : null}

      {ready ? (
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
          />

          {/* All optional, and the first two outrank the specification when filled in — the
              same contract they carry on the old lane, reached through the same prompt
              blocks. */}
          <section className="card">
            <label className="field-label" htmlFor="dlo-file-heading">
              {STR.headingLabel}
            </label>
            <p className="hint">{STR.headingHint}</p>
            <input
              id="dlo-file-heading"
              type="text"
              placeholder={STR.headingPlaceholder}
              value={heading}
              onChange={(event) => setHeading(event.target.value)}
              style={{ marginTop: 10 }}
            />
          </section>

          <AiInstructionsField
            value={instructions}
            onChange={setInstructions}
          />

          {showStyleReference ? (
            <StyleReferenceField
              value={styleReference}
              onChange={setStyleReference}
            />
          ) : null}

          <div className="dlo-submitbar">
            <div className="dlo-submitbar-inner">
              {submitError ? <ErrorNotice message={submitError} /> : null}
              <button
                type="button"
                className="btn btn-primary dlo-submit"
                disabled={submitting || designations.loading}
                onClick={() => void generate()}
              >
                {submitting ? STR.submitting : STR.dloGenerate}
              </button>
            </div>
          </div>
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
