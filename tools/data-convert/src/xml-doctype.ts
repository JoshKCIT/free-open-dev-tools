/**
 * Finds a DOCTYPE declaration anywhere in XML 1.0 text, in any letter case, so
 * a document can be refused before any parser reads it. Refusing before
 * parsing means an external entity declared in the DOCTYPE's internal subset
 * is never resolved and an entity that expands into other declared entities
 * (a "billion laughs" document) is never expanded.
 */

export interface DoctypePosition {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

export const DOCTYPE_REFUSAL_MESSAGE =
  'Documents with a DOCTYPE are refused: this page never reads DTDs or entity declarations.';

/** Computes the 1-based line and column of a character offset into `text`. */
export function positionAt(text: string, index: number): DoctypePosition {
  let line = 1;
  let lastNewline = -1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

/**
 * Finds the first `<!DOCTYPE` in `text`, matched case-insensitively and
 * anywhere in the text (not only at the start), and returns its position.
 * Returns `null` when no DOCTYPE is present.
 *
 * The scan reads the original text and folds only the ASCII letters A to Z.
 * It does not search a lower-cased copy: a few characters (the capital I with a
 * dot above, U+0130) have a lower case that is longer than the character, so
 * an index found in a lower-cased copy can point past the place the text was
 * pasted at. No character outside ASCII lower-cases to one of the letters of
 * the word, so the same declarations are found as before. One forward pass:
 * every `<!` is checked against seven letters.
 */
export function findDoctype(text: string): DoctypePosition | null {
  let from = 0;
  for (;;) {
    const index = text.indexOf('<!', from);
    if (index === -1) return null;
    if (hasWordAt(text, index + 2, 'doctype')) return positionAt(text, index);
    from = index + 1;
  }
}

/** True when `text` holds `word` (lower case ASCII) at `start`, in any ASCII letter case. */
function hasWordAt(text: string, start: number, word: string): boolean {
  if (start + word.length > text.length) return false;
  for (let i = 0; i < word.length; i++) {
    let code = text.charCodeAt(start + i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== word.charCodeAt(i)) return false;
  }
  return true;
}
