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
