import { it, expect } from 'vitest';
import { findEntityDeclaration } from '../src/xml-entity';

/** Latin capital I with a dot above: its lower case is two code units long (i and a combining dot). */
const I_DOT = String.fromCodePoint(0x130);
const LF = String.fromCodePoint(10);
const CR = String.fromCodePoint(13);

it('an entity declaration after a character whose lower case is longer is placed on its own line and column', () => {
  const tenDotted = I_DOT.repeat(10);

  // Ten dotted capital I on an earlier line: the declaration is at line 3, column 1.
  // Searching the lower-cased copy gave an index 10 too far and reported column 11.
  expect(findEntityDeclaration(tenDotted + LF + '<a/>' + LF + '<!ENTITY x "y">')).toEqual({ line: 3, column: 1 });

  // On the declaration's own line each such character counts as one column in the text as it was pasted.
  expect(findEntityDeclaration(LF + tenDotted + '<!Entity x "y">')).toEqual({ line: 2, column: 11 });

  // After a CRLF line end, in any ASCII letter case.
  expect(findEntityDeclaration(I_DOT + I_DOT + CR + LF + '  <!eNtItY x "y">')).toEqual({ line: 2, column: 3 });

  // Text whose lower case keeps its length is placed as before, and a lookalike is not a declaration.
  expect(findEntityDeclaration('<a/>' + LF + '<!ENTITY x "y">')).toEqual({ line: 2, column: 1 });
  expect(findEntityDeclaration('<!ENT' + I_DOT + 'TY x "y">')).toBeNull();
  expect(findEntityDeclaration(I_DOT + '<a/>')).toBeNull();
});
