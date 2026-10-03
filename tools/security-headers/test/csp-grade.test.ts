import { it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { parseCspDirectives } from '../src/csp';
import { effectiveSources, gradeCsp } from '../src/csp-grade';

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
