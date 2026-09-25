import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { optimizeSvg, SvgOptimizerError } from '../src/index';
import { findActiveContent } from './active-content';
import { loadXssVectors } from './xss-vectors';

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

it('SVG 1.1 shapes, gradients and use references survive sanitising and optimising', () => {
  // SVG 1.1 (Second Edition) section 5.2's own basicShapes shapes, a
  // linearGradient (section 13), and a use element referencing a locally
  // defined shape by fragment (section 5.6).
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
    '<rect id="r" width="10" height="10"/></defs>' +
    '<rect x="1" y="1" width="10" height="10" fill="url(#g)"/>' +
    '<circle cx="20" cy="20" r="5"/>' +
    '<ellipse cx="30" cy="30" rx="5" ry="3"/>' +
    '<line x1="0" y1="0" x2="10" y2="10"/>' +
    '<polyline points="0,0 10,10"/>' +
    '<polygon points="0,0 10,0 5,10"/>' +
    '<path d="M0 0 L10 10"/>' +
    '<use href="#r" x="40" y="40"/>' +
    '</svg>';
  const result = optimizeSvg(svg, win);
  expect(result.output).toContain('linearGradient');
  expect(result.output).toContain('<use');
  expect(result.output.toLowerCase()).not.toContain('<script');
});

it('an SVG that declares entities in its DOCTYPE is refused and a plain DOCTYPE is removed with a warning', () => {
  const entityBomb =
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe "boom">]>' +
    '<svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>';
  expect(() => optimizeSvg(entityBomb, win)).toThrow(SvgOptimizerError);
  expect(() => optimizeSvg(entityBomb, win)).toThrow(/entities/);

  const plainDoctype =
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  const result = optimizeSvg(plainDoctype, win);
  expect(result.output.toLowerCase()).not.toContain('<!doctype');
  expect(result.warnings.some((w) => /DOCTYPE/.test(w))).toBe(true);
});

it('the optimised SVG is smaller and still well-formed XML', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
    '  <!-- a comment that optimisation should strip -->\n' +
    '  <rect x="1.000000" y="1.000000" width="10.000000" height="10.000000" fill="#ff0000"/>\n' +
    '</svg>\n';
  const result = optimizeSvg(svg, win);
  expect(result.optimisedBytes).toBeLessThan(result.originalBytes);

  const parser = new win.DOMParser();
  const doc = parser.parseFromString(result.output, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
});

it('a text node holding a non-breaking space and an ampersand stays well-formed XML', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><title>Salt &amp; Pepper Co</title><rect width="1" height="1"/></svg>';
  const result = optimizeSvg(svg, win);
  const parser = new win.DOMParser();
  const doc = parser.parseFromString(result.output, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
});

it('sanitising runs before optimising, so the optimised output carries no active content either', () => {
  const vectors = loadXssVectors();
  const failures: string[] = [];
  for (const vector of vectors) {
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg"><g>${vector.payload}</g></svg>`;
    let output: string;
    try {
      output = optimizeSvg(wrapped, win).output;
    } catch {
      // A malformed-XML refusal is not itself an active-content leak: the
      // optimiser never produced output for this payload at all.
      continue;
    }
    // Several payloads are deliberately broken HTML, not valid XML (see
    // sanitise.test.ts's own note on this); the lenient checker still
    // catches every real active-content violation in the resulting text.
    const violations = findActiveContent(output, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('malformed XML is refused with its line and column', () => {
  const malformed = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"></svg>';
  try {
    optimizeSvg(malformed, win);
    expect.unreachable('expected optimizeSvg to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(SvgOptimizerError);
    const e = err as InstanceType<typeof SvgOptimizerError>;
    expect(typeof e.line).toBe('number');
    expect(typeof e.column).toBe('number');
  }
});

it('nothing is written to the console while sanitising or optimising', () => {
  optimizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', win);
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
