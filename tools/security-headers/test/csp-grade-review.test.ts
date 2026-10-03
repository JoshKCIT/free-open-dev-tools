import { it, expect } from 'vitest';
import { effectiveSources, gradeCsp } from '../src/csp-grade';
import { parseCspDirectives } from '../src/csp';
import { buildSecurityHeaders } from '../src/index';

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

// B-WR-03: the grade ignored the page's own "Upgrade insecure requests" and "Report only" boxes.
it('the Add upgrade-insecure-requests box counts as the directive being present', () => {
  const policy = "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  const without = gradeCsp(policy);
  expect(without.findings.map((f) => f.rule)).toEqual(['upgrade-insecure-requests']);
  const ticked = gradeCsp(policy, { upgradeInsecure: true });
  expect(ticked.findings).toEqual([]);
  expect(ticked.notes.join(' ')).toMatch(/upgrade-insecure-requests/);
  expect(ticked.score).toBe(100);
  // Not ticked, or ticked as false: the same as no options at all.
  expect(gradeCsp(policy, { upgradeInsecure: false })).toEqual(without);
  expect(gradeCsp(policy, {})).toEqual(without);
  // A policy that already has the directive gets no extra note.
  expect(gradeCsp(`${policy}; upgrade-insecure-requests`, { upgradeInsecure: true }).notes).toEqual([]);
});

it('the Report only box grades the policy as reported, not enforced', () => {
  const policy =
    "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
  expect(gradeCsp(policy).findings).toEqual([]);
  const ticked = gradeCsp(policy, { reportOnly: true });
  const found = ticked.findings.filter((f) => f.rule === 'report-only');
  expect(found).toHaveLength(1);
  expect(found[0]?.severity).toBe('info');
  expect(found[0]?.finding).toMatch(/Report only/);
  // A pasted Report-Only header and the box together are one finding, not two.
  const both = gradeCsp(`Content-Security-Policy-Report-Only: ${policy}`, { reportOnly: true });
  expect(both.findings.filter((f) => f.rule === 'report-only')).toHaveLength(1);
  expect(gradeCsp(policy, { reportOnly: false })).toEqual(gradeCsp(policy));
});

// B-WR-06: effectiveSources() returned null for script-src, style-src and child-src with only default-src (CSP Level 3
// section 6.8.3: each of them falls back to default-src).
it('script-src, style-src and child-src fall back to default-src in effectiveSources', () => {
  const onlyDefault = parseCspDirectives("default-src 'none'").directives;
  for (const name of ['script-src', 'style-src', 'child-src']) {
    expect(effectiveSources(onlyDefault, name), name).toEqual({ directive: 'default-src', sources: ["'none'"] });
  }
  // Their own directive wins when it is there, and without default-src there is nothing.
  const own = parseCspDirectives(
    "default-src 'none'; script-src 'self'; style-src 'self'; child-src 'self'",
  ).directives;
  for (const name of ['script-src', 'style-src', 'child-src']) {
    expect(effectiveSources(own, name), name).toEqual({ directive: name, sources: ["'self'"] });
    expect(effectiveSources([], name), name).toBeNull();
  }
  // The other names keep their old answers: worker-src still goes through child-src and script-src first.
  expect(effectiveSources(parseCspDirectives("default-src 'none'; child-src 'self'").directives, 'worker-src')).toEqual(
    {
      directive: 'child-src',
      sources: ["'self'"],
    },
  );
  expect(effectiveSources(onlyDefault, 'base-uri')).toBeNull();
});

// B-WR-07: inline event handlers and workers were not graded, so some open policies scored 100.
const STRICT_REST =
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

it('an open script-src-attr is a high finding, so the policy is no longer A 100', () => {
  const policy = `script-src 'self'; script-src-attr 'unsafe-inline'; ${STRICT_REST}`;
  const result = gradeCsp(policy);
  const found = result.findings.find((f) => f.rule === 'script-attr-unsafe-inline');
  expect(found?.severity).toBe('high');
  expect(found?.directive).toBe('script-src-attr');
  expect(found?.fix).toMatch(/addEventListener|nonce|hash/);
  expect(result.grade).toBe('D');
  expect(result.score).toBe(70);
  // With nothing but script-src, the policy reads exactly as before: one finding for 'unsafe-inline', not two.
  expect(ruleIds("script-src 'unsafe-inline'")).not.toContain('script-attr-unsafe-inline');
  expect(ruleIds(`default-src 'unsafe-inline'; ${STRICT_REST}`)).not.toContain('script-attr-unsafe-inline');
});

