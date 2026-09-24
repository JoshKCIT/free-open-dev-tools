import { it, expect } from 'vitest';
import { extractPatterns, isIPv4, isIPv6, PATTERN_KINDS, type Extracted } from '../src/index';

function values(results: Extracted[]): string[] {
  return results.map((r) => r.value);
}

it('RFC 5322 dot-atom addresses are extracted without trailing sentence punctuation', () => {
  // RFC 5322 section 3.2.3 (Atom): atext = ALPHA / DIGIT / "!" / "#" / "$" / "%" / "&" / "'" /
  // "*" / "+" / "-" / "/" / "=" / "?" / "^" / "_" / "`" / "{" / "|" / "}" / "~"; dot-atom-text =
  // 1*atext *("." 1*atext). Section 3.4.1 (Addr-Spec Specification): addr-spec = local-part "@"
  // domain; local-part = dot-atom (among other forms). Fetched live from
  // https://www.rfc-editor.org/rfc/rfc5322.txt, 2026-09-24.
  const basic = extractPatterns('Mail ops@example.com. Thanks', { kinds: ['email'] });
  expect(values(basic)).toEqual(['ops@example.com']);
  expect(basic[0]!.index).toBe('Mail '.length);

  const tagged = extractPatterns('Reach user+tag.name@example.co.uk now', { kinds: ['email'] });
  expect(values(tagged)).toEqual(['user+tag.name@example.co.uk']);

  // A domain with no dot, or with a TLD that is not letters-only, is out of
  // scope per this tool's own `limits` -- not extracted.
  const noDomainDot = extractPatterns('reach admin@localhost for help', { kinds: ['email'] });
  expect(values(noDomainDot)).toEqual([]);
});

it('RFC 3986 http and https URLs are extracted without a trailing period or unbalanced closing parenthesis', () => {
  // RFC 3986 Appendix A: pchar = unreserved / pct-encoded / sub-delims / ":" / "@"; sub-delims
  // includes "(" and ")", so a URL may legitimately contain a balanced parenthesis pair.
  // Fetched live from https://www.rfc-editor.org/rfc/rfc3986.txt, 2026-09-24.
  const balanced = extractPatterns('(see https://example.com/a_(b)) for more', { kinds: ['url'] });
  expect(values(balanced)).toEqual(['https://example.com/a_(b)']);

  const unbalanced = extractPatterns('Visit https://example.com/x).', { kinds: ['url'] });
  expect(values(unbalanced)).toEqual(['https://example.com/x']);

  const trailingComma = extractPatterns('See https://example.com/status, then act.', { kinds: ['url'] });
  expect(values(trailingComma)).toEqual(['https://example.com/status']);
});

it('IPv4 addresses with an octet above 255 or more than four parts are not extracted', () => {
  expect(isIPv4('256.1.1.1')).toBe(false);
  expect(isIPv4('1.2.3.4.5')).toBe(false);
  expect(isIPv4('192.0.2.10')).toBe(true);

  const results = extractPatterns('Bad 256.1.1.1 and 1.2.3.4.5 but good 192.0.2.10 here', {
    kinds: ['ipv4'],
  });
  expect(values(results)).toEqual(['192.0.2.10']);

  // A trailing sentence period is not part of the address.
  const trailing = extractPatterns('The host is 192.0.2.10.', { kinds: ['ipv4'] });
  expect(values(trailing)).toEqual(['192.0.2.10']);
});

it('RFC 4291 section 2.2 compressed and IPv4-embedded IPv6 forms are extracted and times or MAC addresses are not', () => {
  // RFC 4291 section 2.2 (Text Representation of Addresses): "::" indicates one or more groups
  // of 16 zero bits and can appear at most once; the alternative form
  // x:x:x:x:x:x:d.d.d.d embeds an IPv4 address in the low 32 bits. Fetched live from
  // https://www.rfc-editor.org/rfc/rfc4291.txt, 2026-09-24.
  expect(isIPv6('2001:db8::1')).toBe(true);
  expect(isIPv6('::1')).toBe(true);
  expect(isIPv6('::ffff:192.0.2.128')).toBe(true);
  expect(isIPv6('10:30:00')).toBe(false);
  expect(isIPv6('00:1A:2B:3C:4D:5E')).toBe(false);

  const results = extractPatterns(
    'Address 2001:db8::1, loopback ::1, dual-stack ::ffff:192.0.2.128, not a time 10:30:00, not a MAC 00:1A:2B:3C:4D:5E.',
    { kinds: ['ipv6'] },
  );
  expect(values(results)).toEqual(['2001:db8::1', '::1', '::ffff:192.0.2.128']);
});

it('E.164 international phone numbers with separators are extracted and a date or an IPv4 address is not', () => {
  // ITU-T E.164 (via its own live landing page at https://www.itu.int/rec/T-REC-E.164, which
  // renders no plain text -- so the grounding text below was taken from the Wikipedia E.164
  // article, itself fetched live from https://en.wikipedia.org/w/index.php?title=E.164&action=raw,
  // 2026-09-24, which quotes and cites the ITU document directly): "Plan-conforming telephone
  // numbers are limited to only digits and to a maximum of fifteen digits."
  const results = extractPatterns(
    'Call +44 20 7946 0958 or +1 (555) 010-4477. Not on 2024-03-10 and not 192.0.2.10.',
    { kinds: ['phone'] },
  );
  expect(values(results)).toEqual(['+44 20 7946 0958', '+1 (555) 010-4477']);
});

it('duplicates are collapsed when asked and counted', () => {
  const text = 'Mail ops@example.com twice: once here ops@example.com and again ops@example.com.';

  const deduped = extractPatterns(text, { kinds: ['email'] });
  expect(deduped).toHaveLength(1);
  expect(deduped[0]!.value).toBe('ops@example.com');
  expect(deduped[0]!.count).toBe(3);

  const notDeduped = extractPatterns(text, { kinds: ['email'], dedupe: false });
  expect(notDeduped).toHaveLength(3);
  expect(notDeduped.every((r) => r.value === 'ops@example.com' && r.count === 1)).toBe(true);
});

it('PATTERN_KINDS lists all five supported kinds', () => {
  expect(PATTERN_KINDS).toEqual(['email', 'url', 'ipv4', 'ipv6', 'phone']);
});
