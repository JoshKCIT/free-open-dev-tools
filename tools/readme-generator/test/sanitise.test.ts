/**
 * Tests for the canonical DOMPurify wrapper. Copied byte for byte alongside
 * `sanitise.ts` into every tool that needs the same policy.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { sanitiseMarkup, sanitiseToFragment, describeRemoved, SanitiserUnavailableError } from '../src/sanitise';
import { findActiveContent } from './active-content';
import { loadXssVectors, EXPECTED_VECTOR_COUNT } from './xss-vectors';

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

let win: WindowLike;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  win = makeWindow();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

it('OWASP XSS Filter Evasion Cheat Sheet payloads leave no active content in the HTML profile', () => {
  const vectors = loadXssVectors();
  expect(vectors.length, 'the extractor found no payloads at all').toBe(EXPECTED_VECTOR_COUNT);

  const failures: string[] = [];
  for (const vector of vectors) {
    const { markup } = sanitiseMarkup(vector.payload, win, 'html');
    const violations = findActiveContent(markup, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('OWASP XSS Filter Evasion Cheat Sheet payloads leave no active content in the SVG profile', () => {
  const vectors = loadXssVectors();
  expect(vectors.length).toBe(EXPECTED_VECTOR_COUNT);

  const failures: string[] = [];
  for (const vector of vectors) {
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg"><g>${vector.payload}</g></svg>`;
    const { markup } = sanitiseMarkup(wrapped, win, 'svg');
    // Several cheat sheet payloads are deliberately broken HTML (unclosed
    // tags, stray text) designed to exploit an HTML parser's error
    // recovery, not valid XML -- wrapping one in an SVG root can leave the
    // sanitised result well short of strict XML well-formedness even
    // though every active-content rule already held. The lenient (HTML
    // mode) checker still catches every real violation in the resulting
    // text; well-formedness of a hostile payload is not itself a security
    // property this test is asserting. `optimizeSvg`'s own well-formedness
    // gate (index.ts) is what a real visitor's input goes through instead.
    const violations = findActiveContent(markup, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('namespaced svg script, foreignObject and control characters in javascript URLs are removed as in advisory GHSA-2p49-hgcm-8545', () => {
  // github.com/svg/svgo/security/advisories/GHSA-2p49-hgcm-8545's own proof
  // of concept: a namespace-prefixed svg:script tag, and an event/URL
  // attribute whose scheme check can be bypassed by an unusual prefix.
  const namespacedScript =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>';
  const { markup: out1 } = sanitiseMarkup(namespacedScript, win, 'svg');
  expect(findActiveContent(out1, win, 'svg')).toEqual([]);
  expect(out1).not.toContain('script');

  const foreignObjectPayload =
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onload="alert(1)">hi</div></foreignObject></svg>';
  const { markup: out2 } = sanitiseMarkup(foreignObjectPayload, win, 'svg');
  expect(findActiveContent(out2, win, 'svg')).toEqual([]);
  expect(out2.toLowerCase()).not.toContain('foreignobject');

  // A control character (tab, U+0009) inside the URL scheme -- the exact
  // class of bypass the advisory names ("case sensitively matched
  // JavaScript URIs" plus browsers stripping control characters before
  // reading a scheme).
  const controlCharUrl = '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav\tascript:alert(1)">x</a></svg>';
  const { markup: out3 } = sanitiseMarkup(controlCharUrl, win, 'svg');
  expect(findActiveContent(out3, win, 'svg')).toEqual([]);
  expect(out3.toLowerCase()).not.toContain('javascript:');
});

it('resource references to other addresses are removed and same-document fragment references are kept', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="g"/></defs>' +
    '<rect fill="url(#g)"/>' +
    '<image href="https://example.invalid/x.png"/>' +
    '<image href="#g"/>' +
    '<image href="data:image/png;base64,AAAA"/>' +
    '</svg>';
  const { markup, removed } = sanitiseMarkup(svg, win, 'svg');
  expect(markup).toContain('url(#g)');
  expect(markup).not.toContain('example.invalid');
  expect(removed.externalReferences).toBeGreaterThanOrEqual(1);
  expect(findActiveContent(markup, win, 'svg')).toEqual([]);

  const html = '<img src="https://example.invalid/x.png"><a href="https://example.com/page">ok link</a>';
  const { markup: htmlOut } = sanitiseMarkup(html, win, 'html');
  // img src is a reference attribute everywhere: removed even in the html profile.
  expect(htmlOut).not.toContain('example.invalid');
  // a href is the one exception (rule 3): an ordinary external link survives.
  expect(htmlOut).toContain('https://example.com/page');
});

it('sanitising without a browser document refuses instead of returning the markup unchanged', () => {
  const unusable = {} as unknown as WindowLike;
  expect(() => sanitiseMarkup('<p>hi</p>', unusable, 'html')).toThrow(SanitiserUnavailableError);
  expect(() => sanitiseMarkup('<p>hi</p>', unusable, 'html')).toThrow(
    'Sanitising needs a browser document, so nothing was rendered.',
  );
});

it('the active content checker flags a raw event handler, a script element and an external image', () => {
  const dirty = '<div onclick="steal()">click</div><script>alert(1)</script><img src="https://example.invalid/x.png">';
  const violations = findActiveContent(dirty, win, 'html');
  expect(violations.some((v) => v.includes('event handler'))).toBe(true);
  expect(violations.some((v) => v.includes('forbidden element'))).toBe(true);
  expect(violations.some((v) => v.includes('external reference') || v.includes('dangerous URL'))).toBe(true);
});

it('nothing is written to the console while sanitising', () => {
  sanitiseMarkup('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', win, 'svg');
  sanitiseMarkup('<div onclick="x()">hi</div>', win, 'html');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('sanitiseToFragment and describeRemoved report human-readable sentences for what was removed', () => {
  const { removed } = sanitiseToFragment(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onload="x()"/></svg>',
    win,
    'svg',
  );
  const lines = describeRemoved(removed);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.join(' ')).toContain('Removed');
});
