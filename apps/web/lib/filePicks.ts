// What happens to a set of picked files before they join the ones a form is already holding.
//
// Three surfaces ask the same question of a <input type="file"> — is this the right kind of
// file, is it small enough, and have I already got it — and they were answering it three
// times over (the recording picker, the photograph picker, and /dlo's combined sources card).
//
// The SIZE half is the caller's to state (`maxBytes`), because the surfaces no longer agree
// on it — as it happens no recording or document surface has a per-file ceiling left today
// (/dlo and /transcribe both dropped theirs). Whichever answer a surface gives
// must match its own route's — a picker refusing what the server would accept costs the
// officer a source, and a picker accepting what the server refuses moves the refusal to the
// end of a long upload. Omitted means no size check.
//
// It reports rather than throws, because the two complaints are different messages and the
// caller decides where they are shown — on /dlo that is beside the submit button, with every
// other reason a run cannot start.

import { STR } from './strings';

export function acceptFilePicks({
  current,
  picked,
  isAllowedName,
  typeError,
  maxBytes,
}: {
  current: readonly File[];
  picked: readonly File[];
  isAllowedName: (name: string) => boolean;
  // What to say about a pick of the wrong kind. Each surface names the formats it takes, so
  // the message cannot be derived here.
  typeError: string;
  // The surface's own per-file ceiling, matching what its API route enforces. Omitted = the
  // route has none, so neither does the picker.
  maxBytes?: number | undefined;
}): { files: File[]; added: number; error: string | null } {
  const allowed = picked.filter((file) => isAllowedName(file.name));
  const sized =
    maxBytes === undefined
      ? allowed
      : allowed.filter((file) => file.size <= maxBytes);
  // A pick that fails the kind check never reaches the size check, and is reported as the
  // wrong kind — two different complaints, so two different messages.
  const error =
    allowed.length < picked.length
      ? typeError
      : sized.length < allowed.length
        ? STR.fileTooLargeError
        : null;
  // Same name AND size is the same file picked twice; a genuine second recording or a second
  // shot of the same page differs in one or the other.
  const fresh = sized.filter(
    (file) =>
      !current.some(
        (existing) =>
          existing.name === file.name && existing.size === file.size,
      ),
  );
  return { files: [...current, ...fresh], added: fresh.length, error };
}
