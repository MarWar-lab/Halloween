/**
 * Split prose into narration beats on sentence boundaries.
 *
 * A regex, not a content field, on purpose: every question's `setup` and the
 * two long briefing passages already exist as single strings, authored for
 * reading as a paragraph. Asking for a second, hand-maintained array per
 * question would double the places a rewrite has to touch and drift the
 * moment one changed without the other. Splitting the string that already
 * exists costs nothing to keep in sync.
 *
 * Kept out of `views/Narration.tsx`: that file exports only the component,
 * so Vite's fast-refresh can hot-reload it — a file exporting a component
 * alongside a plain function loses that.
 */

/**
 * A short, real sentence — "One." or "Bold." — is a beat on its own and
 * should stay one. What has to be glued to whatever follows it is a
 * fragment that only LOOKS like a sentence because it happens to end on a
 * period that wasn't a full stop — an initial or an abbreviation, "Ask Mr."
 * rather than "Ask Mr. Han." This matches only that narrow shape: it ends in
 * one or two capitalised letters and nothing else, so it can never catch an
 * ordinary short sentence, only the kind of period a title or an initial
 * leaves behind.
 */
const ENDS_MID_ABBREVIATION = /\b[A-Z][a-z]?\.$/;

export function narrationLines(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:['")\]]*\s*|$)/g);
  if (!sentences) return [text.trim()];

  const merged: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const previous = merged[merged.length - 1];
    if (previous && ENDS_MID_ABBREVIATION.test(previous)) {
      merged[merged.length - 1] = `${previous} ${s}`;
    } else {
      merged.push(s);
    }
  }
  return merged.length > 0 ? merged : [text.trim()];
}
