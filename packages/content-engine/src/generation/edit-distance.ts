// Levenshtein distance, used to tell a small spelling nudge (शिंदें → शिंदे) from a
// rename (पवार → शिंदे). Shared by the proofreader's name gate and the Hindi
// translation's locked-name repair; inputs are short name fragments, so O(n·m) is fine.
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(
        Math.min((prev[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution),
      );
    }
    prev = current;
  }
  return prev[cols - 1] ?? 0;
}
