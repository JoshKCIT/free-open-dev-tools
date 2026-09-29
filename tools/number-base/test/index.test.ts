import { describe, it, expect } from 'vitest';
import {
  parseInBase,
  toBase,
  convertAll,
  group,
  widthReport,
  calculate,
  atWidth,
  fitsWidth,
  BaseError,
} from '../src/index';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  it('unbounded not/nand/nor/xnor equal BigInt bitwise complement, and are unaffected by an unused second operand', () => {
    const a = 0b1100n;
    const b = 0b1010n;
    expect(calculate(a, b, 'not')).toBe(~a);
    expect(calculate(a, b, 'nand')).toBe(~(a & b));
    expect(calculate(a, b, 'nor')).toBe(~(a | b));
    expect(calculate(a, b, 'xnor')).toBe(~(a ^ b));
    expect(calculate(a, 999n, 'not')).toBe(calculate(a, 0n, 'not'));
  });

  it('a fixed-width-only operation at unbounded is refused, naming a fixed width', () => {
    expect(() => calculate(1n, 1n, 'rotateLeft')).toThrow(/fixed width/);
    expect(() => calculate(1n, 1n, 'rotateRight')).toThrow(/fixed width/);
    expect(() => calculate(1n, 1n, 'shiftRightLogical')).toThrow(/fixed width/);
    expect(() => calculate(1n, 1n, 'byteSwap')).toThrow(/fixed width/);
  });
});

describe('fixed-width bitwise operations (C and Java results)', () => {
  it('width 8: NOT 0x0F unsigned is 0xF0', () => {
    const result = calculate(0x0fn, 0n, 'not', 8);
    expect(result).toBe(0xf0n);
    expect(atWidth(result, 8).unsigned).toBe(0xf0n);
  });

  it('width 32: NOT 0 is signed -1, unsigned 0xFFFFFFFF', () => {
    const result = calculate(0n, 0n, 'not', 32);
    expect(result).toBe(0xffffffffn);
    expect(atWidth(result, 32).signed).toBe(-1n);
    expect(atWidth(result, 32).unsigned).toBe(0xffffffffn);
  });

  it('width 32: rotateLeft 0x80000001 by 1 is 0x00000003', () => {
    expect(calculate(0x80000001n, 1n, 'rotateLeft', 32)).toBe(0x00000003n);
  });

  it('width 32: rotateRight 0x80000001 by 1 is 0xC0000000', () => {
    expect(calculate(0x80000001n, 1n, 'rotateRight', 32)).toBe(0xc0000000n);
  });

  it('width 32: shiftRightLogical of -1 by 28 is 15', () => {
    expect(calculate(-1n, 28n, 'shiftRightLogical', 32)).toBe(15n);
  });

  it('width 16: byteSwap 0x1234 is 0x3412', () => {
    expect(calculate(0x1234n, 0n, 'byteSwap', 16)).toBe(0x3412n);
  });

  it('width 32: byteSwap 0x12345678 is 0x78563412', () => {
    expect(calculate(0x12345678n, 0n, 'byteSwap', 32)).toBe(0x78563412n);
  });

  it('truth tables at width 8, a=0b1100, b=0b1010', () => {
    expect(calculate(0b1100n, 0b1010n, 'nand', 8)).toBe(0xf7n);
    expect(calculate(0b1100n, 0b1010n, 'nor', 8)).toBe(0xf1n);
    expect(calculate(0b1100n, 0b1010n, 'xnor', 8)).toBe(0xf9n);
  });

  it('nand/nor/xnor truth tables over all four input bit pairs, in the low two bits', () => {
    const pairs: [bigint, bigint][] = [
      [0n, 0n],
      [0n, 1n],
      [1n, 0n],
      [1n, 1n],
    ];
    for (const [a, b] of pairs) {
      expect(calculate(a, b, 'nand', 8) & 0b11n, `nand ${a} ${b}`).toBe(~(a & b) & 0b11n);
      expect(calculate(a, b, 'nor', 8) & 0b11n, `nor ${a} ${b}`).toBe(~(a | b) & 0b11n);
      expect(calculate(a, b, 'xnor', 8) & 0b11n, `xnor ${a} ${b}`).toBe(~(a ^ b) & 0b11n);
    }
  });
});

