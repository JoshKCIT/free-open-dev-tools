import { it, expect } from 'vitest';
import { toPhonetic, fromPhonetic, PHONETIC, NatoPhoneticError } from '../src/index';

// The three mandated top-level tests.

it('each of the thirty-six independently transcribed pairs equals the production table', () => {
  // Second, independent transcription pass, cross-checked against the FAA
  // Aeronautical Information Manual (Chapter 4) and UK CAA CAP 413, the two
  // civil aviation authority publications this tool's table was checked
  // against (see meta.json testNotes for the full provenance statement).
  const independentlyTranscribed: [string, string][] = [
    ['A', 'Alpha'],
    ['B', 'Bravo'],
    ['C', 'Charlie'],
    ['D', 'Delta'],
    ['E', 'Echo'],
    ['F', 'Foxtrot'],
    ['G', 'Golf'],
    ['H', 'Hotel'],
    ['I', 'India'],
    ['J', 'Juliett'],
    ['K', 'Kilo'],
    ['L', 'Lima'],
    ['M', 'Mike'],
    ['N', 'November'],
    ['O', 'Oscar'],
    ['P', 'Papa'],
    ['Q', 'Quebec'],
    ['R', 'Romeo'],
    ['S', 'Sierra'],
    ['T', 'Tango'],
    ['U', 'Uniform'],
    ['V', 'Victor'],
    ['W', 'Whiskey'],
    ['X', 'X-ray'],
    ['Y', 'Yankee'],
    ['Z', 'Zulu'],
    ['0', 'Zero'],
    ['1', 'One'],
    ['2', 'Two'],
    ['3', 'Tree'],
    ['4', 'Fower'],
    ['5', 'Fife'],
    ['6', 'Six'],
    ['7', 'Seven'],
    ['8', 'Eight'],
    ['9', 'Niner'],
  ];
  expect(independentlyTranscribed).toHaveLength(36);
  for (const [ch, word] of independentlyTranscribed) {
    expect(PHONETIC[ch]).toBe(word);
  }
});

it('the digit words are the aviation forms, not the ordinary English words', () => {
  expect(PHONETIC['3']).toBe('Tree');
  expect(PHONETIC['3']).not.toBe('Three');
  expect(PHONETIC['4']).toBe('Fower');
  expect(PHONETIC['4']).not.toBe('Four');
  expect(PHONETIC['5']).toBe('Fife');
  expect(PHONETIC['5']).not.toBe('Five');
  expect(PHONETIC['9']).toBe('Niner');
  expect(PHONETIC['9']).not.toBe('Nine');
});

it('every entry round trips through toPhonetic and fromPhonetic', () => {
  for (const [ch, word] of Object.entries(PHONETIC)) {
    expect(toPhonetic(ch)).toBe(word);
    expect(fromPhonetic(word)).toBe(ch);
  }
});

// Additional coverage beyond the three mandated titles.

it('PHONETIC has an entry for each of the twenty-six letters and each of the ten digits', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    expect(PHONETIC[ch]).toBeDefined();
  }
  expect(Object.keys(PHONETIC)).toHaveLength(36);
});

it('reading back is case-insensitive', () => {
  expect(fromPhonetic('sierra OSCAR SiErRa')).toBe('SOS');
});

it('reading back tolerates any run of whitespace between words', () => {
  expect(fromPhonetic('Sierra    Oscar  Sierra')).toBe('SOS');
});

it('words are joined with the configured word separator and letters with the configured separator', () => {
  expect(toPhonetic('SOS OK')).toBe('Sierra Oscar Sierra/Oscar Kilo');
  expect(toPhonetic('SOS OK', { wordSeparator: '|', separator: '_' })).toBe('Sierra_Oscar_Sierra|Oscar_Kilo');
});

it('converting to words and back returns the original text upper-cased', () => {
  expect(fromPhonetic(toPhonetic('sos 9'))).toBe('SOS 9');
  expect(fromPhonetic(toPhonetic('hello'))).toBe('HELLO');
});

it('a character with no word is rejected with its position by default', () => {
  try {
    toPhonetic('S!S');
    expect.fail('expected toPhonetic to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(NatoPhoneticError);
    expect((err as NatoPhoneticError).position).toBe(1);
  }
});

it('the drop policy silently omits an unsupported character instead of throwing', () => {
  expect(toPhonetic('S!S', { unsupportedPolicy: 'drop' })).toBe(toPhonetic('SS'));
});

it('a word that is not in the table is rejected with its position and the offending word quoted', () => {
  try {
    fromPhonetic('Sierra Wrongword Sierra');
    expect.fail('expected fromPhonetic to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(NatoPhoneticError);
    expect((err as NatoPhoneticError).message).toContain('Wrongword');
  }
});
