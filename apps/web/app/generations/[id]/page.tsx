'use client';

import { use, useCallback, useState } from 'react';
import {
  isArticleCategory,
  isDynamicPosterCategory,
  isSocialCategory,
  type Category,
} from '@dgipr/schemas';
import { useArticleStream } from '../../../lib/useArticleStream';
import { useGeneration } from '../../../lib/useGeneration';
import { useGenerationThread } from '../../../lib/useGenerationThread';
import { retryGeneration } from '../../../lib/api';
import { useTasks } from '../../../lib/TasksProvider';
import { STR } from '../../../lib/strings';
import { errorMessage, storedErrorMessage } from '../../../lib/errorMessage';
import { ArticleDraft } from '../../../components/ArticleDraft';
import { GenerationThread } from '../../../components/GenerationThread';
import { ProgressSteps } from '../../../components/ProgressSteps';
import { TaskProgressBar } from '../../../components/TaskProgressBar';
import { StatusChip } from '../../../components/StatusChip';
import { ArticleView } from '../../../components/ArticleView';
import { DynamicPosterView } from '../../../components/DynamicPosterView';
import { ErrorNotice } from '../../../components/ErrorNotice';
import { FiveWOneHView } from '../../../components/FiveWOneHView';
import { NextActions } from '../../../components/NextActions';
import { PosterPanel } from '../../../components/PosterPanel';
import { PosterSkeleton } from '../../../components/PosterSkeleton';
import { SocialPostView } from '../../../components/SocialPostView';

// The API persists the provider's complete failure so the server keeps the request id and
// coarse moderation diagnostics. That blob is useful in logs, not to an officer. OpenAI says
// `code` is the stable discriminator and `moderation_stage` is optional, so recognise the code
// first and use the stage only to choose the most useful remediation. Every other failure keeps
// its existing text until it has an equally reliable discriminator of its own.
const CHILD_SUBJECT = /बालक|बाल हक्क|मुलगा|मुलगी|child|minor|girl|boy/i;
const HARM_SUBJECT =
  /शोषण|अत्याचार|लैंगिक|छळ|हिंसा|दुखापत|abuse|exploitation|sexual|violence|injur|assault/i;

// A Dynamic Poster fails through Gemini's video service, not OpenAI's image API, so none of
// its failures match the reader above and every one of them used to land on the shared
// whitelist — which correctly refuses an English provider blob and so left the officer with
// "काहीतरी चुकले" and nothing to change. Recognised here for the same reason the moderation
// codes are: the ROW keeps the provider's own words (they are the audit trail, and the fold
// under the card still shows them), while the SCREEN gets a sentence naming the cause.
//
// `retryable: false` means the identical run can only fail the identical way, which on this
// lane is not merely useless — a retry re-runs the paid motion-prompt call before the block
// is reached again.
type MotionFailure = Readonly<{ message: string; retryable: boolean }>;

function dynamicPosterFailure(error: string): MotionFailure | null {
  const text = error.toLowerCase();

  // Gemini's input filter. Its own sentence — "we can't create videos with real people's
  // names or likenesses" — reads as an accusation about the words on the poster, and the
  // run that prompted this had no name anywhere (see the strings). The trigger is a
  // photorealistic face in the uploaded poster, so that is what this says.
  if (text.includes('content_blocked') || text.includes('input blocked')) {
    const aboutPeople =
      text.includes('likeness') ||
      text.includes('real people') ||
      text.includes('person');
    return {
      message: aboutPeople
        ? STR.motionBlockedPeopleError
        : STR.motionBlockedError,
      retryable: false,
    };
  }

  // The row's own inputs are gone. Re-running cannot put the poster back.
  if (text.includes('has no uploaded poster')) {
    return { message: STR.motionSourceMissingError, retryable: false };
  }

  // A daily/billing cap clears on its own clock; a rate limit clears sooner. Neither is
  // anything the officer can change about their poster, so both say "later".
  if (
    text.includes('resource_exhausted') ||
    text.includes('quota') ||
    text.includes('billing') ||
    text.includes('429')
  ) {
    return { message: STR.motionQuotaError, retryable: true };
  }

  if (text.includes('timed out') || text.includes('timeout')) {
    return { message: STR.motionTimeoutError, retryable: true };
  }

  // The interaction ended without a clip: a refusal with no code, an `incomplete` status, or
  // a generated file the provider could not prepare. Worth retrying — these are the ones
  // that do sometimes land on a second attempt.
  if (
    text.includes('without returning a video') ||
    text.includes('ended the interaction') ||
    text.includes('could not prepare the generated video') ||
    text.includes('returned no interaction id')
  ) {
    return { message: STR.motionNoVideoError, retryable: true };
  }

  return null;
}