describe('shift and rotate rules at a fixed width', () => {
  it('an amount >= width gives 0 for shiftLeft and shiftRightLogical', () => {
    expect(calculate(0xffn, 8n, 'shiftLeft', 8)).toBe(0n);
    expect(calculate(0xffn, 100n, 'shiftLeft', 8)).toBe(0n);
    expect(calculate(0xffn, 8n, 'shiftRightLogical', 8)).toBe(0n);
    expect(calculate(0xffn, 100n, 'shiftRightLogical', 8)).toBe(0n);
  });

  it('an amount >= width gives the sign fill for shiftRight: all-ones for negative, 0 for non-negative', () => {
    expect(calculate(-1n, 8n, 'shiftRight', 8)).toBe(0xffn);
    expect(calculate(-1n, 100n, 'shiftRight', 8)).toBe(0xffn);
    expect(calculate(5n, 8n, 'shiftRight', 8)).toBe(0n);
    expect(calculate(5n, 100n, 'shiftRight', 8)).toBe(0n);
  });

  it('rotating by width + 3 equals rotating by 3', () => {
    expect(calculate(0x80000001n, 32n + 3n, 'rotateLeft', 32)).toBe(calculate(0x80000001n, 3n, 'rotateLeft', 32));
    expect(calculate(0x80000001n, 32n + 3n, 'rotateRight', 32)).toBe(calculate(0x80000001n, 3n, 'rotateRight', 32));
  });

  it('a negative shift or rotate amount throws BaseError', () => {
    expect(() => calculate(1n, -1n, 'shiftLeft', 8)).toThrow(BaseError);
    expect(() => calculate(1n, -1n, 'shiftRight', 8)).toThrow(BaseError);
    expect(() => calculate(1n, -1n, 'shiftRightLogical', 8)).toThrow(BaseError);
    expect(() => calculate(1n, -1n, 'rotateLeft', 8)).toThrow(BaseError);
    expect(() => calculate(1n, -1n, 'rotateRight', 8)).toThrow(BaseError);
  });

  it('rotateLeft/rotateRight/shiftRightLogical/byteSwap at unbounded throw, listing the widths', () => {
    for (const op of ['rotateLeft', 'rotateRight', 'shiftRightLogical', 'byteSwap'] as const) {
      expect(() => calculate(1n, 1n, op, 'unbounded')).toThrow(/8, 16, 32, 64, 128/);
    }
  });

  it('arithmetic operations at a fixed width are refused', () => {
    for (const op of ['add', 'subtract', 'multiply', 'divide', 'modulo', 'power'] as const) {
      expect(() => calculate(1n, 1n, op, 8)).toThrow(BaseError);
      expect(() => calculate(1n, 1n, op, 8)).toThrow(/arithmetic/);
    }
  });

  it('operand reduction: at width 8, 0x1FF and -1 both behave as 0xFF', () => {
    expect(calculate(0x1ffn, 0n, 'not', 8)).toBe(calculate(0xffn, 0n, 'not', 8));
    expect(calculate(-1n, 0n, 'not', 8)).toBe(calculate(0xffn, 0n, 'not', 8));
  });

  it('fitsWidth', () => {
    expect(fitsWidth(300n, 8)).toBe(false);
    expect(fitsWidth(-128n, 8)).toBe(true);
    expect(fitsWidth(255n, 8)).toBe(true);
    expect(fitsWidth(-129n, 8)).toBe(false);
  });
});

