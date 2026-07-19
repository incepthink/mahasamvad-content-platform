// Builds the single combined Marathi text a DLO intake hands to the review
// step (and, after the officer's edits, to the generation pipeline as its
// note). Sources are kept under labeled Marathi section headers so the officer
// can review — and correct — each transcript/extraction against its origin.

export type IntakeSource = Readonly<{
  // Display label, usually the uploaded file's name.
  label: string;
  text: string;
}>;

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function combineIntakeSources(
  notes: string,
  sources: readonly IntakeSource[],
): string {
  const cleanNotes = normalize(notes);
  const cleanSources = sources
    .map((source) => ({ label: source.label, text: normalize(source.text) }))
    .filter((source) => source.text.length > 0);

  // A single source with no notes needs no header — keep the note clean.
  if (!cleanNotes && cleanSources.length === 1) return cleanSources[0]!.text;
  if (cleanNotes && cleanSources.length === 0) return cleanNotes;

  const parts: string[] = [];
  if (cleanNotes) parts.push(`=== टिपणी ===\n${cleanNotes}`);
  for (const source of cleanSources) {
    parts.push(`=== स्रोत: ${source.label} ===\n${source.text}`);
  }
  return parts.join('\n\n');
}
