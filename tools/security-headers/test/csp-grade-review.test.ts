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

// B-WR-01: valid policies got false "invalid or ignored" findings.
function syntaxFindings(text: string): string[] {
  return gradeCsp(text)
    .findings.filter((f) => f.rule === 'syntax')
    .map((f) => f.finding);
}

it('the Trusted Types directives are known and cost nothing', () => {
  const base = "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  const withTypes = `${base}; require-trusted-types-for 'script'; trusted-types foo bar 'allow-duplicates'`;
  expect(syntaxFindings(withTypes)).toEqual([]);
  expect(gradeCsp(withTypes).score).toBe(gradeCsp(base).score);
  // The names are matched without regard to case, as every directive name is.
  expect(syntaxFindings(`${base}; Require-Trusted-Types-For 'script'; TRUSTED-TYPES default`)).toEqual([]);
  // A name that only looks like one is still an unknown directive.
  expect(syntaxFindings(`${base}; trusted-type foo`)).toHaveLength(1);
  expect(syntaxFindings(`${base}; require-trusted-types-for-script x`)).toHaveLength(1);
});

it('keywords and the prefixes of nonces and hashes are read without regard to case', () => {
  expect(syntaxFindings("DEFAULT-SRC 'SELF'")).toEqual([]);
  expect(syntaxFindings("default-src 'Self' 'None'")).toEqual([]);
  expect(syntaxFindings("script-src 'STRICT-DYNAMIC' 'Unsafe-Eval' 'WASM-UNSAFE-EVAL'")).toEqual([]);
  expect(syntaxFindings("frame-ancestors 'SELF'")).toEqual([]);
  expect(syntaxFindings("script-src 'NONCE-DhcnhD3khTMePgXwdayK9BsMqXjhguVV'")).toEqual([]);
  expect(syntaxFindings("script-src 'SHA256-jzgBGA4UWFFmpOBq0JpdsySukE1FrEN5bUpoK8Z29fY='")).toEqual([]);
  // The grader already read 'UNSAFE-INLINE' in upper case as the keyword, so the same policy has no syntax finding too.
  expect(ruleIds("script-src 'UNSAFE-INLINE'")).toContain('script-unsafe-inline');
  expect(syntaxFindings("script-src 'UNSAFE-INLINE'")).toEqual([]);
  // What is not a keyword in any case is still reported, with the token as pasted.
  const bad = syntaxFindings("default-src 'SELFF'");
  expect(bad).toHaveLength(1);
  expect(bad[0]).toContain("'SELFF'");
  expect(syntaxFindings("script-src 'NONCE-'")).toHaveLength(1);
  expect(syntaxFindings("script-src 'SHA999-abc'")).toHaveLength(1);
  // A keyword without its quotes is still reported, and so is a repeated directive.
  expect(syntaxFindings('default-src SELF')).toHaveLength(1);
  expect(syntaxFindings("default-src 'self'; DEFAULT-SRC 'none'")).toHaveLength(1);
});

// B-WR-02: "Line N" counted semicolon-separated parts, so a one-line policy reported "Line 2".
it('a syntax finding names the directive by its place in the policy, not a line', () => {
  const oneLine = syntaxFindings("default-src 'self'; frobnicate x");
  expect(oneLine).toHaveLength(1);
  expect(oneLine[0]).toMatch(/^Directive 2: /);
  expect(oneLine[0]).not.toMatch(/Line/);
  // Empty parts between semicolons are not directives and are not counted.
  expect(syntaxFindings("default-src 'self';; ; frobnicate x")[0]).toMatch(/^Directive 2: /);
  // One directive per line, and a mix of lines and semicolons: the place counts in reading order.
  expect(syntaxFindings("default-src 'self'\nobject-src 'none'\nfrobnicate x")[0]).toMatch(/^Directive 3: /);
  expect(syntaxFindings("default-src 'self'; object-src 'none'\n\nfrobnicate x; img-src 'self'")[0]).toMatch(
    /^Directive 3: /,
  );
  // The first directive is directive 1.
  expect(syntaxFindings('frobnicate x; default-src none')[0]).toMatch(/^Directive 1: /);
  expect(syntaxFindings('frobnicate x; default-src none')[1]).toMatch(/^Directive 2: /);
});