describe('agreement with JavaScript 32-bit operators', () => {
  const rand = mulberry32(20260929);

  function randomInt32(): number {
    // A uniformly distributed signed 32-bit integer.
    return (Math.floor(rand() * 4294967296) - 2147483648) | 0;
  }

  it('bitwise and shift/rotate operations agree with JavaScript over 1000 random int32 pairs', () => {
    for (let i = 0; i < 1000; i++) {
      const aNum = randomInt32();
      const bNum = randomInt32();
      const a = BigInt.asUintN(32, BigInt(aNum));
      const b = BigInt.asUintN(32, BigInt(bNum));
      const s = Math.abs(bNum) % 32; // JS masks a 32-bit shift amount to 5 bits

      expect(calculate(a, 0n, 'not', 32), `not ${i}`).toBe(BigInt.asUintN(32, BigInt(~aNum)));
      expect(calculate(a, b, 'and', 32), `and ${i}`).toBe(BigInt.asUintN(32, BigInt(aNum & bNum)));
      expect(calculate(a, b, 'or', 32), `or ${i}`).toBe(BigInt.asUintN(32, BigInt(aNum | bNum)));
      expect(calculate(a, b, 'xor', 32), `xor ${i}`).toBe(BigInt.asUintN(32, BigInt(aNum ^ bNum)));
      expect(calculate(a, BigInt(s), 'shiftLeft', 32), `shl ${i}`).toBe(BigInt.asUintN(32, BigInt(aNum << s)));
      expect(calculate(a, BigInt(s), 'shiftRight', 32), `shr ${i}`).toBe(BigInt.asUintN(32, BigInt(aNum >> s)));
      expect(calculate(a, BigInt(s), 'shiftRightLogical', 32), `ushr ${i}`).toBe(BigInt(aNum >>> s));
    }
  });

  it('rotateLeft agrees with the hand-composed JS 32-bit rotate formula, for r in 1 to 31', () => {
    for (let i = 0; i < 200; i++) {
      const aNum = randomInt32();
      const a = BigInt.asUintN(32, BigInt(aNum));
      for (let r = 1; r < 32; r++) {
        const expected = BigInt(((aNum << r) | (aNum >>> (32 - r))) >>> 0);
        expect(calculate(a, BigInt(r), 'rotateLeft', 32), `r=${r}, i=${i}`).toBe(expected);
      }
    }
  });
});

describe('agreement with BigInt.asUintN and asIntN at 64 bits', () => {
  const rand = mulberry32(19700101);

  function randomUint64(): bigint {
    const hi = BigInt(Math.floor(rand() * 4294967296));
    const lo = BigInt(Math.floor(rand() * 4294967296));
    return (hi << 32n) | lo;
  }

  it('shift, not, and/or/xor agree with BigInt.asUintN/asIntN at 64 bits, for s in 0 to 63', () => {
    for (let i = 0; i < 300; i++) {
      const a = randomUint64();
      const b = randomUint64();
      const s = BigInt(Math.floor(rand() * 64));

      expect(calculate(a, 0n, 'not', 64), `not ${i}`).toBe(BigInt.asUintN(64, ~a));
      expect(calculate(a, b, 'and', 64), `and ${i}`).toBe(BigInt.asUintN(64, a & b));
      expect(calculate(a, b, 'or', 64), `or ${i}`).toBe(BigInt.asUintN(64, a | b));
      expect(calculate(a, b, 'xor', 64), `xor ${i}`).toBe(BigInt.asUintN(64, a ^ b));
      expect(calculate(a, s, 'shiftLeft', 64), `shl ${i}`).toBe(BigInt.asUintN(64, a << s));
      expect(calculate(a, s, 'shiftRight', 64), `shr ${i}`).toBe(BigInt.asUintN(64, BigInt.asIntN(64, a) >> s));
    }
  });
});

describe('atWidth', () => {
  it('reports unsigned, signed, hex and binary, each reduced to the width', () => {
    const report = atWidth(-1n, 8);
    expect(report.unsigned).toBe(0xffn);
    expect(report.signed).toBe(-1n);
    expect(report.hex).toBe('ff');
    expect(report.binary).toBe('11111111');
  });

  it('pads hex to width/4 digits and binary to width digits', () => {
    expect(atWidth(1n, 32).hex).toBe('00000001');
    expect(atWidth(1n, 32).binary).toBe('00000000000000000000000000000001');
  });
});
