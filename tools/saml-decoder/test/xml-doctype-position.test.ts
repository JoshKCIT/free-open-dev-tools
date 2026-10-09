import { it, expect } from 'vitest';
import { findDoctype } from '../src/xml-doctype';

/**
 * Where the XML tools place a DOCTYPE refusal. Every non-ASCII character is built at run time from its code point.
 * The first title records places that the finder gave before it stopped searching a lower-cased copy of the text:
 * for text whose lower case keeps its length they must not move.
 */

const BOM = String.fromCodePoint(0xfeff);
/** Latin capital E with acute: its lower case has the same length. */
const E_ACUTE = String.fromCodePoint(0xc9);
/** Greek capital sigma: its lower case has the same length. */
const SIGMA = String.fromCodePoint(0x3a3);
/** Sharp s: it has no lower case change and an upper case that is longer, so it is not a case of the longer lower case. */
const SHARP_S = String.fromCodePoint(0xdf);
/** A character outside the basic plane: two code units, same length lower case. */
const MATH_BOLD_A = String.fromCodePoint(0x1d400);
/** Latin capital I with a dot above: its lower case is two code units long (i and a combining dot). */
const I_DOT = String.fromCodePoint(0x130);
/** Kelvin sign: its lower case is the ASCII letter k, which no declaration word holds. */
const KELVIN = String.fromCodePoint(0x212a);
/** Cyrillic small o and Greek small omicron: they look like an ASCII o. */
const CYRILLIC_O = String.fromCodePoint(0x43e);
const GREEK_OMICRON = String.fromCodePoint(0x3bf);

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);

it('a DOCTYPE position is unchanged for text whose lower case keeps its length', () => {
  const cases: Array<{ name: string; text: string; at: { line: number; column: number } | null }> = [
    { name: 'upper case at the start', text: '<!DOCTYPE a><a/>', at: { line: 1, column: 1 } },
    { name: 'lower case after a tag', text: '<a/><!doctype a>', at: { line: 1, column: 5 } },
    { name: 'mixed case', text: '<!DocType a><a/>', at: { line: 1, column: 1 } },
    {
      name: 'after a CRLF line end',
      text: '<?xml version="1.0"?>' + CR + LF + '<!DOCTYPE a><a/>',
      at: { line: 2, column: 1 },
    },
    {
      name: 'indented on the third line of a CRLF text',
      text: '<?xml version="1.0"?>' + CR + LF + CR + LF + '  <!DocType a>',
      at: { line: 3, column: 3 },
    },
    { name: 'after a byte order mark', text: BOM + '<!DOCTYPE a>', at: { line: 1, column: 2 } },
    {
      name: 'after three capital E with acute',
      text: E_ACUTE + E_ACUTE + E_ACUTE + '<!DOCTYPE a>',
      at: { line: 1, column: 4 },
    },
    {
      name: 'after capital E with acute on an earlier and the same line',
      text: E_ACUTE + E_ACUTE + LF + E_ACUTE + '<!DoCtYpE a>',
      at: { line: 2, column: 2 },
    },
    { name: 'after a capital sigma', text: SIGMA + '<!DOCTYPE a>', at: { line: 1, column: 2 } },
    { name: 'after a sharp s', text: SHARP_S + SHARP_S + '<!doctype a>', at: { line: 1, column: 3 } },
    { name: 'after a character of two code units', text: MATH_BOLD_A + '<!doctype a>', at: { line: 1, column: 3 } },
    { name: 'the first of two', text: 'x<!DOCTYPE a><!DOCTYPE b>', at: { line: 1, column: 2 } },
    { name: 'no DOCTYPE in an empty text', text: '', at: null },
    { name: 'no DOCTYPE in a plain document', text: '<a><b/></a>', at: null },
    { name: 'a word that stops one letter short', text: '<!DOCTYP a>', at: null },
    { name: 'a text with only characters of longer lower case', text: I_DOT + I_DOT + LF + '<a/>', at: null },
  ];
  for (const c of cases) {
    expect(findDoctype(c.text), c.name).toEqual(c.at);
  }
});

it('a DOCTYPE after a character whose lower case is longer is placed on its own line and column', () => {
  const tenDotted = I_DOT.repeat(10);

  // Ten dotted capital I, a line break, an element, a line break and the declaration: line 3, column 1.
  // Searching the lower-cased copy gave an index 10 too far and reported column 11.
  expect(findDoctype(tenDotted + LF + '<a/>' + LF + '<!DOCTYPE a>')).toEqual({ line: 3, column: 1 });

  // The same characters on the declaration's own line move its column by their length in the original text, one each.
  expect(findDoctype(LF + tenDotted + '<!DOCTYPE a>')).toEqual({ line: 2, column: 11 });
  expect(findDoctype(I_DOT + '<!doctype a>')).toEqual({ line: 1, column: 2 });

  // With a CRLF line end and a byte order mark first.
  expect(findDoctype(BOM + tenDotted + CR + LF + '  <!DocType a>')).toEqual({ line: 2, column: 3 });

  // The declaration is found even when only a long lower case character precedes it on a first line of its own.
  expect(findDoctype(I_DOT + I_DOT + I_DOT + LF + '<!DOCTYPE a>')).toEqual({ line: 2, column: 1 });
});

it('a DOCTYPE in any ASCII letter case is still found and a lookalike is not', () => {
  const word = 'doctype';
  // Every combination of letter case for the seven letters.
  for (let mask = 0; mask < 1 << word.length; mask++) {
    let spelled = '';
    for (let i = 0; i < word.length; i++) spelled += mask & (1 << i) ? word[i].toUpperCase() : word[i];
    expect(findDoctype('<?xml version="1.0"?>' + LF + '<!' + spelled + ' a>'), spelled).toEqual({ line: 2, column: 1 });
    // And after a character whose lower case is longer, on the same line.
    expect(findDoctype(I_DOT + '<!' + spelled + ' a>'), spelled).toEqual({ line: 1, column: 2 });
  }

  const lookalikes: Array<{ name: string; text: string }> = [
    { name: 'a Cyrillic o in place of the first o', text: '<!d' + CYRILLIC_O + 'ctype a>' },
    { name: 'a Greek omicron in place of the first o', text: '<!d' + GREEK_OMICRON + 'ctype a>' },
    { name: 'a Kelvin sign inside the word', text: '<!doc' + KELVIN + 'type a>' },
    { name: 'a Kelvin sign in place of the first letter', text: '<!' + KELVIN + 'octype a>' },
    { name: 'no exclamation mark', text: '<doctype a>' },
    { name: 'a space after the angle bracket', text: '< !DOCTYPE a>' },
    { name: 'a space inside the word', text: '<!DOC TYPE a>' },
    { name: 'a dotted capital I in the word', text: '<!DOCTYP' + I_DOT + ' a>' },
    { name: 'the entity word instead', text: '<!ENTITY a "b">' },
  ];
  for (const c of lookalikes) {
    expect(findDoctype(c.text), c.name).toBeNull();
    expect(findDoctype(I_DOT + I_DOT + LF + c.text), c.name).toBeNull();
  }
});
