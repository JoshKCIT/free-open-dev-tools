import { positionAt, type DoctypePosition } from './xml-doctype';

/**
 * Finds the first entity declaration anywhere in XML text, in any letter case, so a message can be refused before any
 * parser reads it. A declaration can only sit inside a DOCTYPE, which is refused first; this second check keeps a stray
 * declaration out as well. Returns the position, or `null`.
 *
 * Like the DOCTYPE finder it scans the original text and folds only the ASCII letters A to Z, never a lower-cased copy: a
 * character whose lower case is longer (U+0130) would move an index found in a copy past the place the text was pasted at.
 * One forward pass: every `<!` is checked against six letters.
 */
export function findEntityDeclaration(text: string): DoctypePosition | null {
  const word = 'entity';
  let from = 0;
  for (;;) {
    const index = text.indexOf('<!', from);
    if (index === -1) return null;
    if (hasWordAt(text, index + 2, word)) return positionAt(text, index);
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

/** The sentence for a message with an entity declaration. It holds none of the pasted text. */
export const ENTITY_REFUSAL_MESSAGE =
  'Messages that declare an entity are refused: this page never reads DTDs or entity declarations.';
