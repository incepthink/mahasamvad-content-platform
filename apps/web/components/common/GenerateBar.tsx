'use client';

/**
 * The one action, pinned to the foot of the content column. Shared by both create
 * surfaces — Creative and Social, and लेख / बातमी — which is why the two lane-busy
 * notices below are optional: /dlo has neither.
 *
 * The form is several blocks long and only the first is compulsory, so a button at the
 * end of the flow sits below optional material the officer did not fill in. Pinned, it
 * is in the same place throughout.
 *
 * `inset-inline-start: var(--sidebar-w)` is what keeps it clear of the left rail in
 * both of that rail's widths (the variable is set on <body> by dgipr.css and drops to
 * 0 on a narrow screen). z-index sits BELOW the tasks modal (50) and the mobile drawer
 * (55/60) on purpose — this is page furniture, and anything opened over the page must
 * cover it.
 *
 * Every complaint the form can raise is rendered here rather than beside the field that
 * caused it: this strip is the one part of the page always on screen, so a message put
 * here cannot be missed, and the officer never presses a button whose refusal is
 * scrolled off somewhere above.
 */

import { ErrorNotice } from '@/components/ErrorNotice';
import { STR } from '@/lib/strings';
import { cn } from '@/lib/utils';

export function GenerateBar({
  label,
  busy,
  canSubmit,
  onSubmit,
  error,
  note = null,
  socialBusy = false,
  articleBusy = false,
}: {
  label: string;
  busy: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  error: string | null;
  // One line of reassurance about the press that is already running — /translate's
  // "a long text can take a minute or two", which the button's own label has no room
  // for. Rendered where the busy notices are, so everything about why the officer is
  // waiting is in one place.
  note?: string | null | undefined;
  // Why a submit would be refused right now, stated beside the button. Only the media
  // room has lanes that can be busy; /dlo and /translate omit both.
  socialBusy?: boolean | undefined;
  articleBusy?: boolean | undefined;
}) {
  return (
    <div
      className="fixed bottom-0 right-0 z-30 border-t bg-white/90 px-6 py-3.5 backdrop-blur-md"
      style={{
        insetInlineStart: 'var(--sidebar-w, 0px)',
        paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 -4px 24px rgba(61, 42, 26, 0.1)',
      }}
    >
      {/* Same width and gutters as the page column, so the button lines up with the
          boxes above it. */}
      <div className="mx-auto flex w-full max-w-[1080px] flex-col items-center gap-2.5">
        {/* A busy lane is the reason a submit will be refused, so it is stated here
            beside the button rather than in a card that may be scrolled away. */}
        {socialBusy ? (
          <p className="text-muted-foreground m-0 text-center text-sm">
            {STR.socialBusyInfo}
          </p>
        ) : null}
        {articleBusy ? (
          <p className="text-muted-foreground m-0 text-center text-sm">
            {STR.articleBusyInfo}
          </p>
        ) : null}

        {note ? (
          <p
            className="text-muted-foreground m-0 text-center text-sm"
            aria-live="polite"
          >
            {note}
          </p>
        ) : null}

        {error ? (
          <div className="w-full max-w-[420px]">
            <ErrorNotice message={error} />
          </div>
        ) : null}

        {/* Wide enough to read as the page's one action, short of the full column,
            which would be a button the width of a desk. Enabled, it carries a slow warm
            sheen travelling across it — the only moving thing on the page, so "there is
            something to press now" reads without a label. Disabled it is quiet and
            still: the flow is what says the form is ready. */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !canSubmit}
          className={cn(
            'text-primary-foreground h-14 w-full max-w-[420px] rounded-xl text-lg font-bold transition-[filter]',
            'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            busy || !canSubmit
              ? 'bg-primary'
              : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
          )}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
