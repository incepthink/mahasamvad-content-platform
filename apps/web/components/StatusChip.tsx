import type { GenerationStatus } from '@dgipr/schemas';
import { STATUS_LABELS } from '../lib/strings';

// Status is always shown as text + color, never color alone.
export function StatusChip({ status }: { status: GenerationStatus }) {
  return <span className={`chip chip-${status}`}>{STATUS_LABELS[status]}</span>;
}
