import { it, expect } from 'vitest';
import { toMorse, fromMorse, MORSE, MORSE_ALIASES, PROSIGNS, MorseError } from '../src/index';

// The nine mandated top-level tests. Each title below is asserted verbatim
// against a real call to the exported functions, per <check_doctrine> in
// the plan.

it('each of the twelve independently transcribed entries equals the production table', () => {
  // Second, independent transcription pass over ITU-R M.1677-1 Annex 1,
  // Table 1, done separately from the pass that produced MORSE in src/index.ts.
  const independentlyTranscribed: [string, string][] = [
    ['A', '.-'], // Annex 1, Table 1 -- alphabetic signals
    ['B', '-...'],
    ['S', '...'],
    ['O', '---'],
    ['Z', '--..'],
    ['0', '-----'], // Annex 1, Table 1 -- numeral signals
    ['1', '.----'],
    ['5', '.....'],
    ['9', '----.'],
    ['.', '.-.-.-'], // Annex 1, Table 1 -- punctuation and miscellaneous signs
    [',', '--..--'],
    ['?', '..--..'],
    ['@', '.--.-.'], // added in the 2009-10 revision
  ];
  for (const [ch, code] of independentlyTranscribed) {
    expect(MORSE[ch]).toBe(code);
  }
});

it('every canonical character round trips through toMorse and fromMorse', () => {
  for (const [ch, code] of Object.entries(MORSE)) {
    if (ch in MORSE_ALIASES) continue;
    expect(toMorse(ch)).toBe(code);
    expect(fromMorse(code)).toBe(ch);
  }
});

it('the multiplication sign encodes to the same code as X and decodes back to X', () => {
  expect(MORSE_ALIASES['×']).toBe('X');
  expect(toMorse('×')).toBe(toMorse('X'));
  expect(fromMorse(toMorse('×'))).toBe('X');
});

it('a bracketed prosign encodes to its concatenated code with no internal gap', () => {
  expect(toMorse('<AS>')).toBe('.-...');
  expect(toMorse('<AS>')).toBe(PROSIGNS['AS']);
});

it('a prosign whose code collides with a single character decodes to that character', () => {
  expect(toMorse('<K>')).toBe('-.-');
  expect(fromMorse('-.-')).toBe('K');
});

it('a prosign whose code collides with nothing decodes back to its bracketed form', () => {
  expect(fromMorse(toMorse('<AS>'))).toBe('<AS>');
  expect(fromMorse(toMorse('<SK>'))).toBe('<SK>');
});

it('an unknown bracketed name is rejected with its position', () => {
  try {
    toMorse('<ZZ9>');
    expect.fail('expected toMorse to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(MorseError);
    expect((err as MorseError).position).toBe(0);
  }
});

it('a run-together token that is neither a character nor a prosign is rejected', () => {
  expect(() => fromMorse('..--..--')).toThrow(MorseError);
});

it('separated letters and a run-together prosign are different inputs and give different answers', () => {
  const separated = toMorse('A S');
  const runTogether = toMorse('<AS>');
  expect(separated).not.toBe(runTogether);
  expect(fromMorse(separated)).toBe('A S');
  expect(fromMorse(runTogether)).toBe('<AS>');
});

// Additional coverage beyond the nine mandated titles.

it('the reverse lookup gives exactly one character to each code', () => {
  const canonicalEntries = Object.entries(MORSE).filter(([ch]) => !(ch in MORSE_ALIASES));
  const codes = canonicalEntries.map(([, code]) => code);
  expect(new Set(codes).size).toBe(codes.length);
});

it('MORSE contains all twenty-six letters, all ten digits and the at sign', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    expect(MORSE[ch]).toBeDefined();
  }
  expect(MORSE['@']).toBeDefined();
});

it('a character with no code is rejected with its position by default', () => {
  try {
    toMorse('日');
    expect.fail('expected toMorse to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(MorseError);
    expect((err as MorseError).position).toBe(0);
  }
});

it('the drop policy silently omits an unsupported character instead of throwing', () => {
  expect(toMorse('A日B', { unsupportedPolicy: 'drop' })).toBe(toMorse('AB'));
});

it('words are joined with the configured word separator and letters with the configured letter separator', () => {
  expect(toMorse('SOS OK')).toBe('... --- .../--- -.-');
  expect(toMorse('SOS OK', { wordSeparator: '|', letterSeparator: '_' })).toBe('..._---_...|---_-.-');
});

it('decoding tolerates any run of whitespace between letters, and treats three or more spaces as a word break', () => {
  // Two spaces between letter codes: still tolerated as a letter gap within one word.
  expect(fromMorse('...  ---  ...')).toBe('SOS');
  // Three or more spaces: a word break, matching the wordSeparator behaviour.
  expect(fromMorse('...     ---')).toBe('S O');
});

it('a run-together token with no separator at all is not the same as separated letters, and is rejected', () => {
  expect(() => fromMorse('...---...')).toThrow(MorseError);
});
