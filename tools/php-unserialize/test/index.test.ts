import { it, expect } from 'vitest';
import { unserializePhp, PhpUnserializeError, PHP_LIMITS } from '../src/index';

/**
 * Test vectors are quoted or hand-built from three sources, fetched live
 * this session and never taken from memory:
 *
 * - https://www.php.net/manual/en/function.unserialize.php -- the
 *   object-injection warning quoted below, and the format notes on
 *   private/protected property name prefixes ("Object's private members
 *   have the class name prepended to the member name; protected members
 *   have a '*' prepended to the member name. These prepended values have
 *   null bytes on either side.")
 * - https://www.php.net/manual/en/function.serialize.php -- the token
 *   shapes ("s:size:value;", "a:size:{...}", "O:strlen(name):name:size:{...}")
 *   and "Returns a string containing a byte-stream representation" (byte,
 *   not character, counts).
 * - https://raw.githubusercontent.com/php/php-src/master/ext/standard/var_unserializer.re
 *   -- the exact token grammar for every case below: "N;", "b:0;"/"b:1;",
 *   "i:" iv ";", "d:" (NAN|-?INF) ";", "d:" (iv|nv|nvexp) ";",
 *   "s:" uiv ":" ["], object ":" uiv ":" ["] (shared by O: and C:),
 *   "E:" uiv ":" ["], "r:" uiv ";", "R:" uiv ";".
 */

it('the PHP manual serialize formats for null, booleans, integers, floats, strings and arrays decode to JSON', () => {
  expect(unserializePhp('N;').value).toBeNull();
  expect(unserializePhp('b:1;').value).toBe(true);
  expect(unserializePhp('b:0;').value).toBe(false);
  expect(unserializePhp('i:685230;').value).toBe(685230);
  expect(unserializePhp('i:-685230;').value).toBe(-685230);
  expect(unserializePhp('d:685230.15;').value).toBe(685230.15);
  expect(unserializePhp('s:5:"apple";').value).toBe('apple');
  expect(unserializePhp('a:2:{i:0;s:1:"a";i:1;s:1:"b";}').value).toEqual(['a', 'b']);
  expect(unserializePhp('a:2:{i:0;s:1:"a";i:1;s:1:"b";}', { sequentialArrays: false }).value).toEqual({
    '0': 'a',
    '1': 'b',
  });
});

it('string lengths are UTF-8 byte counts so cafe with an accent is 5 bytes and an emoji is 4 bytes', () => {
  // cafe with an accent: c(1)+a(1)+f(1)+accented-e(2 bytes, U+00E9) = 5 bytes, 4 characters.
  expect(unserializePhp('s:5:"café";').value).toBe('café');
  // An emoji outside the Basic Multilingual Plane (U+1F600) is 4 bytes in UTF-8
  // and a surrogate pair (2 UTF-16 code units) in JavaScript.
  expect(unserializePhp('s:4:"\u{1f600}";').value).toBe('\u{1f600}');
});

it('a wrong byte count is refused with the byte offset', () => {
  let caught: unknown;
  try {
    unserializePhp('s:4:"café";');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PhpUnserializeError);
  const error = caught as PhpUnserializeError;
  expect(typeof error.offset).toBe('number');
  expect(error.line).toBe(1);
});

it('objects become plain JSON objects tagged with their class name and nothing is instantiated', () => {
  const result = unserializePhp('O:8:"stdClass":1:{s:1:"x";i:1;}');
  expect(result.value).toEqual({ __class: 'stdClass', x: 1 });
  expect((result.value as { constructor: unknown }).constructor).toBe(Object);
});

it('protected and private property names are decoded with their visibility', () => {
  // Manual note: private members get "\0ClassName\0name", protected get
  // "\0*\0name" -- both with NUL bytes on either side.
  const protectedKey = '\u0000*\u0000bar';
  const privateKey = '\u0000Foo\u0000baz';
  const bytesOf = (s: string) => new TextEncoder().encode(s).length;
  const serialized = `O:3:"Foo":2:{s:${bytesOf(protectedKey)}:"${protectedKey}";i:1;s:${bytesOf(privateKey)}:"${privateKey}";i:2;}`;
  const result = unserializePhp(serialized);
  expect(result.value).toEqual({ __class: 'Foo', 'bar (protected)': 1, 'baz (private Foo)': 2 });
});

