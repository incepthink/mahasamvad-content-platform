'use client';

/**
 * "These recordings did not survive the reload — please attach them again."
 *
 * A picked File is a live browser handle behind a user gesture: it cannot be written to
 * sessionStorage and cannot be re-granted from a name. So across a reload only the NAMES
 * survive (lib/dloDraft), and the honest thing is to ask for the files back rather than
 * submit a run quietly missing a source the officer believes they attached.
 *
 * Renders nothing when there is nothing to ask for, so a caller can mount it
 * unconditionally.
 */

import { FileName } from '@/components/FileName';

export function DloLostFilesNotice({
  message,
  names,
}: {
  message: string;
  names: readonly string[];
}) {
  if (names.length === 0) return null;
  return (
    <div className="info-callout" style={{ marginTop: 12 }}>
      <p>{message}</p>
      <ul>
        {names.map((name) => (
          <li key={name}>
            <FileName name={name} />
          </li>
        ))}
      </ul>
    </div>
  );
}
