import type { VideoProjectStatus } from '@dgipr/schemas';
import { VIDEO_STATUS_LABELS } from '../lib/strings';

// Video-project status chip, reusing the generation chips' color classes.
// Status is always shown as text + color, never color alone (StatusChip rule).
export function VideoStatusChip({ status }: { status: VideoProjectStatus }) {
  const entry = VIDEO_STATUS_LABELS[status] ?? {
    label: status,
    chip: 'queued' as const,
  };
  return <span className={`chip chip-${entry.chip}`}>{entry.label}</span>;
}
