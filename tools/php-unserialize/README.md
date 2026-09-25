# PHP Unserialize

Decode PHP serialized strings into JSON.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decodes a PHP serialize() string into a plain JSON value by scanning the byte stream by hand, never by calling PHP's own unserialize(). PHP's manual warns that unserializing untrusted input can instantiate arbitrary classes and run their magic methods; this reads only the data, and never instantiates, calls or evaluates anything.

## Supported

- null, booleans, integers, floats (including PHP's INF, -INF and NAN), and strings, with string lengths read as UTF-8 byte counts, not character counts
- Arrays, turned into a JSON array when their keys are sequential integers starting at 0 (optional), or a JSON object keyed by the original array keys otherwise
- Objects, turned into a plain JSON object whose first key is __class, with protected and private property names decoded and their visibility kept in the key name
- Custom-serialized values (C:) and enum cases (E:) decoded as tagged JSON rather than interpreted
- References (r: and R:) copied from the value they point to, without ever creating a cycle
- A depth limit of 512 levels and a limit of one million decoded values, each refused with a plain message before the work that would freeze the tab

## Limits

- PHP's INF, -INF and NAN floats have no JSON representation, so they are kept as the strings "INF", "-INF" and "NAN" with a warning, as are integers outside JavaScript's safe integer range
- Every decoded key becomes a JSON object key, so an array's original integer keys become string keys in the output
- A property's visibility (public, protected or private) is kept only in its key name (name, name (protected), name (private ClassName)), never as separate metadata
- A reference to a value that has not finished decoding yet cannot be expanded, and is reported as { "__reference": n } with a warning instead
- Custom-serialized (C:) payloads are shown as raw text under __serialized; they are never parsed or interpreted, since only the class that defined them knows their format

## Ambiguous cases, and what this does about them

- PHP's serialize() format has no publishing standards body; behaviour here follows the PHP manual pages for serialize() and unserialize() and the grammar used by PHP's own reference implementation (ext/standard/var_unserializer.re in the php-src repository)

## Defined by

- [PHP Manual — serialize()](https://www.php.net/manual/en/function.serialize.php)
- [PHP Manual — unserialize()](https://www.php.net/manual/en/function.unserialize.php)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/php-unserialize php-unserialize
cd php-unserialize
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/php-unserialize
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { unserializePhp } from '@fodt/php-unserialize';

const result = unserializePhp('a:2:{i:0;s:1:"a";i:1;s:1:"b";}');
result.value;    // ["a", "b"]
result.warnings; // []
result.stats;    // { valueCount, maxDepth }
```

`unserializePhp(text, { sequentialArrays = true })` returns `{ value, warnings, stats }`. Input problems throw `PhpUnserializeError` with a byte `offset`, and `line`/`column` computed for the page. Nothing in this package ever calls a constructor, a magic method, `eval`, `Function`, or sets an object's prototype: it only ever builds plain objects, arrays, strings, numbers, booleans and null.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

String byte-length handling is checked against multi-byte UTF-8 text (an accented character and an emoji); object, array, reference, enum and custom-serialized decoding are checked against test vectors quoted from the PHP manual pages above and from the var_unserializer.re grammar in the php-src repository; the depth and value-count limits are checked with pathological input that would otherwise freeze the tab.

## Licence

MIT. See [LICENSE](./LICENSE).
