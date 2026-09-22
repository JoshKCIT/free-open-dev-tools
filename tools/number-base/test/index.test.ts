import { describe, it, expect } from 'vitest';
import { parseInBase, toBase, convertAll, group, widthReport, calculate, BaseError } from '../src/index';

describe('parsing', () => {
  it('parses the common bases', () => {
    expect(parseInBase('1010', 2).value).toBe(10n);
    expect(parseInBase('777', 8).value).toBe(511n);
    expect(parseInBase('255', 10).value).toBe(255n);
    expect(parseInBase('ff', 16).value).toBe(255n);
    expect(parseInBase('FF', 16).value).toBe(255n);
    expect(parseInBase('zz', 36).value).toBe(1295n);
  });

  it('accepts a prefix and reports the base it implies', () => {
    expect(parseInBase('0xff', 16).value).toBe(255n);
    expect(parseInBase('0b1010', 2).value).toBe(10n);
    expect(parseInBase('0o777', 8).value).toBe(511n);
    expect(parseInBase('0xff', 16).prefixBase).toBe(16);
  });

  it('accepts the separators people actually type', () => {
    expect(parseInBase('1_000_000', 10).value).toBe(1000000n);
    expect(parseInBase('1 000 000', 10).value).toBe(1000000n);
    expect(parseInBase('1,000,000', 10).value).toBe(1000000n);
    expect(parseInBase('dead_beef', 16).value).toBe(0xdeadbeefn);
  });

  it('handles a sign', () => {
    expect(parseInBase('-ff', 16)).toMatchObject({ value: 255n, negative: true });
    expect(parseInBase('+10', 10)).toMatchObject({ value: 10n, negative: false });
  });

  it('rejects a digit the base does not have, and says which', () => {
    expect(() => parseInBase('2', 2)).toThrow(/base 2 does not have/);
    expect(() => parseInBase('8', 8)).toThrow(/base 8 does not have/);
    expect(() => parseInBase('g', 16)).toThrow(/base 16 does not have/);
  });

  it('rejects a character that is not a digit in any base', () => {
    expect(() => parseInBase('!', 16)).toThrow(/not a digit in any base/);
  });

  it('rejects an out-of-range base', () => {
    expect(() => parseInBase('1', 1)).toThrow(BaseError);
    expect(() => parseInBase('1', 37)).toThrow(BaseError);
    expect(() => parseInBase('1', 2.5)).toThrow(BaseError);
  });

  it('rejects empty input', () => {
    expect(() => parseInBase('  ', 10)).toThrow(/Nothing to convert/);
    expect(() => parseInBase('0x', 16)).toThrow(/no digits after the prefix/);
  });
});