it('script-src-attr is read through its own fallback: script-src-attr, then script-src, then default-src', () => {
  // The review's example: script elements are restricted by script-src-elem, but handlers fall back to script-src.
  const viaScript = gradeCsp(`script-src 'unsafe-inline'; script-src-elem 'self'; ${STRICT_REST}`);
  const found = viaScript.findings.find((f) => f.rule === 'script-attr-unsafe-inline');
  expect(found?.directive).toBe('script-src');
  expect(viaScript.findings.map((f) => f.rule)).not.toContain('script-unsafe-inline');
  const viaDefault = gradeCsp(`default-src 'unsafe-inline'; script-src-elem 'self'; ${STRICT_REST}`);
  expect(viaDefault.findings.find((f) => f.rule === 'script-attr-unsafe-inline')?.directive).toBe('default-src');
  // A closed list of its own overrides an open script-src.
  expect(
    ruleIds(`script-src 'unsafe-inline'; script-src-attr 'none'; script-src-elem 'self'; ${STRICT_REST}`),
  ).not.toContain('script-attr-unsafe-inline');
  // A nonce, a hash or 'strict-dynamic' beside 'unsafe-inline' means browsers ignore it (section 6.7.3.2).
  expect(
    ruleIds(`script-src 'self'; script-src-attr 'unsafe-inline' 'nonce-DhcnhD3khTMePgXwdayK9BsMqXjhguVV'`),
  ).not.toContain('script-attr-unsafe-inline');
  expect(ruleIds("script-src 'self'; script-src-attr 'unsafe-inline' 'strict-dynamic'")).not.toContain(
    'script-attr-unsafe-inline',
  );
  // Only a script-src-attr in the policy, with no other script control: the handlers rule still fires.
  expect(ruleIds("script-src-attr 'unsafe-inline'")).toContain('script-attr-unsafe-inline');
});

it('worker-src * and child-src * are read like a script wildcard, and a worker list that falls back is not counted twice', () => {
  const worker = gradeCsp(`script-src 'self'; worker-src *; ${STRICT_REST}`);
  const found = worker.findings.find((f) => f.rule === 'script-wildcard');
  expect(found?.severity).toBe('high');
  expect(found?.directive).toBe('worker-src');
  expect(worker.grade).toBe('D');
  expect(worker.score).toBe(70);
  const child = gradeCsp(`script-src 'self'; child-src *; ${STRICT_REST}`);
  expect(child.findings.find((f) => f.rule === 'script-wildcard')?.directive).toBe('child-src');
  // A closed worker-src overrides an open child-src; the script list falling back is graded where it is written.
  expect(ruleIds(`script-src 'self'; child-src *; worker-src 'self'; ${STRICT_REST}`)).not.toContain('script-wildcard');
  expect(ruleIds(`script-src 'self'; worker-src 'self'; ${STRICT_REST}`)).not.toContain('script-wildcard');
  const open = gradeCsp(`script-src *; worker-src *; ${STRICT_REST}`).findings.filter(
    (f) => f.rule === 'script-wildcard',
  );
  expect(open.map((f) => f.directive)).toEqual(['script-src', 'worker-src']);
  // worker-src falling back to a script-src star is reported once, on script-src.
  expect(gradeCsp(`script-src *; ${STRICT_REST}`).findings.filter((f) => f.rule === 'script-wildcard')).toHaveLength(1);
});

it('the grade lists the directives of the policy that it does not grade', () => {
  expect(gradeCsp(`script-src 'self'; ${STRICT_REST}`).notGraded).toEqual([]);
  const result = gradeCsp(
    `script-src 'self'; ${STRICT_REST}; sandbox allow-scripts; trusted-types foo; require-trusted-types-for 'script'; report-to main; style-src-attr 'unsafe-inline'; worker-src 'self'`,
  );
  expect(result.notGraded).toEqual([
    'report-to',
    'require-trusted-types-for',
    'sandbox',
    'style-src-attr',
    'trusted-types',
    'worker-src (only a bare * is graded)',
  ]);
  // A bare * in worker-src is graded, so it is not listed.
  expect(gradeCsp(`script-src 'self'; worker-src *; ${STRICT_REST}`).notGraded).toEqual([]);
  expect(gradeCsp('').notGraded).toEqual([]);
});

