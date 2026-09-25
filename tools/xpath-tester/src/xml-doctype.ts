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
 */
export function findDoctype(text: string): DoctypePosition | null {
  const lower = text.toLowerCase();
  const index = lower.indexOf('<!doctype');
  if (index === -1) return null;
  return positionAt(text, index);
}
