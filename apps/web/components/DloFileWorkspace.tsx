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
  Loader2,
  Music,
  Paperclip,
} from 'lucide-react';
import type { DloIntakeFile } from '@dgipr/schemas';

import { CardTitle } from '@/components/CardTitle';
import { DesignationReview } from '@/components/DesignationReview';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FileName } from '@/components/FileName';
import { FormCard } from '@/components/common/FormCard';
import { PageBackdrop } from '@/components/common/PageBackdrop';
import { PromptInput } from '@/components/common/PromptInput';
import { DloAiPromptBox } from '@/components/dlo/DloAiPromptBox';
import { DloSubmitButton } from '@/components/dlo/DloSubmitButton';
import { NEWS_DOODLES } from '@/lib/doodleMarks';
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
    <div
      className={`mt-4 flex flex-col gap-3 pt-4${divided ? ' border-t' : ''}`}
    >
      {error ? <ErrorNotice message={error} /> : null}
      <div className="flex justify-end">
        <DloSubmitButton
          label={STR.dloGenerate}
          submitting={submitting}
          disabled={disabled}
          onClick={onClick}
        />
      </div>
    </div>
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
  /** Use the same single direction box as /dlo's intake form. */
  unifiedInstructions?: boolean;
  /** Carry /dlo's news-doodle wallpaper onto its review workspace. */
  showBackdrop?: boolean;
}>;

export function DloFileWorkspace({
  intakeId,
  startOverHref,
  unifiedInstructions = false,
  showBackdrop = false,
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
  useEffect(() => {
    if (seeded.current || !intake?.reviewState) return;
    seeded.current = true;
    if (intake.reviewState.instructions) {
      setInstructions(intake.reviewState.instructions);
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

  const generate = async (origin: GenerateOrigin) => {
    // There are two visible copies of this action. State disables both on the next render;
    // the ref also closes the same-tick gap so two rapid clicks cannot start two generations.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitOrigin(origin);
    setSubmitError(null);
    try {
      const generationId = await generateFromNewDloIntake(intakeId, {
        ...(heading.trim() ? { heading: heading.trim() } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        designations: designations.collect(),
      });
      // The ordinary generation detail page: an article from this lane is an ordinary row, so
      // feedback, translation, the PDF export and attaching a poster all work there already.
      router.push(`/generations/${generationId}`);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading && !intake) {
    return (
      <main className="page">
        {showBackdrop ? <PageBackdrop marks={NEWS_DOODLES} seed={31} /> : null}
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
        {showBackdrop ? <PageBackdrop marks={NEWS_DOODLES} seed={31} /> : null}
        <WorkspaceBackLink href={startOverHref} />
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      </main>
    );
  }

  if (!intake) return null;

  const failedFiles = intake.files.filter((file) => file.status === 'failed');
  const ready = intake.status === 'ready';

  return (
    <main className="page">
      {showBackdrop ? <PageBackdrop marks={NEWS_DOODLES} seed={31} /> : null}
      <WorkspaceBackLink href={startOverHref} />

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

      <div className="flex flex-col gap-5">
        {intake.status === 'failed' ? (
          <FormCard>
            <ErrorNotice
              message={storedErrorMessage(intake.error, STR.genericError)}
            />
            <div className="btn-row" style={{ marginTop: 12 }}>
              <Link className="btn btn-small" href={startOverHref}>
                पुन्हा सुरुवात करा
              </Link>
            </div>
          </FormCard>
        ) : null}

        {intake.files.length > 0 ? (
          <FormCard>
            <CardTitle icon={Paperclip}>जोडलेले स्रोत</CardTitle>
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
            {ready ? (
              <GenerateAction
                error={submitOrigin === 'sources' ? submitError : null}
                submitting={submitting}
                disabled={designations.loading}
                divided={!unifiedInstructions}
                onClick={() => void generate('sources')}
              />
            ) : null}
          </FormCard>
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
              <FormCard
                htmlFor="dlo-file-heading"
                label={STR.headingLabel}
                hint={STR.headingHint}
              >
                <PromptInput
                  id="dlo-file-heading"
                  placeholder={STR.headingPlaceholder}
                  value={heading}
                  onChange={setHeading}
                  disabled={submitting}
                  className="mt-3"
                />
              </FormCard>
            ) : null}

            <DloAiPromptBox
              value={instructions}
              onChange={setInstructions}
              disabled={submitting}
            />
          </>
        ) : intake.status !== 'failed' ? (
          <FormCard>
            <p className="translating-note">
              <span className="spinner" aria-hidden="true" />
              प्रक्रिया सुरू आहे…
            </p>
          </FormCard>
        ) : null}
      </div>
    </main>
  );
}
