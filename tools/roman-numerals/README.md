# Roman Numeral Converter

Convert between Roman numerals and integers using standard subtractive notation.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts an integer from 1 to 3999 to its Roman numeral in standard subtractive notation, and converts a Roman numeral back to an integer. Parsing is strict: a numeral is accepted only if it is the canonical spelling of its value, checked by re-encoding the parsed value and requiring an exact match. Most naive converters accept far more than that, including forms nobody would actually write.

## Supported

- Converting an integer from 1 to 3999 to its Roman numeral in standard subtractive notation
- Converting a Roman numeral back to an integer, validated against every local well-formedness rule and against the canonical spelling of the value it parses to
- Accepting lower-case input and always producing upper-case output
- Ignoring leading and trailing whitespace around the numeral
- Rejecting non-standard forms — four symbols in a row, a repeated subtractive pair, symbols out of order, or a spelling that is not canonical for its value — with a message naming the standard form instead
- Rejecting a character that is not a Roman numeral symbol, with its position

## Limits

- The valid range is 1 to 3999. Standard subtractive notation has no symbol for 5000 or above and no way to write zero or a negative number, so all three are rejected rather than invented.
- Only standard subtractive notation is accepted. Additive forms such as IIII for four, which some clock faces use, are rejected rather than interpreted — a tool that silently accepted two spellings of the same number could not tell a visitor which one their document should use.
- Output is always upper case, regardless of the case of the input.
- There is no lenient mode. A numeral that fails any rule, including the canonical-spelling check, is rejected outright rather than corrected automatically.

## Ambiguous cases, and what this does about them

- Historical and decorative usage of Roman numerals varies. Clock faces commonly show IIII for four instead of IV, and some historical inscriptions use additive-only forms with no subtraction at all. This tool follows the standard subtractive convention taught today and rejects the historical variants, explaining why in the error message rather than silently accepting both spellings of the same number.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/roman-numerals roman-numerals
cd roman-numerals
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/roman-numerals
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { toRoman, fromRoman } from '@fodt/roman-numerals';

toRoman(1994);        // 'MCMXCIV'
fromRoman('MCMXCIV'); // 1994
fromRoman('iv');      // 4
toRoman(4000);         // throws RomanNumeralError, valid range is 1 to 3999
```

toRoman and fromRoman both throw RomanNumeralError, which carries a position field pointing at the offending character when a position is meaningful. fromRoman first checks local well-formedness (symbol order, repeat limits, permitted subtractive pairs), then re-encodes the resulting value with toRoman and requires an exact match against the trimmed, upper-cased input — that second check is what catches a spelling such as IXI, which the local rules alone would accept.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body defines Roman numeral subtractive notation — it is a scribal convention taught in schools, not a specification, and this is stated here rather than a citation being invented. The tests walk the entire valid range, 1 to 3999, in both directions, and the acceptance rules encode the conventional subtractive form rather than a published grammar.

## Licence

MIT. See [LICENSE](./LICENSE).
