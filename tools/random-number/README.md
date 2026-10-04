# Random Number Generator

Generate random integers or decimals, roll dice such as 2d6+3, flip coins, draw lottery numbers without repeats and pick items from a list.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates one or more random integers or decimals inside a range you choose, both bounds included. Numbers come from the browser's cryptographically secure random source by default, using unbiased rejection sampling rather than a modulo of a random word, which is the shortcut that quietly skews the low end of a range. It also rolls dice written in standard notation such as 2d6+3 or 4d6kh3, flips coins, draws lottery numbers without repeats and picks items from a pasted list, always from the same cryptographic source with the same unbiased sampling.

## Supported

- Integer generation, inclusive of both the lower and upper bound
- Decimal generation with any number of decimal places, rounded to exactly that many digits
- Any count of values in a single request
- A cryptographically secure source (the browser's Web Crypto `getRandomValues`) by default
- An optional non-cryptographic source for reproducible-looking test data
- Optional uniqueness for integer output, so no value repeats within one request
- Unbiased sampling across the requested range via rejection sampling, never a modulo of a random word
- Dice in standard notation, such as 2d6+3, 4d6kh3, d%, 3dF and 1d20+1d4-2, under a stated grammar: expression := term (('+' | '-') term)*, term := dice | integer, dice := [count] 'd' (sides | '%' | 'F') [modifier], modifier := ('kh' | 'kl' | 'dh' | 'dl') [n]
- Every die shown in roll order, the dice kept and dropped, each term's subtotal and the total; when dice tie for a keep or drop place the earliest roll is kept
- Coin flips, each one shown, with the heads and tails counts
- Lottery draws of 1 to 10,000 numbers from a pool of 2 to 1,000,000, without repeats, shown in draw order and sorted
- Picks from a pasted list, one item per line with blank lines ignored, with or without replacement

## Limits

- This is a generator of values, not a source of cryptographic keys, tokens or secrets.
- The non-cryptographic source is offered only for reproducible-looking test data and must never be used for anything that matters.
- Decimal output is rounded to the requested number of places, so the printed value is not the full-precision draw that produced it.
- A unique-integer request whose range holds fewer distinct values than the count asked for is rejected rather than attempted.
- Dice: up to 1,000 dice in one term and 10,000 in an expression, 2 to 1,000,000 sides; d% is d100 and dF is a fudge die.
- Coin flips, lottery draws and list picks run up to 10,000; lottery pools hold 2 to 1,000,000 numbers and draws are without repeats.
- Dice, coins, lottery draws and list picks always use the cryptographic source with rejection sampling, so no outcome is favoured; the source choice applies only to integers and decimals.
- A list holds at most 10,000 items of at most 200 characters each, and dice notation is read up to 200 characters; blank lines are ignored.
- Text that is not valid dice notation is refused with the position of the first problem and is never repeated back.

## Ambiguous cases, and what this does about them

- The range is inclusive at both ends: asking for 1 to 6 can return either 1 or 6, not just the values strictly between them.
- The dice grammar is its own, stated on the page: a lone integer is a term, a sign cannot start an expression, and when dice tie for a keep or drop place the earliest rolled is kept, so dropping the highest dice drops the later of tied ones.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/random-number random-number
cd random-number
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/random-number
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generate } from '@fodt/random-number';

generate({ mode: 'integer', min: 1, max: 6, count: 10 });
// { values: ['4','1','6','3','2','5','5','1','4','6'], source: 'crypto', min: 1, max: 6, mode: 'integer' }

generate({ mode: 'decimal', min: 0, max: 1, places: 3, count: 1 });
// { values: ['0.512'], source: 'crypto', min: 0, max: 1, mode: 'decimal' }

import { parseDiceNotation, rollDice } from '@fodt/random-number';

rollDice(parseDiceNotation('4d6kh3'));
// { terms: [{ notation: '4d6kh3', rolls: [3, 3, 1, 6], kept: [3, 3, 6], dropped: [1], keptIndexes: [0, 1, 3], subtotal: 12 }], total: 12, diceRolled: 4 }
```

Throws `RandomNumberError` for an inverted range, a non-finite bound, a count below one, a unique-integer request whose range cannot hold the count requested, or a decimal range with no value representable at the requested precision. `RandomNumberOptions` also accepts an undocumented `byteSource`, an array of raw bytes consumed instead of drawing from the configured source; it exists only so the rejection-sampling path can be tested deterministically and is never exposed on the page. `parseDiceNotation` throws `DiceError` with a fixed sentence and the position of the first problem, and never repeats the text it was given. `flipCoins`, `drawLottery` and `pickItems` throw `RandomDrawError` for a count, pool, draw or list outside its limits. These functions draw only through the same rejection sampler over `crypto.getRandomValues`; their `byteSource` option is for tests, like the one on `generate`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes random-number test vectors, so correctness here is grounded in the definition of an inclusive range and proven deterministically: a supplied byte sequence forces a draw into the rejection-sampling path's discarded final block, and the test asserts the next byte's value is returned rather than a biased modulo of the first. A large-sample check that every value in a small range eventually appears is kept as a smoke test alongside it, not as the proof, because it cannot itself distinguish rejection sampling from a small modulo bias. The dice, coin, lottery and pick code is proven the same way: fixed byte sequences worked by hand through the rejection rule (including bytes that fall in the redrawn zone), exact limits at both ends of every range, and a spy that shows `crypto.getRandomValues` is the only source drawn from.

## Licence

MIT. See [LICENSE](./LICENSE).
