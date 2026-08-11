// What happens to a set of picked files before they join the ones a form is already holding.
//
// Three surfaces ask the same question of a <input type="file"> — is this the right kind of
// file, is it small enough, and have I already got it — and they were answering it three
// times over (the recording picker, the photograph picker, and /dlo's combined sources card).
// The answers must not drift: the API validates the size against this same
// UPLOAD_FILE_MAX_BYTES, so a picker that let a large file through would only move the
// refusal to the end of a long upload.
//
// It reports rather than throws, because the two complaints are different messages and the
// caller decides where they are shown — on /dlo that is beside the submit button, with every
// other reason a run cannot start.

import { UPLOAD_FILE_MAX_BYTES } from '@dgipr/schemas';
import { STR } from './strings';

export function acceptFilePicks({
  current,
  picked,
  isAllowedName,
  typeError,
}: {
  current: readonly File[];
  picked: readonly File[];
  isAllowedName: (name: string) => boolean;
  // What to say about a pick of the wrong kind. Each surface names the formats it takes, so
  // the message cannot be derived here.
  typeError: string;
}): { files: File[]; added: number; error: string | null } {
  const allowed = picked.filter((file) => isAllowedName(file.name));
  const sized = allowed.filter((file) => file.size <= UPLOAD_FILE_MAX_BYTES);
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
