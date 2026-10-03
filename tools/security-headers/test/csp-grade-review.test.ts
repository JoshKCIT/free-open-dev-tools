import { it, expect } from 'vitest';
import { gradeCsp } from '../src/csp-grade';

// Tests for the findings of the phase 14 code review (part B) against the policy grader. Policies are written out in full so a
// reader can see why each one is graded as it is.

function ruleIds(text: string): string[] {
  return gradeCsp(text).findings.map((f) => f.rule);
}

function metaOf(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

// B-CR-01: a meta element cannot set frame-ancestors, report-uri or sandbox (CSP Level 3 section 3.3).
const META_FRAMING_POLICY =
  "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

it('a meta policy that sets frame-ancestors is not graded A 100, because the browser ignores it there', () => {
  // The same text as a header is the best a policy gets here: nothing is missing.
  const asHeader = gradeCsp(META_FRAMING_POLICY);
  expect(asHeader.score).toBe(100);
  expect(asHeader.grade).toBe('A');
  expect(asHeader.findings.map((f) => f.rule)).not.toContain('meta-ignored-directive');

  const asMeta = gradeCsp(metaOf(META_FRAMING_POLICY));
  expect(asMeta.source).toBe('meta');
  // The page can be framed, so frame-ancestors counts as missing (low, 5 points) and the ignored directive is a medium
  // finding (15 points): 100 - 5 - 15.
  const ids = asMeta.findings.map((f) => f.rule);
  expect(ids).toContain('frame-ancestors');
  expect(ids).toContain('meta-ignored-directive');
  expect(asMeta.score).toBe(80);
  expect(asMeta.grade).toBe('B');
  const ignored = asMeta.findings.filter((f) => f.rule === 'meta-ignored-directive');
  expect(ignored).toHaveLength(1);
  expect(ignored[0]?.severity).toBe('medium');
  expect(ignored[0]?.directive).toBe('frame-ancestors');
  expect(ignored[0]?.finding).toMatch(/frame-ancestors/);
  expect(ignored[0]?.basis).toMatch(/section 3\.3/);
});

it('a meta policy names each directive a meta element ignores: frame-ancestors, report-uri and sandbox', () => {
  const policy = `${META_FRAMING_POLICY}; report-uri https://reports.example.invalid/csp; sandbox allow-scripts`;
  const result = gradeCsp(metaOf(policy));
  const ignored = result.findings.filter((f) => f.rule === 'meta-ignored-directive');
  expect(ignored.map((f) => f.directive).sort()).toEqual(['frame-ancestors', 'report-uri', 'sandbox']);
  for (const f of ignored) expect(f.finding).toContain(f.directive);
  // The rule costs its weight once however many directives it names.
  expect(result.score).toBe(80);
  // As a header all three are honoured and none is reported.
  expect(ruleIds(policy)).not.toContain('meta-ignored-directive');
  expect(ruleIds(policy)).not.toContain('frame-ancestors');
});

it('a meta policy without those directives has no ignored-directive finding and grades as before', () => {
  const policy =
    "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";
  const result = gradeCsp(metaOf(policy));
  expect(result.findings.map((f) => f.rule)).toEqual(['frame-ancestors', 'meta-limits']);
  expect(result.score).toBe(95);
  // A directive name in upper case is still the same directive for a browser.
  expect(ruleIds(metaOf("default-src 'self'; FRAME-ANCESTORS 'none'"))).toContain('meta-ignored-directive');
});

// B-CR-02: frame-ancestors and form-action were scored by being present, so a wide-open list passed.
const OPEN_NAVIGATION_POLICY =
  "default-src 'none'; base-uri 'none'; form-action *; frame-ancestors *; upgrade-insecure-requests";

it('frame-ancestors and form-action that are open to every site are not graded A 100', () => {
  const result = gradeCsp(OPEN_NAVIGATION_POLICY);
  const byRule = new Map(result.findings.map((f) => [f.rule, f]));
  expect(byRule.get('frame-ancestors')?.severity).toBe('low');
  expect(byRule.get('frame-ancestors')?.directive).toBe('frame-ancestors');
  expect(byRule.get('frame-ancestors')?.finding).toMatch(/any host or a whole scheme/);
  expect(byRule.get('form-action')?.severity).toBe('low');
  expect(byRule.get('form-action')?.finding).toMatch(/any host or a whole scheme/);
  // Each costs its full weight (5 points), the same as leaving the directive out.
  expect(result.score).toBe(90);
  expect(result.score).toBe(gradeCsp("default-src 'none'; base-uri 'none'; upgrade-insecure-requests").score);
  // The same policy with https: in place of the star.
  const https = gradeCsp(OPEN_NAVIGATION_POLICY.replaceAll('*', 'https:'));
  expect(https.findings.map((f) => f.rule)).toEqual(['frame-ancestors', 'form-action']);
  expect(https.score).toBe(90);
});

it('open frame-ancestors and form-action shapes: star, schemes, a wildcard host with no name and a bare top level domain', () => {
  const open = [
    '*',
    'https:',
    'http:',
    'data:',
    'blob:',
    'HTTPS:',
    "'self' *",
    "'self' https:",
    'https://*',
    '*:443',
    'https://*:*',
    '*.com',
    'https://*.com',
    '*.com:443',
    '*.org/path',
  ];
  for (const source of open) {
    for (const name of ['frame-ancestors', 'form-action']) {
      const ids = ruleIds(`default-src 'none'; ${name} ${source}`);
      expect(ids, `${name} ${source}`).toContain(name);
    }
  }
  const closed = [
    "'none'",
    "'self'",
    'https://example.invalid',
    'https://app.example.invalid:8443',
    '*.example.invalid',
    'https://*.example.invalid',
    'https://example.invalid/path/',
    "'self' https://example.invalid",
  ];
  for (const source of closed) {
    for (const name of ['frame-ancestors', 'form-action']) {
      const ids = ruleIds(`default-src 'none'; ${name} ${source}`);
      expect(ids, `${name} ${source}`).not.toContain(name);
    }
  }
});

it('a missing frame-ancestors or form-action is still reported as before', () => {
  const ids = ruleIds("default-src 'none'");
  expect(ids).toContain('frame-ancestors');
  expect(ids).toContain('form-action');
  const missing = gradeCsp("default-src 'none'").findings.find((f) => f.rule === 'frame-ancestors');
  expect(missing?.finding).toMatch(/missing/);
});
