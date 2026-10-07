import { positionAt, type DoctypePosition } from './xml-doctype';

/**
 * Finds the first entity declaration anywhere in XML text, in any letter case, so a message can be refused before any
 * parser reads it. A declaration can only sit inside a DOCTYPE, which is refused first; this second check keeps a stray
 * declaration out as well. Returns the position, or `null`.
 */
export function findEntityDeclaration(text: string): DoctypePosition | null {
  const index = text.toLowerCase().indexOf('<!entity');
  if (index === -1) return null;
  return positionAt(text, index);
}

/** The sentence for a message with an entity declaration. It holds none of the pasted text. */
export const ENTITY_REFUSAL_MESSAGE =
  'Messages that declare an entity are refused: this page never reads DTDs or entity declarations.';
