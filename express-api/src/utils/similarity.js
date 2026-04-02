/**
 * Text similarity utilities for duplicate detection and blocked topic matching.
 *
 * Uses normalised Levenshtein distance to compute similarity ratio (0-1).
 */

/**
 * Normalise text for comparison: lowercase, strip punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u3000-\u9FFF\uAC00-\uD7AF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Compute similarity ratio between two strings (0 = completely different, 1 = identical).
 * Uses normalised Levenshtein distance.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  const sa = normalise(a);
  const sb = normalise(b);
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;

  const longer = sa.length >= sb.length ? sa : sb;
  const shorter = sa.length >= sb.length ? sb : sa;
  const dist = editDistance(longer, shorter);
  return (longer.length - dist) / longer.length;
}

module.exports = { similarity, normalise, editDistance };