// B-IN-03: a pasted page or server line was read too loosely.
const FULL_POLICY =
  "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

it('a meta element inside an HTML comment is not read as live', () => {
  const live = metaOf("script-src 'self'; object-src 'none'");
  const commented = `<!-- ${metaOf("default-src 'none'")} -->\n${live}`;
  expect(gradeCsp(commented).policy).toBe("script-src 'self'; object-src 'none'");
  // Only a commented-out element: nothing is read from it, and the paste is graded as it is.
  expect(gradeCsp(`<!-- ${live} -->`).source).toBe('policy');
  // An unfinished comment swallows the rest of the page, as in a browser; an empty comment does not.
  expect(gradeCsp(`<!-- ${live}`).source).toBe('policy');
  expect(gradeCsp(`<!-->${live}`).source).toBe('meta');
  expect(gradeCsp(`<!---->${live}`).source).toBe('meta');
  // A comment-like text inside an attribute value is not a comment.
  expect(gradeCsp(`<div title="<!--"></div>${live}`).source).toBe('meta');
});

it('character references in the content attribute of a meta element are decoded', () => {
  expect(gradeCsp(`<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;">`).policy).toBe(
    "default-src 'self'",
  );
  expect(gradeCsp(`<meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;">`).policy).toBe(
    "default-src 'self'",
  );
  expect(gradeCsp(`<meta http-equiv="Content-Security-Policy" content="default-src &#x27;self&#X27;">`).policy).toBe(
    "default-src 'self'",
  );
  expect(
    gradeCsp(`<meta http-equiv='Content-Security-Policy' content='default-src &quot;x&quot; &amp; &lt;&gt;'>`).policy,
  ).toBe('default-src "x" & <>');
  // What is not a character reference stays as written, and a reference past the code point range is left alone.
  expect(
    gradeCsp(`<meta http-equiv="Content-Security-Policy" content="a &b; &#0; &#x110000; & &amp c &#">`).policy,
  ).toBe('a &b; &#0; &#x110000; & &amp c &#');
  // The policy with its quotes written as references grades the same as the plain policy.
  const encoded = FULL_POLICY.replaceAll("'", '&#39;');
  expect(gradeCsp(metaOf(encoded)).findings.map((f) => f.rule)).toEqual(
    gradeCsp(metaOf(FULL_POLICY)).findings.map((f) => f.rule),
  );
  expect(gradeCsp(metaOf(encoded)).findings.filter((f) => f.rule === 'syntax')).toEqual([]);
});

it('a Report-Only meta element is read, and graded as a policy that is reported and not enforced', () => {
  const html = `<head><meta http-equiv="Content-Security-Policy-Report-Only" content="${FULL_POLICY}"></head>`;
  const result = gradeCsp(html);
  expect(result.source).toBe('meta');
  expect(result.policy).toBe(FULL_POLICY);
  const report = result.findings.filter((f) => f.rule === 'report-only');
  expect(report).toHaveLength(1);
  expect(report[0]?.finding).toMatch(/meta element/);
  expect(result.notes.join(' ')).toMatch(/Report-Only/);
  // Not mistaken for the plain name.
  expect(gradeCsp(metaOf(FULL_POLICY)).findings.map((f) => f.rule)).not.toContain('report-only');
});

