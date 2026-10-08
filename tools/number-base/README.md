# Number Base Converter

Convert integers between any bases from 2 to 36 with arbitrary precision, and evaluate C-style integer expressions at 8 to 256 bits.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts whole numbers between any pair of bases from 2 to 36. Everything is computed with arbitrary-precision integers, so a 256-bit hash converts to decimal exactly rather than becoming 1.157920892373162e+77, which is what happens in most browser-based converters. It also shows how the value sits in fixed-width integers, including the two complement form of a negative number. A second mode, the programmer's calculator, evaluates one C-style integer expression such as (0xFF & ~0x0F) >> 2 at a chosen width from 8 to 256 bits, signed or unsigned, with C's operator precedence. Every step is wrapped to the width and listed, and a step that did not fit, a shift past the width or a case C leaves undefined is flagged. The expression is read by a hand-written parser and is never run as code.

## Supported

- Any base from 2 to 36, in both directions, with no size limit
- The 0x, 0o and 0b prefixes, and separators written as underscores, spaces, commas or apostrophes
- Negative numbers, with the sign kept outside any prefix
- Two complement at 8, 16, 32, 64, 128 and 256 bits, with the smallest width that fits each value
- Digit grouping: bytes in binary, nibbles in hexadecimal
- Arbitrary-precision arithmetic between two numbers, always unbounded regardless of the width setting
- Fixed-width bitwise work at 8, 16, 32, 64 and 128 bits: NOT, AND, OR, XOR, NAND, NOR, XNOR, shift left, shift right (arithmetic and logical), rotate left, rotate right and byte swap, with the result shown unsigned, signed (two complement), in hexadecimal and in binary
- The programmer's calculator: one expression with + - * / % & | ^ ~ << >> >>> and parentheses, evaluated with C's operator precedence at 8, 16, 32, 64, 128 or 256 bits, signed or unsigned for the whole expression
- The calculator result as hexadecimal of the width, unsigned and signed decimal, octal and binary, with every step listed and a warning for each step that wrapped
- Numbers written in decimal, or as 0x, 0o and 0b bit patterns, with underscores or apostrophes between digits

## Limits

- Whole numbers only. There is no fractional part, so 0.5 in binary is not something this converts. The IEEE 754 inspector handles fractional binary values.
- Bases above 36 would need digits beyond the 26 letters, and there is no agreed alphabet for them. Base58 and Base64 have their own tools here because they encode bytes rather than numbers.
- Bitwise operations at the unbounded width use the arbitrary-precision two complement of an infinite-width integer, which is what JavaScript BigInt does, and that differs from a fixed-width language where the result wraps; pick a fixed width to get the wrap-around a fixed-width language gives instead.
- The exponent for a power is capped, and an unbounded shift is capped at 4096 places, because the result would otherwise be too large to render.
- Rotate left, rotate right, the logical (zero-fill) right shift, and byte swap only exist at a fixed width: there is no arbitrary-precision meaning for rotating or swapping the bytes of a number with no fixed size, so these are refused at the unbounded width.
- A fixed width applies only to bitwise, shift and rotate operations. Add, subtract, multiply, divide, remainder and power always stay arbitrary precision and refuse a fixed width.
- At a fixed width, an operand outside both the unsigned and signed range for that width is wrapped (reduced modulo 2^width) before the operation runs, and the page notes which operand wrapped.
- The programmer's calculator reads whole numbers only, at one chosen width of 8 to 256 bits, signed or unsigned for the whole expression. There is no floating point, no variables, no exponent operator and no functions.
- Every operation is wrapped to the width as soon as it is done, as if each result were stored back into a variable of that width. C computes 8-bit and 16-bit intermediate results in a wider integer, so (200 + 100) / 2 is 150 in C and 22 here at 8 bits unsigned. At 32 bits and above C and the calculator agree.
- Division truncates toward zero and the remainder takes the sign of the dividend, as in C. Dividing the smallest value by -1, or changing its sign, wraps back to the smallest value and is flagged; C leaves it undefined.
- A shift by the width or more gives 0 (or -1 for a negative signed value shifted right) and is flagged; C leaves that count undefined. The unsigned right shift >>> is not part of C; here it is a logical shift of the bit pattern.
- Operator precedence is C's, not school arithmetic: 1 | 2 & 4 is 1 | (2 & 4). Not supported: comparisons, && and ||, !, ** and the conditional operator.
- An expression is limited to 2,000 characters and 64 levels of parentheses. A longer one is refused before it is read, and the steps table lists at most 200 steps.

## Ambiguous cases, and what this does about them

