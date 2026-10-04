import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDiceNotation,
  rollDice,
  DiceError,
  DICE_GRAMMAR,
  MAX_DICE_PER_TERM,
  MAX_DICE_TOTAL,
  MIN_SIDES,
  MAX_SIDES,
  MAX_NOTATION_CHARACTERS,
} from '../src/dice';
import { drawUniformInt, newModeByteReader } from '../src/sampler';

// New tests for the dice grammar (plan 16-09). The existing test file is untouched. Titles are top-level `it` calls.
// Every fixed byte sequence below is worked by hand through the rejection rule of drawUniformInt: for a span, one byte
// is read per draw when the span is at most 256, a byte above the largest multiple of the span (minus one) is thrown
// away and the next byte is read, and the kept byte is reduced by the span.
//   span 6   (a six-sided die)   largest multiple 252, so bytes 0 to 251 are kept and 252 to 255 are redrawn
//   span 100 (d%)                largest multiple 200, so bytes 0 to 199 are kept and 200 to 255 are redrawn
//   span 3   (a fudge die)       largest multiple 255, so bytes 0 to 254 are kept and only 255 is redrawn

let logSpy: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  logSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
});

afterEach(() => {
  const { log, warn, error } = logSpy;
  vi.restoreAllMocks();
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

function refusal(text: string): string {
  try {
    parseDiceNotation(text);
  } catch (err) {
    expect(err).toBeInstanceOf(DiceError);
    return (err as Error).message;
  }
  throw new Error('parseDiceNotation accepted ' + String(text.length) + ' characters it should have refused');
}

it('dice notation follows the stated grammar and refuses anything else with its position', () => {
  expect(DICE_GRAMMAR).toContain("expression := term (('+' | '-') term)*");
  expect(DICE_GRAMMAR).toContain('term := dice | integer');
  expect(DICE_GRAMMAR).toContain("dice := [count] 'd' (sides | '%' | 'F') [modifier]");
  expect(DICE_GRAMMAR).toContain("modifier := ('kh' | 'kl' | 'dh' | 'dl') [n]");

  // Accepted forms.
  const plain = parseDiceNotation('2d6+3');
  expect(plain.terms).toHaveLength(2);
  expect(plain.terms[0]).toMatchObject({ type: 'dice', sign: 1, count: 2, sides: 6, modifier: null, notation: '2d6' });
  expect(plain.terms[1]).toMatchObject({ type: 'constant', sign: 1, value: 3, notation: '+3' });
  expect(plain.diceCount).toBe(2);

  expect(parseDiceNotation('4d6kh3').terms[0]).toMatchObject({
    count: 4,
    sides: 6,
    modifier: { kind: 'kh', count: 3 },
    notation: '4d6kh3',
  });
  expect(parseDiceNotation('d%').terms[0]).toMatchObject({ count: 1, sides: 100, notation: '1d%' });
  expect(parseDiceNotation('3dF').terms[0]).toMatchObject({ count: 3, sides: 'F', notation: '3dF' });
  const mixed = parseDiceNotation('1d20+1d4-2');
  expect(mixed.terms.map((t) => [t.type, t.sign, t.notation])).toEqual([
    ['dice', 1, '1d20'],
    ['dice', 1, '+1d4'],
    ['constant', -1, '-2'],
  ]);
  // Letters in any case, spaces around the operators, a bare count of one, a modifier without a number, a lone integer.
  expect(parseDiceNotation(' 2D6KH1 + d4 - 1 ').terms.map((t) => t.notation)).toEqual(['2d6kh1', '+1d4', '-1']);
  expect(parseDiceNotation('d6kh').terms[0]).toMatchObject({ modifier: { kind: 'kh', count: 1 } });
  expect(parseDiceNotation('3df').terms[0]).toMatchObject({ sides: 'F' });
  expect(parseDiceNotation('7').terms).toHaveLength(1);
  expect(parseDiceNotation('4d6dl1').terms[0]).toMatchObject({ modifier: { kind: 'dl', count: 1 } });
  expect(parseDiceNotation('4d6dh').terms[0]).toMatchObject({ modifier: { kind: 'dh', count: 1 } });

  // Refused, each with the position of the first problem and a fixed sentence.
  const cases: [string, string][] = [
    ['', 'This is not dice notation: nothing was typed at character 1.'],
    ['   ', 'This is not dice notation: nothing was typed at character 1.'],
    ['d', 'This is not dice notation: the number of sides is missing at character 2.'],
    ['2d', 'This is not dice notation: the number of sides is missing at character 3.'],
    ['d1', 'This is not dice notation: the number of sides must be from 2 to 1,000,000 at character 2.'],
    ['d1000001', 'This is not dice notation: the number of sides must be from 2 to 1,000,000 at character 2.'],
    ['1001d6', 'This is not dice notation: a term cannot roll more than 1,000 dice at character 1.'],
    ['0d6', 'This is not dice notation: a term must roll at least 1 die at character 1.'],
    ['5001d6+5000d6', 'This is not dice notation: a term cannot roll more than 1,000 dice at character 1.'],
    [
      '2d6kh3',
      'This is not dice notation: the keep or drop count must be from 1 to the number of dice in the term at character 6.',
    ],
    [
      '2d6dl0',
      'This is not dice notation: the keep or drop count must be from 1 to the number of dice in the term at character 6.',
    ],
    ['2x6', 'This is not dice notation: a + or - was expected at character 2.'],
    ['2d6+', 'This is not dice notation: a number or dice such as d6 was expected at character 5.'],
    ['-2d6', 'This is not dice notation: a number or dice such as d6 was expected at character 1.'],
    ['2d6+3 4', 'This is not dice notation: a + or - was expected at character 7.'],
    ['4d6k', 'This is not dice notation: a + or - was expected at character 4.'],
    ['2d6d6', 'This is not dice notation: a + or - was expected at character 4.'],
    ['2 d6', 'This is not dice notation: a + or - was expected at character 3.'],
    ['1000000000', 'This is not dice notation: this number is too large at character 1.'],
    ['2d6+1000000000', 'This is not dice notation: this number is too large at character 5.'],
  ];
  for (const [text, message] of cases) expect(refusal(text), JSON.stringify(text)).toBe(message);

  // The limits stated in the exports.
  expect([MAX_DICE_PER_TERM, MAX_DICE_TOTAL, MIN_SIDES, MAX_SIDES, MAX_NOTATION_CHARACTERS]).toEqual([
    1_000, 10_000, 2, 1_000_000, 200,
  ]);
});

it('a long or hostile notation is refused by its length alone, in linear time and without echo', () => {
  const marker = 'FODT-MARKER-3141';
  const long = 'FODT-' + 'x'.repeat(100_000);
  const startedAt = Date.now();
  const message = refusal(long);
  const elapsed = Date.now() - startedAt;
  expect(message).toBe('This is not dice notation: the text is longer than 200 characters at character 201.');
  expect(elapsed).toBeLessThan(1_000);
  // 200 characters are read; 201 are refused.
  const exactly200 = '1'.repeat(199) + 'x';
  expect(exactly200).toHaveLength(200);
  expect(refusal(exactly200)).not.toContain('longer than 200');
  expect(() => parseDiceNotation('1'.repeat(200))).toThrow('too large');
  // A marker placed in every position of a notation is never repeated in a message.
  const inputs = [
    marker,
    '2d6+' + marker,
    marker + '+2d6',
    '2d' + marker,
    '2d6kh' + marker,
    '3 ' + marker,
    'd' + marker,
  ];
  for (const text of inputs) {
    const msg = refusal(text);
    expect(msg).not.toContain('FODT');
    expect(msg).not.toContain('MARKER');
    expect(msg).not.toContain('3141');
    expect(msg).toMatch(/^This is not dice notation: [a-z0-9 ,+.-]+ at character \d+\.$/);
  }
});

it('2d6+3 rolls two dice from 1 to 6 and adds 3, each die shown', () => {
  const expr = parseDiceNotation('2d6+3');
  // Bytes [252, 3, 255, 7]: 252 is above 251 so it is redrawn, 3 gives die 4 (3 + 1); 255 is redrawn, 7 gives
  // 7 mod 6 = 1, die 2. Dice [4, 2], first term 6, constant 3, total 9.
  const rolled = rollDice(expr, { byteSource: [252, 3, 255, 7] });
  expect(rolled.terms).toHaveLength(2);
  expect(rolled.terms[0]).toEqual({
    notation: '2d6',
    rolls: [4, 2],
    kept: [4, 2],
    dropped: [],
    keptIndexes: [0, 1],
    subtotal: 6,
  });
  expect(rolled.terms[1]).toEqual({
    notation: '+3',
    rolls: [],
    kept: [],
    dropped: [],
    keptIndexes: [],
    subtotal: 3,
  });
  expect(rolled.total).toBe(9);
  expect(rolled.diceRolled).toBe(2);

  // Bytes 0 and 5 are the smallest and largest die: [1, 6] and the extreme total 10.
  expect(rollDice(expr, { byteSource: [0, 5] }).total).toBe(10);
  // Byte 251 is the largest kept byte (251 mod 6 = 5, a 6).
  expect(rollDice(expr, { byteSource: [251, 0] }).terms[0]!.rolls).toEqual([6, 1]);

  // A subtracted constant and a subtracted die.
  const minus = rollDice(parseDiceNotation('1d20+1d4-2'), { byteSource: [19, 3] });
  expect(minus.terms.map((t) => t.subtotal)).toEqual([20, 4, -2]);
  expect(minus.total).toBe(22);
  const negative = rollDice(parseDiceNotation('1d4-1d4-3'), { byteSource: [3, 0] });
  expect(negative.terms.map((t) => t.subtotal)).toEqual([4, -1, -3]);
  expect(negative.total).toBe(0);

  // With the real source every die is in range and the arithmetic adds up.
  for (let i = 0; i < 200; i++) {
    const r = rollDice(expr);
    const dice = r.terms[0]!.rolls;
    expect(dice).toHaveLength(2);
    for (const d of dice) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
    expect(r.total).toBe(dice[0]! + dice[1]! + 3);
  }
});

it('keep highest, keep lowest, drop highest and drop lowest choose the right dice and keep the earliest of equal rolls', () => {
  // 4d6kh3 with bytes [2, 2, 0, 5] gives dice [3, 3, 1, 6]: the highest three are 6, 3 and the earlier 3, so the
  // kept dice in roll order are [3, 3, 6] (positions 0, 1, 3) and the 1 is dropped.
  const kh = rollDice(parseDiceNotation('4d6kh3'), { byteSource: [2, 2, 0, 5] }).terms[0]!;
  expect(kh.rolls).toEqual([3, 3, 1, 6]);
  expect(kh.kept).toEqual([3, 3, 6]);
  expect(kh.dropped).toEqual([1]);
  expect(kh.keptIndexes).toEqual([0, 1, 3]);
  expect(kh.subtotal).toBe(12);

  // 4d6kl2 with the same dice keeps the two lowest: the 1 and the earlier 3.
  const kl = rollDice(parseDiceNotation('4d6kl2'), { byteSource: [2, 2, 0, 5] }).terms[0]!;
  expect(kl.kept).toEqual([3, 1]);
  expect(kl.dropped).toEqual([3, 6]);
  expect(kl.keptIndexes).toEqual([0, 2]);
  expect(kl.subtotal).toBe(4);

  // 4d6dl1 drops the lowest one (the 1) and 4d6dh1 drops the highest one (the 6).
  const dl = rollDice(parseDiceNotation('4d6dl1'), { byteSource: [2, 2, 0, 5] }).terms[0]!;
  expect(dl.kept).toEqual([3, 3, 6]);
  expect(dl.dropped).toEqual([1]);
  const dh = rollDice(parseDiceNotation('4d6dh1'), { byteSource: [2, 2, 0, 5] }).terms[0]!;
  expect(dh.kept).toEqual([3, 3, 1]);
  expect(dh.dropped).toEqual([6]);
  expect(dh.subtotal).toBe(7);

  // Equal rolls stay separate dice and the earliest rolled is the one kept.
  // 3d6kh1 with dice [6, 6, 3]: keep position 0, not position 1.
  expect(rollDice(parseDiceNotation('3d6kh1'), { byteSource: [5, 5, 2] }).terms[0]!.keptIndexes).toEqual([0]);
  // 3d6kl1 with dice [1, 1, 6]: keep position 0.
  expect(rollDice(parseDiceNotation('3d6kl1'), { byteSource: [0, 0, 5] }).terms[0]!.keptIndexes).toEqual([0]);
  // Dropping the highest one of [6, 6, 3] keeps the lowest two, and of those tied the earlier: positions 0 and 2.
  const dhTie = rollDice(parseDiceNotation('3d6dh1'), { byteSource: [5, 5, 2] }).terms[0]!;
  expect(dhTie.keptIndexes).toEqual([0, 2]);
  expect(dhTie.dropped).toEqual([6]);
  // Dropping the lowest one of [1, 1, 6]: positions 0 and 2 stay.
  const dlTie = rollDice(parseDiceNotation('3d6dl1'), { byteSource: [0, 0, 5] }).terms[0]!;
  expect(dlTie.keptIndexes).toEqual([0, 2]);
  expect(dlTie.dropped).toEqual([1]);

  // A count equal to the dice count: keep all, or drop all.
  const keepAll = rollDice(parseDiceNotation('2d6kh2'), { byteSource: [0, 5] }).terms[0]!;
  expect(keepAll.kept).toEqual([1, 6]);
  expect(keepAll.dropped).toEqual([]);
  const dropAll = rollDice(parseDiceNotation('2d6dh2'), { byteSource: [0, 5] }).terms[0]!;
  expect(dropAll.kept).toEqual([]);
  expect(dropAll.dropped).toEqual([1, 6]);
  expect(dropAll.subtotal).toBe(0);

  // A kept subtotal goes into a larger expression: 4d6kh3 + 2 with the dice above is 12 + 2.
  expect(rollDice(parseDiceNotation('4d6kh3+2'), { byteSource: [2, 2, 0, 5] }).total).toBe(14);
});

it('d100 dice roll 1 to 100 and fudge dice roll minus one, zero or plus one', () => {
  // d% has span 100: bytes 200 and above are redrawn. [200, 99] gives the die 100; [199] gives 100; [0] gives 1.
  expect(rollDice(parseDiceNotation('d%'), { byteSource: [200, 99] }).terms[0]!.rolls).toEqual([100]);
  expect(rollDice(parseDiceNotation('2d%'), { byteSource: [199, 0] }).terms[0]!.rolls).toEqual([100, 1]);
  expect(rollDice(parseDiceNotation('d100'), { byteSource: [255, 255, 0] }).terms[0]!.rolls).toEqual([1]);
  // Fudge dice have span 3: byte 255 is redrawn and bytes 0, 1, 2 give -1, 0, +1.
  const fudge = rollDice(parseDiceNotation('3dF'), { byteSource: [255, 0, 1, 2] });
  expect(fudge.terms[0]!.rolls).toEqual([-1, 0, 1]);
  expect(fudge.total).toBe(0);
  expect(rollDice(parseDiceNotation('4dF'), { byteSource: [0, 0, 0, 0] }).total).toBe(-4);
  expect(rollDice(parseDiceNotation('4dF'), { byteSource: [2, 2, 2, 2] }).total).toBe(4);

  // The real source: every value is in range and every end of the range turns up.
  const hundred = rollDice(parseDiceNotation('2000d%')).terms[0]!.rolls;
  expect(Math.min(...hundred)).toBe(1);
  expect(Math.max(...hundred)).toBe(100);
  const fudged = rollDice(parseDiceNotation('1000dF+1000dF')).terms.flatMap((t) => t.rolls);
  expect(new Set(fudged)).toEqual(new Set([-1, 0, 1]));
});

it('every new draw uses rejection sampling so a byte sequence that would be biased is redrawn', () => {
  // The shared sampler is the one the earlier tests cover: for a span of 3, bytes 255 is redrawn.
  expect(drawUniformInt(3, newModeByteReader([255, 7]))).toBe(1);
  // A modulo would have given 255 mod 3 = 0.
  expect(255 % 3).toBe(0);
  // A six-sided die: byte 252 would give 252 mod 6 = 0 (a 1) by modulo; rejection reads on to byte 3, a 4.
  expect(rollDice(parseDiceNotation('d6'), { byteSource: [252, 3] }).terms[0]!.rolls).toEqual([4]);
  expect((252 % 6) + 1).toBe(1);
  // Two bytes for a span above 256: d1000 has 65,536 as its word, the largest multiple is 65,000, so bytes
  // 253, 232 (value 65,000) are redrawn and 0, 9 gives 9, a die of 10.
  expect(rollDice(parseDiceNotation('d1000'), { byteSource: [253, 232, 0, 9] }).terms[0]!.rolls).toEqual([10]);
  // Three bytes for the largest die: the word is 16,777,216, the largest multiple of 1,000,000 is 16,000,000, so
  // bytes 255, 255, 255 (16,777,215) are redrawn and 0, 0, 9 gives a die of 10.
  expect(rollDice(parseDiceNotation('d1000000'), { byteSource: [255, 255, 255, 0, 0, 9] }).terms[0]!.rolls).toEqual([
    10,
  ]);
  // Fudge dice: byte 255 is redrawn.
  expect(rollDice(parseDiceNotation('dF'), { byteSource: [255, 2] }).terms[0]!.rolls).toEqual([1]);
  // When the bytes run out the reader says so with the same sentence the earlier tests use, never a silent value.
  expect(() => rollDice(parseDiceNotation('2d6'), { byteSource: [1] })).toThrow(
    'The supplied test byte sequence ran out before generation finished.',
  );
});

it('limits on dice, sides, flips, draws and items are refused before any draw', () => {
  const drawn = vi.spyOn(globalThis.crypto, 'getRandomValues');
  // Sides: 2 and 1,000,000 are accepted; 1 and 1,000,001 refused.
  expect(parseDiceNotation('d2').terms[0]).toMatchObject({ sides: 2 });
  expect(parseDiceNotation('d1000000').terms[0]).toMatchObject({ sides: 1_000_000 });
  expect(refusal('d1')).toContain('from 2 to 1,000,000');
  expect(refusal('d1000001')).toContain('from 2 to 1,000,000');
  // Dice in one term: 1,000 accepted, 1,001 refused.
  expect(parseDiceNotation('1000d6').diceCount).toBe(1_000);
  expect(refusal('1001d6')).toContain('1,000 dice');
  // Dice in an expression: ten terms of 1,000 are 10,000 and accepted; an eleventh term is refused.
  const ten = Array.from({ length: 10 }, () => '1000d6').join('+');
  expect(parseDiceNotation(ten).diceCount).toBe(10_000);
  const eleven = Array.from({ length: 11 }, () => '1000d6').join('+');
  expect(refusal(eleven)).toBe(
    'This is not dice notation: an expression cannot roll more than 10,000 dice at character 71.',
  );
  // One die more than the total, in a different term: 9,999 + 2.
  expect(refusal(Array.from({ length: 9 }, () => '1000d6').join('+') + '+999d6+2d6')).toContain('10,000 dice');
  // A keep or drop count equal to the dice count is accepted, one more is refused.
  expect(parseDiceNotation('4d6kh4').terms[0]).toMatchObject({ modifier: { kind: 'kh', count: 4 } });
  expect(parseDiceNotation('4d6dl4').terms[0]).toMatchObject({ modifier: { kind: 'dl', count: 4 } });
  expect(refusal('4d6kh5')).toContain('keep or drop count');
  expect(refusal('4d6dh5')).toContain('keep or drop count');
  // Nothing above drew a byte.
  expect(drawn).not.toHaveBeenCalled();
  // The largest roll that is accepted runs in a few seconds at most (10,000 dice of 1,000,000 sides).
  const startedAt = Date.now();
  const biggest = rollDice(parseDiceNotation(Array.from({ length: 10 }, () => '1000d1000000').join('+')));
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeLessThan(30_000);
  expect(biggest.diceRolled).toBe(10_000);
  expect(biggest.total).toBeGreaterThanOrEqual(10_000);
  expect(biggest.total).toBeLessThanOrEqual(10_000_000_000);
  expect(Number.isSafeInteger(biggest.total)).toBe(true);
}, 60_000);

it('the cryptographic source is the only source of randomness in every new mode', () => {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random was called');
  });
  const drawn = vi.spyOn(globalThis.crypto, 'getRandomValues');
  const r = rollDice(parseDiceNotation('3d6+2dF+d%'));
  expect(r.diceRolled).toBe(6);
  expect(drawn).toHaveBeenCalled();
  expect(random).not.toHaveBeenCalled();
  // The reader draws one byte from the cryptographic source at a time, and from nowhere else.
  drawn.mockClear();
  const readByte = newModeByteReader();
  const first = readByte();
  expect(Number.isInteger(first)).toBe(true);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(first).toBeLessThanOrEqual(255);
  expect(drawn).toHaveBeenCalledTimes(1);
  // A supplied byte sequence replaces the source entirely.
  drawn.mockClear();
  expect(rollDice(parseDiceNotation('2d6'), { byteSource: [0, 1] }).total).toBe(3);
  expect(drawn).not.toHaveBeenCalled();
  expect(random).not.toHaveBeenCalled();
});

it('nothing is written to the console while rolling a very large expression and a refused one', () => {
  rollDice(parseDiceNotation('1000d6kh10+500dF+d%-3'));
  expect(() => parseDiceNotation('2d6kh9')).toThrow(DiceError);
  expect(logSpy.log).not.toHaveBeenCalled();
  expect(logSpy.warn).not.toHaveBeenCalled();
  expect(logSpy.error).not.toHaveBeenCalled();
});
