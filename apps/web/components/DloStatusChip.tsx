import type { DloIntakeStatus } from '@dgipr/schemas';
import { DLO_STATUS_LABELS } from '../lib/strings';

// DLO intake status chip, reusing the generation chips' color classes.
// Status is always shown as text + color, never color alone (StatusChip rule).
export function DloStatusChip({ status }: { status: DloIntakeStatus }) {
  const entry = DLO_STATUS_LABELS[status] ?? {
    label: status,
    chip: 'queued' as const,
  };
  return <span className={`chip chip-${entry.chip}`}>{entry.label}</span>;
}