- Integer division truncates towards zero, so -7 divided by 2 is -3. C, Java, Go and Rust all agree; Python rounds towards negative infinity and gives -4. The choice made here is the more common one and is stated on the page.
- The remainder takes the sign of the dividend, so -7 modulo 3 is -1 rather than 2. This follows from the division rule above.
- Shifting by the width or more gives 0 for a left shift and a logical right shift, and the sign fill for an arithmetic right shift. C leaves a shift by the width or more undefined, Java masks the shift amount (5 bits for int, 6 bits for long), and JavaScript masks it to 5 bits for its own 32-bit operators.
- A rotate amount is taken modulo the width, so rotating by the width plus 3 is the same as rotating by 3.
- A number written in hexadecimal, octal or binary is a bit pattern of the width, read in the chosen signedness: 0xFF is -1 at 8 bits signed and 255 at 8 bits unsigned. A decimal number must lie in the range of the type, so 200 is refused at 8 bits signed with the advice to write 0xC8; the one exception is a minus sign directly before the decimal that is the smallest value, so -128 is read.
- A decimal written with a leading zero, such as 010, is read as decimal 10 and noted; C reads it as octal 8. Write 0o10 for octal.
- One signedness applies to the whole expression, so there are no mixed signed and unsigned promotions, which is where a C program with both kinds of operand can give a different answer.

## Defined by

- [ISO C draft N1570, section 6.5 (expressions and operator precedence)](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/number-base number-base
cd number-base
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/number-base
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseInBase, toBase, convertAll, widthReport, calculate, atWidth } from '@fodt/number-base';

parseInBase('0xdead_beef', 16).value;   // 3735928559n
toBase(255n, 2);                        // '11111111'
convertAll(255n);                       // every common base at once
widthReport(-1n).twosComplement;        // ff, ffff, ffffffff, …
calculate(0x80000001n, 1n, 'rotateLeft', 32); // 3n (0x00000003)
atWidth(3n, 32);                        // { unsigned: 3n, signed: 3n, hex: '00000003', binary: '000…011' }

import { evaluateExpression, formatResult } from '@fodt/number-base';

const r = evaluateExpression('1 + 2 << 3', { width: 8, signed: false });
r.value;                                 // 24n, because + binds tighter than <<
formatResult(r, 8).hex;                  // '0x18'
evaluateExpression('127 + 1', { width: 8, signed: true }).wrapped; // 1 step wrapped, the value is -128n
```

Values are `bigint` throughout. `parseInBase` returns the magnitude with a separate `negative` flag, so a leading zero or a prefix can still be reported accurately. `calculate` takes an optional fourth argument, `width` (`'unbounded'` by default, or 8/16/32/64/128); `WIDTH_OPERATIONS`, `UNARY_OPERATIONS` and `FIXED_WIDTH_ONLY_OPERATIONS` classify which operations a width applies to, which take one operand, and which need a fixed width outright. `atWidth` and `fitsWidth` work on a value already reduced to a specific width. `evaluateExpression(source, { width, signed })` reads one expression and returns the value, its unsigned bit pattern, the steps (capped at `MAX_STEPS_SHOWN`), the number of steps that wrapped and notes; it throws `ExpressionError`, which carries a 1-based `position` and never repeats the text typed. `formatResult` writes a result in hexadecimal of the width, unsigned and signed decimal, octal and binary. `EXPRESSION_WIDTHS` (8 to 256) is a separate list from `FIXED_WIDTHS`, which is unchanged. `applyBinary` and `applyUnary` run one operation on values already in the range of the type.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Round trips every base from 2 to 36 over a set of values including zero, negatives and 2 to the 64th. Agreement with the platform is checked against `Number.prototype.toString` and `parseInt` for values a double can hold, and precision is checked by converting a 64-digit hexadecimal hash to its exact 78-digit decimal form. Two complement is asserted at every width, and division and modulo sign behaviour is pinned down explicitly. The fixed-width operations are checked against known C and Java results (NOT, rotates, a logical shift, byte swap), truth tables for NAND/NOR/XNOR, the shift-and-rotate-at-or-past-the-width rules, and two differential passes: one against JavaScript's own 32-bit bitwise and shift operators over 1000 random pairs, and one against `BigInt.asUintN`/`asIntN` at 64 bits. The calculator is checked against C compiled by clang 21.1.0 (flags -std=gnu11 -O0 -fwrapv -fno-sanitize=undefined): all 1,358,848 defined cells of 13 operations on every pair of 8-bit operands, signed and unsigned, 8,170 sampled 16 to 128 bit vectors, and 1,708 recorded C expressions at 32 and 64 bits that prove precedence and left associativity. Python integers masked to the width answer the 128 and 256 bit vectors and the cells C leaves undefined. Hand rows come from the C draft. The answers of every earlier export were recorded before the calculator was added and are compared row for row.

## Licence

MIT. See [LICENSE](./LICENSE).