function generationErrorForOfficer(
  error: string | null,
  note: string,
  category: Category,
): string {
  if (!error) return STR.failedHint;
  if (isDynamicPosterCategory(category)) {
    const motion = dynamicPosterFailure(error);
    if (motion) return motion.message;
  }
  // Everything that is NOT a recognised moderation refusal goes through the shared
  // reader-test rather than straight to the screen. A job stores whatever it caught,
  // which is a Marathi sentence when the job wrote one and a provider blob, a storage
  // path or an English driver message when it did not — and this card is the officer's
  // account of why their run produced nothing, so it must never be the second kind.
  if (!error.includes('moderation_blocked')) {
    return storedErrorMessage(error, STR.failedHint);
  }

  if (/"moderation_stage"\s*:\s*"output"/.test(error)) {
    return CHILD_SUBJECT.test(note) && HARM_SUBJECT.test(note)
      ? STR.imageSafetyChildOutputError
      : STR.imageSafetyOutputError;
  }
  if (/"moderation_stage"\s*:\s*"input"/.test(error)) {
    return STR.imageSafetyInputError;
  }
  return STR.imageSafetyError;
}

// The provider's own words, under the Marathi sentence and folded away. Deliberately the
// one place in this product that shows an officer a raw provider message: on the Dynamic
// Poster lane the sentence above is a translation of a refusal nobody can see otherwise, and
// reading it currently means querying the row in the database. English and technical, so it
// is collapsed, marked as such, and never the first thing on the card.
function FailureDetail({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <details className="failure-detail">
      <summary>{STR.failureDetailSummary}</summary>
      <p>{error}</p>
    </details>
  );
}

