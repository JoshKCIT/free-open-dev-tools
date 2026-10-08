# Recorded second opinions for the programmer's calculator

These files are what the calculator in `tools/number-base/src/expression.ts` is tested against. They were recorded once,
in a scratch folder, by `record.py` in this folder. The unit tests only read them; nothing here is run when the tests run,
and nothing is installed by the repository.

## What recorded them

| What | Version | Where it came from |
|------|---------|--------------------|
| C compiler | clang version 21.1.0, target x86_64-unknown-windows-gnu | the `ziglang` 0.16.0 package for Python (`python -m ziglang cc`), installed with `--ignore-scripts` into a scratch virtual environment outside the repository |
| Python | 3.14.3 | the same scratch environment; standard library only |
| Recorded | 2026-10-08 (UTC), see `recordedAt` inside each file | `python record.py --out <this folder>` |

## The compile flags and why each matters

`-std=gnu11 -O0 -fwrapv -fno-sanitize=undefined`

- `-std=gnu11` is C11 plus the compiler's extensions, which gives the 128-bit integer type (`__int128`) used for the
  128-bit vectors.
- `-O0` keeps every operation as written, so the compiler cannot fold a case C leaves undefined into something else.
- `-fwrapv` makes signed overflow wrap in two's complement, which is what the calculator documents for every step
  (addition, subtraction, multiplication and negation of the smallest value). Without it the compiler may assume signed
  overflow never happens.
- `-fno-sanitize=undefined` is needed because this compiler driver adds run-time traps by default: a shift out of range
  or a division by zero in a recorded cell would stop the recorder with a panic instead of printing a result. The
  recorder also skips every cell where C is undefined, so no trapping cell is ever compared.

## The files

- `oracle8.c` and `oracle8.json`: every pair of 8-bit operands (65,536 pairs) for 13 operations (add, sub, mul, div, rem,
  and, or, xor, shl, shr, ushr, not, neg), once as `int8_t` and once as `uint8_t`: 26 tables, 1,703,936 cells. Each cell
  is the C expression computed on the 8-bit operands (C promotes them to `int`) and cast back to the 8-bit type. Cells
  where C is undefined are marked in a second mask and are not compared: a zero divisor, and a shift count below 0 or
  above 31, which is 345,088 cells. That leaves **1,358,848 compared cells**. The tables are stored as one byte per cell,
  gzip then base64 (about 200 KB for the whole file). `ushr` is the unsigned right shift `>>>`, which C does not have; the
  recorder writes it as a shift of the unsigned bit pattern.
- `oraclew.c` and `wide-vectors.txt`: sampled vectors at 16, 32, 64, 128 and 256 bits, 11,550 rows of 11 binary
  operations, signed and unsigned: the edge values (0, 1, all ones, the smallest and largest signed values, the width and
  the width minus one) paired with each other, plus seeded random pairs, and random shift counts below the width for the
  shifts. Where C can answer (16 to 128 bits, and the operation is defined for those operands) the row is marked `c`
  (8,170 rows). Where it cannot, and for every 256-bit row, the answer is Python's integers masked to the width, marked
  `python` (3,380 rows). Python is an independent implementation, and where both answered they agree on every cell, or
  the recorder stops. A `!` result means the calculator must refuse the operation (a zero divisor or a negative shift
  count; 673 rows). Each row reads `<width> <s or u> <operator> <a> <b> <result> <source>`, with the operands and the
  result written as hexadecimal bit patterns of the width.
- `precedence.json`: 1,708 unparenthesised chains of 2 to 6 operands over ten binary operators (`|`, `^`, `&`, `<<`, `>>`,
  `+`, `-`, `*`, `/`, `%`) at `uint32_t`, `int32_t`, `uint64_t` and `int64_t`, each literal cast to the type, compiled and
  run by clang. They prove C's precedence and left associativity, not only the single operations. Chains that would
  divide by zero, shift out of range or compute the smallest value divided by -1 were not kept, so C is defined for every
  row. Each row holds the type, the expression and the result as a hexadecimal bit pattern of the width.

## The seeds

- `wide-vectors.txt`: Python `random.Random(20261006)`.
- `precedence.json`: Python `random.Random(20261007)`.

## What the 8-bit and 16-bit rows do not show

C computes an 8-bit or 16-bit operation in `int`, so `(200 + 100) / 2` is 150 in C and 22 in the calculator, which wraps
every step to the width. The recorder casts each operation back to the type (`(T)(a + b)`) so a cell is one step, which is
what the calculator does. At 32 bits and above C and the calculator agree without any cast, which is what the precedence
corpus shows.

## Licence

The recorded results are facts about what the compiler and Python produce. `record.py`, `oracle8.c` and `oraclew.c` are
this project's own, under the repository's MIT licence.