describe('arbitrary precision', () => {
  it('converts a 256-bit hash to decimal exactly', () => {
    // parseInt would return 1.157920892373162e+77 and lose every digit.
    const hex = 'f'.repeat(64);
    const value = parseInBase(hex, 16).value;
    expect(value).toBe(2n ** 256n - 1n);
    expect(toBase(value, 10)).toBe('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  });

  it('survives a round trip at a size that breaks a double', () => {
    const value = 12345678901234567890123456789n;
    for (const base of [2, 3, 7, 8, 10, 16, 32, 36]) {
      expect(parseInBase(toBase(value, base), base).value, `base ${base}`).toBe(value);
    }
  });

  it('handles zero in every base', () => {
    for (let base = 2; base <= 36; base++) {
      expect(toBase(0n, base)).toBe('0');
      expect(parseInBase('0', base).value).toBe(0n);
    }
  });

  it('round-trips every base from 2 to 36', () => {
    const values = [0n, 1n, 35n, 36n, 255n, 1000n, 2n ** 64n, -42n];
    for (let base = 2; base <= 36; base++) {
      for (const value of values) {
        const rendered = toBase(value, base);
        const parsed = parseInBase(rendered, base);
        const back = parsed.negative ? -parsed.value : parsed.value;
        expect(back, `${value} in base ${base}`).toBe(value);
      }
    }
  });
});

describe('agreement with the platform', () => {
  it('matches Number.prototype.toString for values a double can hold', () => {
    for (const value of [0, 1, 7, 255, 4095, 65535, 1000000]) {
      for (const base of [2, 8, 10, 16, 36]) {
        expect(toBase(BigInt(value), base)).toBe(value.toString(base));
      }
    }
  });

  it('matches parseInt for values a double can hold', () => {
    for (const [text, base] of [
      ['ff', 16],
      ['1010', 2],
      ['777', 8],
      ['z', 36],
    ] as [string, number][]) {
      expect(Number(parseInBase(text, base).value)).toBe(parseInt(text, base));
    }
  });
});

describe('formatting', () => {
  it('converts to every common base at once', () => {
    const results = convertAll(255n);
    expect(results.find((r) => r.base === 2)!.value).toBe('11111111');
    expect(results.find((r) => r.base === 16)!.value).toBe('ff');
    expect(results.find((r) => r.base === 16)!.prefixed).toBe('0xff');
  });

  it('puts the prefix after the minus sign', () => {
    expect(convertAll(-255n).find((r) => r.base === 16)!.prefixed).toBe('-0xff');
  });

  it('can render uppercase', () => {
    expect(toBase(255n, 16, true)).toBe('FF');
    expect(toBase(-255n, 16, true)).toBe('-FF');
  });

  it('groups binary into bytes and hex into nibbles', () => {
    expect(group('11111111', 2)).toBe('11111111');
    expect(group('1111111111', 2)).toBe('00000011 11111111');
    expect(group('deadbeef', 16)).toBe('dead beef');
  });
});

describe('fixed-width report', () => {
  it('counts the bits a value needs', () => {
    expect(widthReport(0n).bits).toBe(1);
    expect(widthReport(1n).bits).toBe(1);
    expect(widthReport(255n).bits).toBe(8);
    expect(widthReport(256n).bits).toBe(9);
    expect(widthReport(255n).bytes).toBe(1);
    expect(widthReport(256n).bytes).toBe(2);
  });

  it('finds the smallest unsigned width that holds it', () => {
    expect(widthReport(255n).fitsUnsigned).toBe(8);
    expect(widthReport(256n).fitsUnsigned).toBe(16);
    expect(widthReport(2n ** 32n - 1n).fitsUnsigned).toBe(32);
    expect(widthReport(2n ** 32n).fitsUnsigned).toBe(64);
  });

  it('finds the smallest signed width, which holds half as much', () => {
    expect(widthReport(127n).fitsSigned).toBe(8);
    expect(widthReport(128n).fitsSigned).toBe(16);
    expect(widthReport(-128n).fitsSigned).toBe(8);
    expect(widthReport(-129n).fitsSigned).toBe(16);
  });

  it('shows the two complement form of a negative value', () => {
    const report = widthReport(-1n);
    const eight = report.twosComplement.find((t) => t.width === 8)!;
    expect(eight.hex).toBe('ff');
    expect(eight.binary).toBe('11111111');

    const thirtyTwo = report.twosComplement.find((t) => t.width === 32)!;
    expect(thirtyTwo.hex).toBe('ffffffff');
  });

  it('shows the two complement form of a positive value unchanged', () => {
    expect(widthReport(5n).twosComplement.find((t) => t.width === 8)!.hex).toBe('05');
  });

  it('leaves out widths too small to hold the value', () => {
    expect(widthReport(2n ** 40n).twosComplement.map((t) => t.width)).toEqual([64, 128, 256]);
  });
});

describe('arithmetic', () => {
  it('does the four basic operations at arbitrary precision', () => {
    const big = 2n ** 100n;
    expect(calculate(big, big, 'add')).toBe(2n ** 101n);
    expect(calculate(big, 1n, 'subtract')).toBe(big - 1n);
    expect(calculate(big, 2n, 'multiply')).toBe(2n ** 101n);
    expect(calculate(big, 2n, 'divide')).toBe(2n ** 99n);
  });

  it('truncates division towards zero, as C and Go do', () => {
    expect(calculate(7n, 2n, 'divide')).toBe(3n);
    expect(calculate(-7n, 2n, 'divide')).toBe(-3n);
  });

  it('takes the remainder with the sign of the dividend', () => {
    expect(calculate(7n, 3n, 'modulo')).toBe(1n);
    expect(calculate(-7n, 3n, 'modulo')).toBe(-1n);
  });

  it('refuses division and modulo by zero', () => {
    expect(() => calculate(1n, 0n, 'divide')).toThrow(/Division by zero/);
    expect(() => calculate(1n, 0n, 'modulo')).toThrow(/Modulo by zero/);
  });

  it('does bitwise operations', () => {
    expect(calculate(0b1100n, 0b1010n, 'and')).toBe(0b1000n);
    expect(calculate(0b1100n, 0b1010n, 'or')).toBe(0b1110n);
    expect(calculate(0b1100n, 0b1010n, 'xor')).toBe(0b0110n);
    expect(calculate(1n, 64n, 'shiftLeft')).toBe(2n ** 64n);
    expect(calculate(2n ** 64n, 64n, 'shiftRight')).toBe(1n);
  });

  it('bounds the operations that could produce an unusable result', () => {
    expect(() => calculate(2n, 1000000n, 'power')).toThrow(/too large/);
    expect(() => calculate(2n, -1n, 'power')).toThrow(/negative exponent/);
    expect(() => calculate(1n, 99999n, 'shiftLeft')).toThrow(/between 0 and 4096/);
  });
});
