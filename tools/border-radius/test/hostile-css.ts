/**
 * Shared hostile-value battery (D-118). Copied wherever `css-safe.ts` is
 * copied, alongside its own test. Test-only: this module exports data and
 * registers no tests of its own, so a generator's own hostile-value test
 * can import the battery without double-registering the safety tests in
 * `css-safe.test.ts`.
 *
 * Every host named below is `example.invalid`, the address RFC 2606
 * reserves so it can never resolve -- a browser test that somehow let one
 * of these values reach a real request would still hit nothing.
 */
export const HOSTILE_VALUES: readonly string[] = [
  // A resource reference function with an https address.
  'url(https://example.invalid/x)',
  // The same with a protocol-relative address.
  'url(//example.invalid/x)',
  // The same upper-cased and with a space before the parenthesis.
  'URL (https://example.invalid/x)',
  // A CSS-escaped form of the function name ("\75" is the hex escape for "u").
  '\\75rl(https://example.invalid/x)',
  // An image set.
  'image-set(url(https://example.invalid/x) 1x)',
  '-webkit-image-set(url(https://example.invalid/x) 1x)',
  // A cross fade.
  'cross-fade(url(https://example.invalid/x))',
  // An import rule.
  '@import url(https://example.invalid/x);',
  // A font face rule.
  '@font-face { src: url(https://example.invalid/x); }',
  // A value that closes the declaration and adds another property.
  'red; background: url(https://example.invalid/x)',
  // A value that closes the rule and opens a new one.
  'red } .evil { background: url(https://example.invalid/x)',
  // A closing style tag followed by markup.
  '</style><script>top.__fodtXss=1</script>',
  // A comment opener.
  '/* */ red',
  // An "!important".
  'red !important',
  // An expression function.
  'expression(alert(1))',
  // A binding property/value pair.
  '-moz-binding:url(https://example.invalid/x.xml#exploit)',
];