it('nesting deeper than 512 levels is refused with a plain message', () => {
  let serialized = 'N;';
  for (let i = 0; i < 600; i++) serialized = `a:1:{i:0;${serialized}}`;
  let caught: unknown;
  try {
    unserializePhp(serialized);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PhpUnserializeError);
  expect((caught as PhpUnserializeError).message).toContain(`${PHP_LIMITS.maxDepth}`);
});

it('a declared element count larger than the input is refused before allocating', () => {
  let caught: unknown;
  try {
    unserializePhp('a:999999999:{}');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PhpUnserializeError);
});

it('references are copied without cycles and reference amplification hits the value limit', () => {
  // r:3; copies the finished string at slot 3 (the value of key i:0).
  const shared = unserializePhp('a:2:{i:0;s:5:"hello";i:1;r:3;}');
  expect(shared.value).toEqual(['hello', 'hello']);

  // r:1; here targets the OUTER array while it is still being built (the
  // reference sits inside the inner array, which is itself the outer
  // array's only element) -- resolved as a plain marker, never a cycle.
  const cyclic = unserializePhp('a:1:{i:0;a:1:{i:0;r:1;}}');
  expect(cyclic.value).toEqual([[{ __reference: 1 }]]);
  expect(cyclic.warnings.length).toBeGreaterThan(0);

  // Reference amplification: one ~1000-element array referenced ~1000
  // times would decode to roughly a million values once every reference
  // is expanded -- each expansion must itself count toward the limit, or
  // this would never be refused.
  // Slot numbering: every value is pushed to the reference table the
  // moment it starts being parsed (matching php-src's own var_hash push
  // rule), so slot 1 is the OUTER array itself (still being built for the
  // whole test), slot 2 is key i:0's own integer, and slot 3 is the big
  // array -- the first value that actually finishes before the rest of
  // the outer array is parsed, so it is the one worth referencing.
  const n = 1000;
  let bigBody = '';
  for (let i = 0; i < n; i++) bigBody += `i:${i};i:${i};`;
  const big = `a:${n}:{${bigBody}}`; // slot 3: this array. slots 4..2003: its keys and values.
  let outerBody = `i:0;${big}`; // key 0 (slot 2), value: the big array itself (slot 3)
  for (let i = 1; i < 1000; i++) outerBody += `i:${i};r:3;`; // 999 references back to slot 3, the big array
  const amplified = `a:1000:{${outerBody}}`;
  let caught: unknown;
  try {
    unserializePhp(amplified);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PhpUnserializeError);
  expect((caught as PhpUnserializeError).message).toMatch(/1,000,000|one million|decoded values/i);
}, 20000);

it('INF, NAN and out-of-range integers are kept as strings with a warning', () => {
  const inf = unserializePhp('d:INF;');
  expect(inf.value).toBe('INF');
  expect(inf.warnings.length).toBeGreaterThan(0);

  const negInf = unserializePhp('d:-INF;');
  expect(negInf.value).toBe('-INF');

  const nan = unserializePhp('d:NAN;');
  expect(nan.value).toBe('NAN');

  // 9223372036854775807 is PHP's PHP_INT_MAX on a 64-bit build, well
  // beyond JavaScript's safe integer range (2^53 - 1).
  const bigInt = unserializePhp('i:9223372036854775807;');
  expect(bigInt.value).toBe('9223372036854775807');
  expect(bigInt.warnings.length).toBeGreaterThan(0);
});

it('enum and custom-serialized values decode as tagged JSON', () => {
  const suit = 'Suit:Hearts';
  const enumSerialized = `E:${suit.length}:"${suit}";`;
  expect(unserializePhp(enumSerialized).value).toEqual({ __enum: 'Suit', case: 'Hearts' });

  const className = 'MySerializable';
  const payload = 'raw-payload-text';
  const customSerialized = `C:${className.length}:"${className}":${payload.length}:{${payload}}`;
  expect(unserializePhp(customSerialized).value).toEqual({ __class: className, __serialized: payload });
});

it('an array key named __proto__ becomes an own key and Object.prototype is never modified', () => {
  const result = unserializePhp('a:1:{s:9:"__proto__";i:1;}');
  expect(Object.hasOwn(result.value as object, '__proto__')).toBe(true);
  expect((result.value as Record<string, unknown>)['__proto__']).toBe(1);
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
});
