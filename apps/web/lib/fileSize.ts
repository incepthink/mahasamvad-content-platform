// How an attached file's size is written, everywhere one is shown.
//
// It lived in components/AudioFilePicker while that card was the only place a size appeared.
// Both composers now render every attached source through the same AttachmentStrip, so the
// formatter belongs beside the other shared helpers rather than inside a component — a
// component nobody renders is a poor home for a function two surfaces import.
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