it('an nginx add_header line and an Apache Header line are read as their policy', () => {
  const nginx = `add_header Content-Security-Policy "${FULL_POLICY}" always;`;
  const fromNginx = gradeCsp(nginx);
  expect(fromNginx.source).toBe('header');
  expect(fromNginx.policy).toBe(FULL_POLICY);
  expect(fromNginx.notes.join(' ')).toMatch(/nginx/);
  expect(fromNginx.score).toBe(100);
  const apache = `Header always set Content-Security-Policy "${FULL_POLICY}"`;
  const fromApache = gradeCsp(apache);
  expect(fromApache.source).toBe('header');
  expect(fromApache.policy).toBe(FULL_POLICY);
  expect(fromApache.notes.join(' ')).toMatch(/Apache/);
  // The Report-Only names, indentation, any letter case, and the other Apache words.
  const ro = gradeCsp(`  ADD_HEADER content-security-policy-report-only '${FULL_POLICY.replaceAll("'", "\\'")}';`);
  expect(ro.source).toBe('report-only header');
  expect(ro.policy).toBe(FULL_POLICY);
  expect(gradeCsp(`Header set Content-Security-Policy-Report-Only "${FULL_POLICY}"`).source).toBe('report-only header');
  expect(gradeCsp(`Header onsuccess append Content-Security-Policy "${FULL_POLICY}"`).policy).toBe(FULL_POLICY);
  // Other headers, unset and unfinished values are not a policy.
  expect(gradeCsp('add_header X-Frame-Options "DENY" always;').source).toBe('policy');
  expect(gradeCsp('Header always unset Content-Security-Policy').source).toBe('policy');
  expect(gradeCsp('add_header Content-Security-Policy "default-src').source).toBe('policy');
  expect(gradeCsp('add_header Content-Security-Policy-Extra "default-src \'self\'" always;').source).toBe('policy');
});

it('what the builder writes for nginx and Apache is read back as the policy it was built from', () => {
  const built = buildSecurityHeaders({
    csp: FULL_POLICY,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  });
  for (const [name, text] of [
    ['nginx', built.nginx],
    ['apache', built.apache],
  ] as const) {
    const result = gradeCsp(text);
    expect(result.source, name).toBe('header');
    expect(result.policy, name).toBe(FULL_POLICY);
    expect(result.score, name).toBe(100);
  }
  // A value with a double quote and a percent sign survives each server's own escaping.
  const odd = buildSecurityHeaders({ csp: "default-src 'self'; report-uri https://r.example.invalid/csp?a=100%25" });
  expect(gradeCsp(odd.apache).policy).toBe("default-src 'self'; report-uri https://r.example.invalid/csp?a=100%25");
  expect(gradeCsp(odd.nginx).policy).toBe("default-src 'self'; report-uri https://r.example.invalid/csp?a=100%25");
});

it('64 KiB pastes of comments, tags, character references and server lines are graded in time', () => {
  const size = 65536;
  const fill = (unit: string, head = '', tail = ''): string => {
    const body = unit.repeat(Math.ceil(size / unit.length));
    return (head + body).slice(0, size - tail.length) + tail;
  };
  const shapes: [string, string][] = [
    ['many comments', fill('<!--x-->')],
    ['many empty comments', fill('<!---->')],
    ['one unfinished comment', fill('a', '<!--')],
    ['many comment openings', fill('<!--')],
    ['many tags', fill('<a b="c">')],
    ['many tags with long names', fill('<abcdefghij ')],
    ['many character references', fill('&#39;', '<meta http-equiv="Content-Security-Policy" content="', '">')],
    ['many lone ampersands', fill('&', '<meta http-equiv="Content-Security-Policy" content="', '">')],
    [
      'many ampersands before far semicolons',
      fill('&aaaaaaaaaaaaaaaaaaaa', '<meta http-equiv="Content-Security-Policy" content="', ';">'),
    ],
    ['many nginx lines', fill('add_header X-A "b" always;\n')],
    ['many Apache lines', fill('Header always set X-A "b"\n')],
    ['one long nginx value', fill('a ', 'add_header Content-Security-Policy "', '" always;')],
    ['one long escaped nginx value', fill('\\"', 'add_header Content-Security-Policy "', '" always;')],
    ['one long Apache value with percent signs', fill('%%', 'Header set Content-Security-Policy "', '"')],
    ['many words on a header line', fill('add_header ')],
  ];
  for (const [name, text] of shapes) {
    expect(text.length, name).toBe(size);
    const started = performance.now();
    const result = gradeCsp(text);
    const elapsed = performance.now() - started;
    expect(elapsed, `${name} took ${elapsed} ms`).toBeLessThan(1000);
    expect(result.findings.filter((f) => f.rule === 'syntax').length, name).toBeLessThanOrEqual(21);
  }
}, 60_000);