export default function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { addTask, openPanel } = useTasks();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // The edit failure is dismissible: it is a notice about one attempt, not a state of the
  // run, and the run underneath it is fully usable while it is on screen.
  const [failureDismissed, setFailureDismissed] = useState(false);
  const { detail, error, refresh } = useGeneration(id);
  const { thread, refresh: refreshThread } = useGenerationThread(
    id,
    detail?.status ?? null,
  );

  // Is there a draft to watch right now? Two cases, and the second is why this is not simply
  // "the row has no article yet": an officer's feedback REWRITES the article, so the previous
  // one is on the row for the whole rewrite. That path flips the row to `revise_article`,
  // which unmounts ArticleView in favour of the step list — so the draft below replaces
  // nothing and shows अभिप्रायानुसार बातमी सुधारत आहोत… as the article changing.
  //
  // The concurrent revision (`articleRevising`, running beside a poster render) is
  // deliberately NOT here: it keeps ArticleView mounted with the previous article, so a draft
  // card would put two versions of the same article on screen at once.
  //
  // `!detail` opens the stream before the first poll lands, which matters on a run created a
  // moment ago. A run with nothing to stream (a social lane, a restarted API,
  // ARTICLE_STREAMING=0) leaves it empty and renders nothing at all, which is the old page.
  const draftInFlight =
    !detail ||
    ((detail.status === 'queued' || detail.status === 'running') &&
      (!detail.article || detail.step === 'revise_article'));

  // The draft arriving live, so बातमी लिहित आहोत… reads as the article appearing rather than
  // a step list sitting still for minutes — the same view /dlo's workspace already shows, and
  // the reason it is one shared component. Dropped once the run settles: ArticleView is then
  // the authoritative copy and holding the connection open would only wait out the poster
  // render.
  const streamedArticle = useArticleStream(id, draftInFlight);

  // Every image-producing edit started on THIS page (a poster redesign, a heading redo, a
  // copy/scene re-render, a marker round, attaching a poster to an article run) registers
  // the run in the navbar's सुरू असलेली कामे panel, so the officer can navigate away and
  // still see it finish — until now only a brand-new run appeared there and an edit was
  // only visible on this page.
  //
  // Called AFTER the request resolves, never before: all of these routes flip the row to
  // `running` before their 202, and addTask fetches the detail immediately — handed a row
  // still reading `completed`, the provider would file it as terminal and never poll it.
  // Deliberately no openPanel(): the officer is already watching the poster, so the panel's
  // count is the notification and taking over the screen would not be.
  const trackImageWork = useCallback(() => {
    addTask(id);
  }, [addTask, id]);

  // Retry on THIS run, and one handler serves both failure cards. Three outcomes, decided
  // by the API from the row rather than by the button: re-run the step that failed; or —
  // when its inputs are no longer held (an API restart, or a row failed by an older build)
  // — put the run back in working order so its poster, versions and edit controls are usable
  // again; or, on a run that produced nothing at all, run it again from the row's own stored
  // inputs. It deliberately never starts a NEW generation: that used to be this button's only
  // behaviour, and it left every earlier revision of the failed run stranded behind a page
  // that showed nothing. Starting afresh from an EDITED note lives in पुढील पाऊल below.
  const retry = async () => {
    if (!detail || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const restarted = await retryGeneration(detail.id);
      // A restarted edit is a background render like any other, so it belongs in the tasks
      // panel; a plain recovery has nothing to watch. Tracked on BOTH lanes — a failed
      // article-poster edit is as much a render to follow as a social one — while opening
      // the panel outright stays social-only, where the panel is that lane's own surface.
      if (restarted) {
        addTask(detail.id);
        if (isSocialCategory(detail.category)) openPanel();
      }
      await refresh();
    } catch (e) {
      setRetryError(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  // Nothing loaded. In practice this is almost always the API having restarted under
  // the 2.5 s poll, which used to leave the officer on a bare English "Failed to fetch"
  // with nothing to press and no way back to their run — the single worst error state in
  // the product, since the run itself is untouched and one refresh recovers it.
  if (error && !detail) {
    return (
      <main className="page">
        <ErrorNotice
          message={error}
          onRetry={() => void refresh()}
          fallback={STR.genLoadFailed}
        />
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page">
        <p className="hint">{STR.progressTitle}</p>
      </main>
    );
  }

  // A poster re-render (text/scene feedback, or a social redesign) keeps the finished
  // poster on screen with a spinner overlay instead of swapping to the step list.
  // Scoped to poster-affecting steps so an article-only revision still shows ProgressSteps.
  // The social-redesign steps (classify/copy/image) only count here when a poster already
  // exists — an INITIAL run has no posterUrl during them, so it still shows the step list.
  // A follow-up on a Dynamic Poster: the previous clip stays on screen with a spinner over it
  // rather than the card being replaced by the step list, exactly as a poster re-render does.
  const motionBusy =
    isDynamicPosterCategory(detail.category) &&
    !!detail.motionUrl &&
    (detail.status === 'queued' || detail.status === 'running');

  const posterBusy =
    !!detail.posterUrl &&
    (detail.status === 'queued' || detail.status === 'running') &&
    (detail.step === 'revise_copy' ||
      detail.step === 'revise_scene' ||
      detail.step === 'revise_image' ||
      detail.step === 'scene' ||
      detail.step === 'render' ||
      detail.step === 'classify' ||
      detail.step === 'copy' ||
      detail.step === 'image');

  // A translation no longer takes over the row's status/step (it can run beside the
  // poster render), so it needs no branch here: the article card stays mounted by
  // whichever state is already true — completed, or the poster phases below — and
  // ArticleView shows its own inline indicator from `detail.translating`.

  // First-run poster phase: the article is already persisted (runner saves it
  // before the poster steps), so show it early with a poster skeleton instead
  // of the step list. Step-scoped so a revise_article run keeps its existing
  // path; posterBusy can't overlap because it requires posterUrl.
  const posterPending =
    isArticleCategory(detail.category) &&
    detail.outputType !== 'article' &&
    (detail.status === 'queued' || detail.status === 'running') &&
    !!detail.article &&
    !detail.posterUrl &&
    (detail.step === 'faithfulness' || // tiny gap: article persisted before step flips to 'copy'
      detail.step === 'copy' ||
      detail.step === 'scene' ||
      detail.step === 'render');
  // /generations creates article-category poster runs with outputType='poster'. The article
  // stored on those rows is the poster's source, not the officer's primary requested output,
  // so keep it available without letting it lead the page.
  const posterFocused =
    isArticleCategory(detail.category) && detail.outputType === 'poster';

  // Whether this run produced anything that outlives a failed edit. A social poster run
  // created WITHOUT a caption has `article === null`, which is exactly the run that used to
  // vanish: the result view was gated on the article alone, so one failed marker round hid
  // the poster and every version behind it.
  // A Dynamic Poster run has neither a poster PNG nor an article — its output is the clip.
  // Without it here, one failed follow-up would hide a run that has a perfectly good video on
  // it, which is the exact failure this flag was introduced to prevent for social posters.
  const hasOutput =
    !!detail.posterUrl || !!detail.article || !!detail.motionUrl;
  // This lane's reading of whatever failed — the sentence, whether pressing the button again
  // could ever help, and the provider's untouched words for the fold below the card. One
  // value, so the card's sentence, its hints and its detail cannot disagree about the cause.
  // `editFailure` first because a follow-up render is the only failure a completed Dynamic
  // Poster can carry; on a run that produced nothing, it is null and this reads `error`.
  const motionRawError = isDynamicPosterCategory(detail.category)
    ? (detail.editFailure ?? detail.error)
    : null;
  const motionFailure = motionRawError
    ? dynamicPosterFailure(motionRawError)
    : null;
  // An edit that did not land, over output that did. Either the API said so (`editFailure`,
  // the row already back to `completed`), or the row is `failed` from before that existed.
  const editFailed =
    !!detail.editFailure || (detail.status === 'failed' && hasOutput);

  return (
    <main className="page">
      <div
        className="btn-row"
        style={{ justifyContent: 'space-between', marginBottom: 20 }}
      >
        <h1 className="page-title" style={{ margin: 0 }}>
          {STR.newTitle}
        </h1>
        <div className="btn-row" style={{ gap: 10, alignItems: 'center' }}>
          <StatusChip status={detail.status} />
        </div>
      </div>

      {(detail.status === 'queued' || detail.status === 'running') &&
        !posterBusy &&
        !posterPending &&
        !motionBusy &&
        // A यूट्यूब थंबनेल run has no article stages to list, so it takes the compact
        // bar the social lane uses rather than ProgressSteps' news/scheme step list.
        (!isArticleCategory(detail.category) ? (
          <section className="card" aria-live="polite">
            <h2>{STR.progressTitle}</h2>
            <p className="hint">{STR.progressHint}</p>
            <div style={{ marginTop: 16 }}>
              <TaskProgressBar status={detail.status} step={detail.step} />
            </div>
          </section>
        ) : (
          <ProgressSteps detail={detail} />
        ))}

      {/* The draft, under the step list, while the article is being written or rewritten.
          Never alongside ArticleView: once the run settles, the stream's last snapshot and
          ArticleView would be the same text twice — and by then the authoritative copy is
          the one below, applied designations and all. See `draftInFlight`. */}
      {draftInFlight ? <ArticleDraft text={streamedArticle} /> : null}

      {/* Two different situations, deliberately worded differently. A run that produced
          NOTHING is a failure and reads as one. A run whose earlier output survived — its
          poster, every immutable version, its article — had one EDIT fail, and saying "काम
          अपूर्ण राहिले" over a perfectly good poster is what made a run look lost. Newer
          rows never reach the second case as `failed` at all (the API recovers them and
          reports `editFailure`); rows failed by an older build land here and recover on the
          same button. */}
      {detail.status === 'failed' && !hasOutput && (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          <p className="hint">
            {generationErrorForOfficer(
              detail.error,
              detail.note,
              detail.category,
            )}
          </p>
          {/* One button for EVERY failure of an initial run — a moderation refusal, a
              provider outage, a timeout. None of them are told apart here and all of them
              deserve the same answer, so the officer is never left reading an error with
              nothing to press. It re-runs THIS row from its own stored inputs, so history
              keeps one entry per note; changing the note is the fold below. */}
          <div className="btn-row" style={{ marginTop: 16, gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={retry}
              disabled={retrying}
            >
              {retrying ? STR.submitting : STR.retry}
            </button>
          </div>
          {retryError ? <ErrorNotice message={retryError} /> : null}
          <p className="hint" style={{ marginTop: 12 }}>
            {/* A refusal is not "try again": the same poster is refused the same way, and
                the attempt is not free — it re-runs the paid prompt call first. The button
                stays (every failure keeps one), the promise does not. */}
            {motionFailure && !motionFailure.retryable
              ? STR.motionBlockedRetryHint
              : STR.failedRetryHint}{' '}
            {/* पुढील पाऊल is an article/social fold and NextActions renders nothing at all
                for a Dynamic Poster, so on this lane the note-edit hint pointed at a control
                that is not on the page. */}
            {isDynamicPosterCategory(detail.category)
              ? STR.motionNewRunHint
              : STR.failedNewRunHint}
          </p>
          <FailureDetail error={motionRawError} />
        </section>
      )}

      {editFailed && !failureDismissed && (
        <section className="card warn-card" aria-live="polite">
          <h2>{STR.editFailedTitle}</h2>
          <p className="hint">{STR.editFailedHint}</p>
          {(detail.editFailure ?? detail.error) ? (
            <ErrorNotice
              message={generationErrorForOfficer(
                detail.editFailure ?? detail.error,
                detail.note,
                detail.category,
              )}
            />
          ) : null}
          <div className="btn-row" style={{ marginTop: 16, gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={retry}
              disabled={retrying}
            >
              {retrying
                ? STR.submitting
                : detail.editRetryable
                  ? STR.editRetry
                  : STR.editRecover}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setFailureDismissed(true)}
              disabled={retrying}
            >
              {STR.dismiss}
            </button>
          </div>
          {retryError ? <ErrorNotice message={retryError} /> : null}
          <FailureDetail error={motionRawError} />
        </section>
      )}

      {(detail.status === 'completed' ||
        posterBusy ||
        posterPending ||
        motionBusy ||
        // A failure must not hide what the run already produced — the article, the poster,
        // or the poster's whole version history. The notice stays above; the result renders
        // below it and stays fully editable, which is what makes the run recoverable at all.
        (detail.status === 'failed' && hasOutput)) &&
        (isDynamicPosterCategory(detail.category) ? (
          <DynamicPosterView
            detail={detail}
            onChanged={refresh}
            busy={motionBusy}
            onImageWorkStarted={trackImageWork}
          />
        ) : isSocialCategory(detail.category) ? (
          <SocialPostView
            detail={detail}
            onChanged={refresh}
            busy={posterBusy}
            onImageWorkStarted={trackImageWork}
          />
        ) : (
          <>
            {/* A poster request should open on the result it asked for. The skeleton occupies
                this same first position while the initial render is still in flight. */}
            {detail.posterUrl ? (
              <PosterPanel
                detail={detail}
                onChanged={refresh}
                busy={posterBusy}
                onImageWorkStarted={trackImageWork}
              />
            ) : posterPending ? (
              <PosterSkeleton detail={detail} />
            ) : null}
            {detail.fiveWOneH ? <FiveWOneHView detail={detail} /> : null}
            {detail.article ? (
              posterFocused ? (
                <details className="card poster-source-article">
                  <summary>{STR.givenArticle}</summary>
                  <div className="poster-source-article-body">
                    <ArticleView
                      detail={detail}
                      onFeedbackSent={refresh}
                      embedded
                    />
                  </div>
                </details>
              ) : (
                <ArticleView detail={detail} onFeedbackSent={refresh} />
              )
            ) : null}
          </>
        ))}

      {/* Thread of runs spawned from this note lineage. Self-hides when this
          run has no follow-ups; updates live while any member is in flight. */}
      <GenerationThread items={thread} currentId={id} />

      {/* "Next step": cross-format generation from the same note + edit-note
          re-run. Renders nothing while the run (or a revision) is in flight. */}
      <NextActions
        detail={detail}
        onSpawned={() => void refreshThread()}
        onPosterStarted={() => void refresh()}
        onImageWorkStarted={trackImageWork}
      />
    </main>
  );
}
