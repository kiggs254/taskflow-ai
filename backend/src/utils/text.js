/**
 * Cut a string to a length without slicing a word in half.
 *
 * `summary.slice(0, 70)` produced titles like "hotpoint-front — Fixed checkout
 * delivery date dead-end, renamed plans, added showroom s" -- the cut landed mid-word
 * and the result read as a bug rather than as an abbreviation. A word boundary plus an
 * ellipsis reads as deliberate, and the ellipsis is the signal that there was more.
 *
 * Falls back to a hard cut for a single token longer than the limit (a URL, a stack
 * frame), where there is no boundary to find.
 */
export const truncateAtWord = (value, max) => {
  const s = String(value ?? '').trim();
  if (s.length <= max) return s;

  // -1 to leave room for the ellipsis.
  const clipped = s.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(' ');

  // Only honour the boundary if it isn't so early that we lose most of the text.
  const cut = lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  // Drop trailing punctuation so we don't render ",…" or ".…".
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`;
};
