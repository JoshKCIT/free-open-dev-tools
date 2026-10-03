import { it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { parseCspDirectives } from '../src/csp';
import {
  effectiveSources,
  gradeCsp,
  normaliseForGrading,
  CspGradeError,
  CSP_RULES,
  CSP_GRADE_MAX_CHARS,
  CSP_SEVERITY_WEIGHTS,
} from '../src/csp-grade';

// The package prints nothing: every test runs with the console watched.
let spies: MockInstance[] = [];
beforeEach(() => {
  spies = (['log', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => {
  for (const spy of spies) {
    expect(spy.mock.calls).toHaveLength(0);
    spy.mockRestore();
  }
});

// The grading weights are this page's own summary policy: high 30, medium 15, low 5 and info 0 points off 100; A from 90,
// B from 75, C from 60, D from 40 and F below; any high finding caps the grade at D.

// A policy that no rule has anything to say about: scripts only from the page's own origin, no plugins, a fixed base,
// no framing, no form posts elsewhere and plain http upgraded.
const CLEAN =
  "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests";

function rule(text: string, id: string) {
  return gradeCsp(text).findings.find((f) => f.rule === id);
}

it('the effective source list follows the CSP Level 3 section 6.8.3 fallback order', () => {
  // Section 6.8.3 "Get fetch directive fallback list": script-src-elem, then script-src, then default-src.
  const all = parseCspDirectives(
    "default-src 'none'; script-src 'self'; script-src-elem https://a.example.invalid",
  ).directives;
  expect(effectiveSources(all, 'script-src-elem')).toEqual({
    directive: 'script-src-elem',
    sources: ['https://a.example.invalid'],
  });
  const noElem = parseCspDirectives("default-src 'none'; script-src 'self'").directives;
  expect(effectiveSources(noElem, 'script-src-elem')).toEqual({ directive: 'script-src', sources: ["'self'"] });
  const onlyDefault = parseCspDirectives("default-src 'none'").directives;
  expect(effectiveSources(onlyDefault, 'script-src-elem')).toEqual({ directive: 'default-src', sources: ["'none'"] });
  expect(effectiveSources([], 'script-src-elem')).toBeNull();
  // worker-src falls back through child-src, script-src and default-src (the same section).
  const workers = parseCspDirectives(
    "default-src 'none'; script-src 'self'; child-src https://w.example.invalid",
  ).directives;
  expect(effectiveSources(workers, 'worker-src')).toEqual({
    directive: 'child-src',
    sources: ['https://w.example.invalid'],
  });
  expect(effectiveSources(noElem, 'worker-src')).toEqual({ directive: 'script-src', sources: ["'self'"] });
  // base-uri, form-action and frame-ancestors have no fallback: only their own directive counts.
  for (const name of ['base-uri', 'form-action', 'frame-ancestors']) {
    expect(effectiveSources(onlyDefault, name)).toBeNull();
  }
  expect(effectiveSources(parseCspDirectives("base-uri 'self'").directives, 'base-uri')).toEqual({
    directive: 'base-uri',
    sources: ["'self'"],
  });
});

it('missing script control, script unsafe-inline and missing object-src are found with their fixes', () => {
  // Section 6: developers SHOULD include directives that regulate sources of script and plugins, and SHOULD NOT include 'unsafe-inline'.
  const none = rule("img-src 'self'", 'script-unrestricted');
  expect(none?.severity).toBe('high');
  expect(none?.fix).toMatch(/default-src/);
  expect(none?.why.length).toBeGreaterThan(10);
  expect(none?.basis).toMatch(/CSP Level 3 section 6/);

  const inline = rule("script-src 'unsafe-inline'; object-src 'none'", 'script-unsafe-inline');
  expect(inline?.severity).toBe('high');
  expect(inline?.directive).toBe('script-src');
  expect(inline?.fix).toMatch(/nonce/);
  // With a nonce in the same list, browsers that know nonces ignore 'unsafe-inline': it is not reported as a weakness.
  expect(
    rule("script-src 'unsafe-inline' 'nonce-DhcnhD3khTMePgXwdayK9BsMqXjhguVV'", 'script-unsafe-inline'),
  ).toBeUndefined();

  const object = rule("script-src 'self'", 'object-src');
  expect(object?.severity).toBe('medium');
  expect(object?.fix).toMatch(/object-src 'none'/);
  // default-src 'none' also settles object-src through the fallback, and an explicit 'none' does too.
  expect(rule("default-src 'none'", 'object-src')).toBeUndefined();
  expect(rule("script-src 'self'; object-src 'none'", 'object-src')).toBeUndefined();
  expect(rule("script-src 'self'; object-src https://o.example.invalid", 'object-src')?.directive).toBe('object-src');
});

it('the score subtracts the stated weights and a high finding caps the grade at D', () => {
  const clean = gradeCsp(CLEAN);
  expect(clean.findings).toEqual([]);
  expect(clean.score).toBe(100);
  expect(clean.grade).toBe('A');
  expect(clean.empty).toBe(false);
  expect(clean.source).toBe('policy');

  // One medium finding (object-src missing) takes 15 points.
  const medium = gradeCsp(CLEAN.replace("object-src 'none'; ", ''));
  expect(medium.findings.map((f) => f.rule)).toEqual(['object-src']);
  expect(medium.score).toBe(85);
  expect(medium.grade).toBe('B');

  // One high finding takes 30 points, which alone would give a C (70), but any high finding caps the grade at D.
  const high = gradeCsp(CLEAN.replace("script-src 'self'", "script-src 'unsafe-inline'"));
  expect(high.findings.map((f) => f.rule)).toEqual(['script-unsafe-inline']);
  expect(high.score).toBe(70);
  expect(high.grade).toBe('D');
});

// Values taken from CSP Level 3 itself: the nonce of section 8.2 and the hash of section 8.3 (the hash of doSubmit()).
const NONCE = 'DhcnhD3khTMePgXwdayK9BsMqXjhguVV';
const HASH = "'sha256-jzgBGA4UWFFmpOBq0JpdsySukE1FrEN5bUpoK8Z29fY='";
// The page's own default policy, one directive per line.
const PAGE_DEFAULT = "default-src 'self'\nobject-src 'none'\nbase-uri 'self'\nframe-ancestors 'none'";

function ruleIds(text: string): string[] {
  return gradeCsp(text).findings.map((f) => f.rule);
}

it('the page default policy grades A with the form-action and upgrade notes', () => {
  const result = gradeCsp(PAGE_DEFAULT);
  // default-src 'self' covers scripts and plugins; form-action has no fallback (low, 5 points) and upgrade-insecure-requests is info.
  expect(result.findings.map((f) => [f.rule, f.severity])).toEqual([
    ['form-action', 'low'],
    ['upgrade-insecure-requests', 'info'],
  ]);
  expect(result.score).toBe(95);
  expect(result.grade).toBe('A');
});

it('the CSP Level 3 section 8.5 strict policy grades B without object-src and A with it', () => {
  // Section 8.5, nonce-based Strict CSP: script-src 'strict-dynamic' 'nonce-{RANDOM}'; base-uri 'self'; (a real nonce for {RANDOM}).
  const strict = `script-src 'strict-dynamic' 'nonce-${NONCE}'; base-uri 'self';`;
  const without = gradeCsp(strict);
  expect(without.findings.map((f) => f.rule)).toEqual([
    'object-src',
    'frame-ancestors',
    'form-action',
    'upgrade-insecure-requests',
  ]);
  expect(without.score).toBe(75);
  expect(without.grade).toBe('B');
  const withObject = gradeCsp(`${strict} object-src 'none'`);
  expect(withObject.findings.map((f) => f.rule)).toEqual([
    'frame-ancestors',
    'form-action',
    'upgrade-insecure-requests',
  ]);
  expect(withObject.score).toBe(90);
  expect(withObject.grade).toBe('A');
  // Section 8.5, hash-based Strict CSP (the hash of section 8.3).
  const hashed = gradeCsp(`script-src 'strict-dynamic' ${HASH}; base-uri 'self'`);
  expect(hashed.score).toBe(75);
  expect(hashed.grade).toBe('B');
});

it('an unsafe policy and an img-src star policy grade F with their findings', () => {
  const unsafe = gradeCsp("script-src 'unsafe-inline' 'unsafe-eval' * data: http://cdn.example.invalid");
  expect(unsafe.grade).toBe('F');
  expect(unsafe.score).toBe(0);
  const rules = unsafe.findings.map((f) => f.rule);
  for (const id of [
    'script-unsafe-inline',
    'script-unsafe-eval',
    'script-wildcard',
    'script-data',
    'script-http-host',
    'script-host-allowlist',
  ]) {
    expect(rules).toContain(id);
  }
  expect(unsafe.findings.find((f) => f.rule === 'script-unsafe-eval')?.severity).toBe('medium');
  expect(unsafe.findings.find((f) => f.rule === 'script-wildcard')?.severity).toBe('high');

  // Only img-src is set: scripts are unrestricted, which is high, and the other controls are missing too.
  const img = gradeCsp('img-src *');
  expect(img.findings.map((f) => f.rule)).toContain('script-unrestricted');
  expect(img.grade).toBe('F');

  // CSP Level 3 section 8.6: default-src 'none' with img-src * lets data leave through image requests.
  const exfil = gradeCsp("default-src 'none'; img-src *");
  const found = exfil.findings.find((f) => f.rule === 'exfiltration-wildcard');
  expect(found?.severity).toBe('low');
  expect(found?.directive).toBe('img-src');
  expect(found?.basis).toMatch(/section 8\.6/);
  // The other rule that could read the list as open (default-open) stays quiet, because default-src itself is 'none'.
  expect(exfil.findings.map((f) => f.rule)).not.toContain('default-open');
});

it('short nonces, strict-dynamic without a nonce and the exfiltration wildcard are found', () => {
  // Section 7.1: the nonce SHOULD be at least 128 bits (16 bytes), which is 22 Base64 characters before any padding.
  const short = rule("script-src 'nonce-abc123'; object-src 'none'; base-uri 'none'", 'nonce-short');
  expect(short?.severity).toBe('medium');
  expect(short?.directive).toBe('script-src');
  const twentyOne = 'A'.repeat(21);
  const twentyTwo = 'A'.repeat(22);
  expect(rule(`script-src 'nonce-${twentyOne}'`, 'nonce-short')).toBeDefined();
  expect(rule(`script-src 'nonce-${twentyTwo}'`, 'nonce-short')).toBeUndefined();
  expect(rule(`script-src 'nonce-${twentyTwo}=='`, 'nonce-short')).toBeUndefined();
  expect(rule(`script-src 'nonce-${twentyOne}=='`, 'nonce-short')).toBeDefined();
  expect(rule(`style-src 'nonce-abc123'`, 'nonce-short')?.directive).toBe('style-src');
  // Section 8.2: with 'strict-dynamic' and no nonce or hash, host sources and 'self' are ignored, so no script can start.
  const strict = rule("script-src 'strict-dynamic'", 'strict-dynamic-no-nonce');
  expect(strict?.severity).toBe('medium');
  expect(rule(`script-src 'strict-dynamic' 'nonce-${NONCE}'`, 'strict-dynamic-no-nonce')).toBeUndefined();
  expect(rule(`script-src 'strict-dynamic' ${HASH}`, 'strict-dynamic-no-nonce')).toBeUndefined();
  // Only a wildcard in a directive other than script, while default-src is restrictive, is the exfiltration finding.
  expect(rule("default-src 'none'; connect-src *", 'exfiltration-wildcard')?.directive).toBe('connect-src');
  expect(rule("default-src 'none'; connect-src 'self'", 'exfiltration-wildcard')).toBeUndefined();
  expect(rule('default-src *; connect-src *', 'exfiltration-wildcard')).toBeUndefined();
  expect(rule('connect-src *', 'exfiltration-wildcard')).toBeUndefined();
});

it('with strict-dynamic, host, scheme and wildcard rules do not fire and the ignored sources are reported', () => {
  // Section 8.2: 'unsafe-inline' https: 'nonce-...' 'strict-dynamic' acts like 'unsafe-inline' https: in CSP1 browsers, like
  // https: 'nonce-...' in CSP2 browsers and like 'nonce-...' 'strict-dynamic' in CSP3 browsers. It is not marked down for https:.
  const compat = `script-src 'unsafe-inline' https: 'nonce-${NONCE}' 'strict-dynamic'`;
  const ids = ruleIds(compat);
  for (const quiet of [
    'script-scheme-only',
    'script-wildcard',
    'script-data',
    'script-http-host',
    'script-host-allowlist',
    'script-unsafe-inline',
    'strict-dynamic-no-nonce',
  ]) {
    expect(ids).not.toContain(quiet);
  }
  const ignored = rule(compat, 'host-sources-ignored');
  expect(ignored?.severity).toBe('info');
  expect(ignored?.directive).toBe('script-src');
  expect(ignored?.finding).toMatch(/https:/);
  expect(rule(compat, 'unsafe-inline-ignored')?.severity).toBe('info');
  // The two info findings cost nothing: the page's other missing controls (object-src, base-uri, frame-ancestors,
  // form-action) account for the whole score, 100 - 15 - 15 - 5 - 5.
  expect(gradeCsp(compat).score).toBe(60);

  // A wildcard, data:, an http host and 'self' beside 'strict-dynamic' are all ignored by the browser, so none is a weakness.
  const wide = `script-src 'strict-dynamic' 'nonce-${NONCE}' * data: http://cdn.example.invalid 'self'`;
  const wideIds = ruleIds(wide);
  expect(wideIds).toContain('host-sources-ignored');
  for (const quiet of [
    'script-wildcard',
    'script-data',
    'script-http-host',
    'script-host-allowlist',
    'script-scheme-only',
  ]) {
    expect(wideIds).not.toContain(quiet);
  }
  // The same sources without 'strict-dynamic' are weaknesses.
  const loose = ruleIds(`script-src 'nonce-${NONCE}' * data: http://cdn.example.invalid https:`);
  for (const loud of ['script-wildcard', 'script-data', 'script-http-host', 'script-scheme-only']) {
    expect(loose).toContain(loud);
  }
  expect(loose).not.toContain('host-sources-ignored');
});

it('base-uri, form-action and frame-ancestors never fall back and a repeated directive counts once', () => {
  // Section 6.4.2: frame-ancestors will not fall back to default-src; base-uri and form-action have no entry in the 6.8.3 list either.
  const onlyDefault = ruleIds("default-src 'none'");
  for (const id of ['base-uri', 'frame-ancestors', 'form-action']) {
    expect(onlyDefault).toContain(id);
  }
  const settled = ruleIds("default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  for (const id of ['base-uri', 'frame-ancestors', 'form-action']) {
    expect(settled).not.toContain(id);
  }
  // base-uri that allows any host or a whole scheme is the same finding.
  expect(rule("default-src 'none'; base-uri *", 'base-uri')?.directive).toBe('base-uri');
  expect(rule("default-src 'none'; base-uri https:", 'base-uri')).toBeDefined();
  expect(rule("default-src 'none'; base-uri 'self'", 'base-uri')).toBeUndefined();

  // The most specific directive alone decides: script-src-elem over script-src over default-src.
  expect(rule("script-src 'unsafe-inline'; script-src-elem 'self'", 'script-unsafe-inline')).toBeUndefined();
  expect(rule("script-src 'self'; script-src-elem 'unsafe-inline'", 'script-unsafe-inline')?.directive).toBe(
    'script-src-elem',
  );
  expect(rule("default-src 'unsafe-inline'", 'script-unsafe-inline')?.directive).toBe('default-src');
  expect(rule("default-src 'unsafe-inline'; script-src 'self'", 'script-unsafe-inline')).toBeUndefined();
  // A wildcard in default-src does not make script-src * when script-src is its own, but default-src itself is flagged open.
  expect(rule("default-src *; script-src 'self'", 'script-wildcard')).toBeUndefined();
  expect(rule("default-src *; script-src 'self'", 'default-open')?.severity).toBe('medium');
  // object-src falls back to default-src: 'none' there settles it, a more specific object-src overrides it.
  expect(rule("default-src 'none'; object-src https://o.example.invalid", 'object-src')?.directive).toBe('object-src');
  expect(rule("default-src 'self'", 'object-src')?.directive).toBe('default-src');

  // CSP Level 3 parsing: only the first occurrence of a repeated directive applies, and the repeat is a syntax finding.
  const first = gradeCsp("script-src 'self'; script-src 'unsafe-inline'; object-src 'none'");
  expect(first.findings.map((f) => f.rule)).not.toContain('script-unsafe-inline');
  const syntax = first.findings.filter((f) => f.rule === 'syntax');
  expect(syntax).toHaveLength(1);
  expect(syntax[0]?.finding).toMatch(/repeated/);
  expect(syntax[0]?.severity).toBe('low');
  const reversed = gradeCsp("script-src 'unsafe-inline'; script-src 'self'; object-src 'none'");
  expect(reversed.findings.map((f) => f.rule)).toContain('script-unsafe-inline');
});

it('header lines, Report-Only header lines and meta elements are graded as their policy with notes', () => {
  const policy = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
  const plain = gradeCsp(policy);
  expect(plain.source).toBe('policy');
  expect(plain.notes).toEqual([]);

  const header = gradeCsp(`Content-Security-Policy: ${policy}`);
  expect(header.source).toBe('header');
  expect(header.policy).toBe(policy);
  expect(normaliseForGrading(`Content-Security-Policy: ${policy}`)).toMatchObject({ policy, source: 'header' });
  expect(header.notes.join(' ')).toMatch(/Content-Security-Policy:/);
  expect(header.findings.map((f) => f.rule)).toEqual(plain.findings.map((f) => f.rule));
  expect(header.score).toBe(plain.score);
  // The header name is matched without regard to case, and a folded value on the next line is part of the policy.
  const lower = gradeCsp(`content-security-policy:\n  ${policy}`);
  expect(lower.source).toBe('header');
  expect(lower.findings.map((f) => f.rule)).toEqual(plain.findings.map((f) => f.rule));

  // Section 3.2: a Report-Only policy is monitored, not enforced.
  const reportOnly = gradeCsp(`Content-Security-Policy-Report-Only: ${policy}`);
  expect(reportOnly.source).toBe('report-only header');
  expect(reportOnly.policy).toBe(policy);
  const ro = reportOnly.findings.find((f) => f.rule === 'report-only');
  expect(ro?.severity).toBe('info');
  expect(ro?.basis).toMatch(/section 3\.2/);
  expect(reportOnly.score).toBe(plain.score);

  // Section 3.3: a meta element carries the policy in its content attribute; the report-uri, frame-ancestors and
  // sandbox directives are not supported there.
  const meta = gradeCsp(`<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  expect(meta.source).toBe('meta');
  expect(meta.policy).toBe(policy);
  const limits = meta.findings.find((f) => f.rule === 'meta-limits');
  expect(limits?.severity).toBe('info');
  expect(limits?.basis).toMatch(/section 3\.3/);
  expect(meta.notes.join(' ')).toMatch(/meta/);
  // Single quotes, upper case names, other attributes and other elements around it, and a content attribute written first.
  const messy = gradeCsp(
    `<head>\n<meta charset="utf-8">\n<META name=x CONTENT="${policy}" HTTP-EQUIV='content-security-policy' />\n</head>`,
  );
  expect(messy.source).toBe('meta');
  expect(messy.policy).toBe(policy);
  const quoted = gradeCsp(`<meta http-equiv='Content-Security-Policy' content='script-src "self"; object-src none'>`);
  expect(quoted.source).toBe('meta');
  expect(quoted.policy).toBe('script-src "self"; object-src none');
  // A meta element for something else, or an unfinished one, is just text: nothing is read from it.
  expect(gradeCsp('<meta http-equiv="refresh" content="script-src \'self\'">').source).toBe('policy');
  expect(gradeCsp('<meta http-equiv="Content-Security-Policy" content="script-src \'self\'').source).toBe('policy');
  // A header name that is not followed by a colon is not a header name.
  expect(gradeCsp("Content-Security-Policy-Report-Only script-src 'self'").source).toBe('policy');
});

it('an empty policy gives a plain note and no grade', () => {
  for (const text of [
    '',
    '   ',
    '\n\t \n',
    ';',
    ' ; ; ',
    'Content-Security-Policy:',
    'Content-Security-Policy-Report-Only:   ',
  ]) {
    const result = gradeCsp(text);
    expect(result.empty).toBe(true);
    expect(result.findings).toEqual([]);
  }
  expect(gradeCsp('<meta http-equiv="Content-Security-Policy" content="">').empty).toBe(true);
  expect(gradeCsp('<meta http-equiv="Content-Security-Policy" content="  ">').source).toBe('meta');
  // A policy with only unknown directives is something to grade, with its syntax findings.
  const unknown = gradeCsp('frobnicate x');
  expect(unknown.empty).toBe(false);
  expect(unknown.findings.map((f) => f.rule)).toContain('syntax');
});

it('directive order does not change the score and findings are ordered by severity then rule order', () => {
  const parts = [
    "script-src 'unsafe-inline' 'unsafe-eval' * data: http://cdn.example.invalid",
    "style-src 'unsafe-inline'",
    'img-src *',
    "default-src 'none'",
    'base-uri *',
    "frame-src 'nonce-abc'",
  ];
  const forward = gradeCsp(parts.join('; '));
  const backward = gradeCsp([...parts].reverse().join('; '));
  const rotated = gradeCsp([...parts.slice(2), ...parts.slice(0, 2)].join('\n'));
  expect(backward.score).toBe(forward.score);
  expect(backward.grade).toBe(forward.grade);
  expect(backward.findings).toEqual(forward.findings);
  expect(rotated.findings).toEqual(forward.findings);
  expect(gradeCsp(parts.join('; '))).toEqual(forward);

  const rank = new Map([
    ['high', 0],
    ['medium', 1],
    ['low', 2],
    ['info', 3],
  ]);
  const order = new Map(CSP_RULES.map((r, i) => [r.id, i]));
  for (let i = 1; i < forward.findings.length; i++) {
    const a = forward.findings[i - 1]!;
    const b = forward.findings[i]!;
    const bySeverity = (rank.get(a.severity) ?? 9) - (rank.get(b.severity) ?? 9);
    expect(bySeverity).toBeLessThanOrEqual(0);
    if (bySeverity === 0) expect(order.get(a.rule) ?? 99).toBeLessThanOrEqual(order.get(b.rule) ?? 99);
  }
  expect(forward.findings.length).toBeGreaterThan(8);
  // A rule that fires more than once costs its weight once: three unknown directives are still one low finding rule.
  const base = gradeCsp(CLEAN);
  const three = gradeCsp(`${CLEAN}; aa x; bb y; cc z`);
  expect(three.findings.filter((f) => f.rule === 'syntax')).toHaveLength(3);
  expect(three.score).toBe(base.score - 5);
});

it('policies over 65536 characters are refused for grading and a 65536 character policy is graded in time', () => {
  const refusal = (text: string): CspGradeError => {
    try {
      gradeCsp(text);
    } catch (err) {
      expect(err).toBeInstanceOf(CspGradeError);
      return err as CspGradeError;
    }
    throw new Error('expected a refusal');
  };
  expect(CSP_GRADE_MAX_CHARS).toBe(65536);
  expect(refusal('a'.repeat(65537)).message).toBe('This policy is 65,537 characters. The limit for grading is 65,536.');
  expect(refusal(`script-src ${'x'.repeat(2_000_000)}`).message).toBe(
    'This policy is 2,000,011 characters. The limit for grading is 65,536.',
  );
  // The header name and the meta wrapper count too: the limit is on what was pasted.
  expect(refusal(`Content-Security-Policy: ${'a'.repeat(65536)}`)).toBeInstanceOf(CspGradeError);

  const fill = (unit: string, head = '', tail = ''): string => {
    const body = unit.repeat(Math.ceil(CSP_GRADE_MAX_CHARS / unit.length));
    return (head + body).slice(0, CSP_GRADE_MAX_CHARS - tail.length) + tail;
  };
  const shapes: [string, string][] = [
    ['one long source list', fill(' https://a.example.invalid', 'script-src')],
    ['unknown directives', fill('x;')],
    ['repeated directives', fill("script-src 'self';")],
    ['nonces', fill(" 'nonce-AAAAAAAAAAAAAAAAAAAAAA'", 'script-src')],
    ['unfinished meta elements', fill('<meta ')],
    ['meta elements that are not for this', fill('<meta name=x content=y>')],
    [
      'a long meta content',
      fill(' https://a.example.invalid', '<meta http-equiv="Content-Security-Policy" content="script-src', '">'),
    ],
    ['a long dotted host', fill('a.', 'script-src ', '!')],
    ['a long run of hyphens', fill('-', 'script-src ', '!')],
    ['many unquoted attributes', fill(' a=b', '<meta ')],
    ['many quote marks', fill('"')],
    ['one header name over and over', fill('Content-Security-Policy: ')],
  ];
  for (const [name, text] of shapes) {
    expect(text.length, name).toBe(CSP_GRADE_MAX_CHARS);
    const started = performance.now();
    const result = gradeCsp(text);
    const elapsed = performance.now() - started;
    expect(elapsed, `${name} took ${elapsed} ms`).toBeLessThan(1000);
    expect(result.empty, name).toBe(false);
    // The syntax findings of a paste full of problems are capped, and the last one says how many are left out.
    expect(result.findings.filter((f) => f.rule === 'syntax').length, name).toBeLessThanOrEqual(21);
  }
}, 60_000);

it('every rule states its severity, finding, why, fix and basis', () => {
  const ids = [
    'script-unrestricted',
    'script-unsafe-inline',
    'unsafe-inline-ignored',
    'script-wildcard',
    'script-data',
    'script-scheme-only',
    'host-sources-ignored',
    'script-unsafe-eval',
    'script-http-host',
    'strict-dynamic-no-nonce',
    'script-host-allowlist',
    'nonce-short',
    'object-src',
    'base-uri',
    'frame-ancestors',
    'form-action',
    'default-open',
    'exfiltration-wildcard',
    'style-unsafe-inline',
    'unsafe-hashes',
    'report-only',
    'meta-ignored-directive',
    'meta-limits',
    'upgrade-insecure-requests',
    'syntax',
  ];
  // The research table listed 24 rules (its own text said 22); the table is followed, and the review of part B added the rules after it.
  expect(CSP_RULES.map((r) => r.id)).toEqual(ids);
  for (const r of CSP_RULES) {
    expect(['high', 'medium', 'low', 'info'], r.id).toContain(r.severity);
    for (const text of [r.finding, r.why, r.fix, r.basis]) expect(text.trim().length, r.id).toBeGreaterThan(10);
    // The basis names a section of CSP Level 3, or says that the rule is this page's own.
    expect(/^CSP Level 3 section [0-9]/.test(r.basis) || r.basis.startsWith("This page's own rule"), r.id).toBe(true);
    expect(r.finding + r.why + r.fix + r.basis, r.id).not.toMatch(/[–—]/);
  }
  // The two rules that are not CSP Level 3 say so.
  const own = CSP_RULES.filter((r) => r.basis.startsWith("This page's own rule")).map((r) => r.id);
  expect(own).toEqual(['script-http-host', 'upgrade-insecure-requests']);
  expect(CSP_SEVERITY_WEIGHTS.get('high')).toBe(30);
  expect(CSP_SEVERITY_WEIGHTS.get('medium')).toBe(15);
  expect(CSP_SEVERITY_WEIGHTS.get('low')).toBe(5);
  expect(CSP_SEVERITY_WEIGHTS.get('info')).toBe(0);
});

it('each of the 25 rules fires on a policy built for it', () => {
  const cases: [string, string, string][] = [
    ['script-unrestricted', 'high', "img-src 'self'"],
    ['script-unsafe-inline', 'high', "script-src 'unsafe-inline'"],
    ['unsafe-inline-ignored', 'info', `script-src 'unsafe-inline' 'nonce-${NONCE}'`],
    ['script-wildcard', 'high', 'script-src *'],
    ['script-data', 'high', 'script-src data:'],
    ['script-scheme-only', 'high', 'script-src https:'],
    ['host-sources-ignored', 'info', `script-src 'strict-dynamic' 'nonce-${NONCE}' https://cdn.example.invalid`],
    ['script-unsafe-eval', 'medium', "script-src 'self' 'unsafe-eval'"],
    ['script-http-host', 'medium', 'script-src http://cdn.example.invalid'],
    ['strict-dynamic-no-nonce', 'medium', "script-src 'strict-dynamic'"],
    ['script-host-allowlist', 'low', 'script-src https://cdn.example.invalid'],
    ['nonce-short', 'medium', "script-src 'nonce-abc123'"],
    ['object-src', 'medium', "script-src 'self'"],
    ['base-uri', 'medium', "script-src 'self'"],
    ['frame-ancestors', 'low', "script-src 'self'"],
    ['form-action', 'low', "script-src 'self'"],
    ['default-open', 'medium', 'default-src https:'],
    ['exfiltration-wildcard', 'low', "default-src 'none'; img-src *"],
    ['style-unsafe-inline', 'low', "default-src 'none'; style-src 'unsafe-inline'"],
    ['unsafe-hashes', 'low', `script-src 'unsafe-hashes' ${HASH}`],
    ['report-only', 'info', `Content-Security-Policy-Report-Only: ${CLEAN}`],
    ['meta-ignored-directive', 'medium', `<meta http-equiv="Content-Security-Policy" content="${CLEAN}">`],
    ['meta-limits', 'info', `<meta http-equiv="Content-Security-Policy" content="${CLEAN}">`],
    ['upgrade-insecure-requests', 'info', "script-src 'self'"],
    ['syntax', 'low', "script-src 'self'; frobnicate x"],
  ];
  expect(cases).toHaveLength(25);
  for (const [id, severity, text] of cases) {
    const found = rule(text, id);
    expect(found, id).toBeDefined();
    expect(found?.severity, id).toBe(severity);
    expect(found?.why, id).toBeTruthy();
    expect(found?.fix, id).toBeTruthy();
  }
  // style-src falls back to default-src; 'unsafe-inline' next to a nonce or a hash is not reported.
  expect(rule(`default-src 'none'; style-src 'unsafe-inline' 'nonce-${NONCE}'`, 'style-unsafe-inline')).toBeUndefined();
  expect(rule("default-src 'unsafe-inline'", 'style-unsafe-inline')?.directive).toBe('default-src');
  // default-open also covers a wildcard and http:, and a restrictive default-src is not open.
  expect(rule('default-src *', 'default-open')).toBeDefined();
  expect(rule('default-src http:', 'default-open')).toBeDefined();
  expect(rule("default-src 'self' https://cdn.example.invalid", 'default-open')).toBeUndefined();
});

it('prototype-named directives are unknown and do not change the grade', () => {
  const base = gradeCsp(CLEAN);
  const named = gradeCsp(
    `${CLEAN}; __proto__ 'none'; constructor 'none'; toString 'none'; hasOwnProperty x; valueOf y`,
  );
  // Each name is an unknown directive (a syntax finding), it neither adds nor takes away any other finding, and the letter is the same.
  expect(named.findings.every((f) => f.rule === 'syntax')).toBe(true);
  expect(named.findings).toHaveLength(5);
  expect(named.grade).toBe(base.grade);
  expect(named.score).toBe(base.score - 5);
  // A name from the object prototype is never read as a directive: nothing is inherited from it.
  const only = gradeCsp("__proto__ 'none'; constructor 'none'; toString 'none'");
  expect(only.findings.map((f) => f.rule)).toContain('script-unrestricted');
  expect(only.findings.map((f) => f.rule)).toContain('object-src');
  expect(only.grade).toBe('F');
  const dirs = parseCspDirectives("script-src 'self'").directives;
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(effectiveSources(dirs, name)).toBeNull();
  }
  // As a source value they are plain tokens and change nothing about the grade of the policy.
  expect(
    gradeCsp("script-src 'self' __proto__ constructor; object-src 'none'").findings.map((f) => f.rule),
  ).not.toContain('script-unsafe-inline');
});
