import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generatePattern,
  colourOrDefault,
  CssPatternError,
  PATTERNS,
  patternSvg,
  svgPatternCss,
  svgPatternHtml,
  type GeneratePatternOptions,
} from '../src/index';
import { assertSafeTree, findUnsafeCss } from '../src/css-safe';

const FG = '#1d4ed8';
const BG = '#dbeafe';

/** Reads each rule of a stylesheet into selector, then property, then value. */
function ruleOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from ${css}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const declarations: Record<string, string> = {};
  // A semicolon inside a quoted address would end a declaration early, so lines are split at a semicolon at the end of a line.
  for (const line of body.split(';\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    declarations[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/;$/, '');
  }
  return declarations;
}

function gradientOf(options: Parameters<typeof generatePattern>[0]): Record<string, string> {
  const result = generatePattern({ output: 'gradient', foreground: FG, background: BG, ...options });
  expect(result.output).toBe('gradient');
  return ruleOf(result.css, '.pattern');
}

// Hostile field values the shared browser spec types into every text field (hosts are example.invalid).
const HOSTILE_FIELD_VALUES = [
  'url(https://example.invalid/x)', // a resource function
  'url(//example.invalid/x)', // a protocol-relative resource function
  'URL (https://example.invalid/x)', // a resource function with a space and capitals
  'image-set(url(https://example.invalid/x) 1x)', // an image set
  'cross-fade(url(https://example.invalid/x))', // a cross fade
  '@import url(https://example.invalid/x);', // an import rule
  '@font-face { src: url(https://example.invalid/x); }', // a font face rule
  'red; background: url(https://example.invalid/x)', // a second declaration
  'red } .evil { background: url(https://example.invalid/x)', // closing the rule early
  '</style><script>top.__fodtXss=1</script>', // closing the style element
  '/* */ red', // a comment
  'red !important', // an importance flag
  'expression(alert(1))', // an old script expression
  '-moz-binding:url(https://example.invalid/x.xml#exploit)', // an old binding
];

const PREVIEW_BOX = { width: '240px', height: '160px' };

it('each pattern writes repeating gradients with a background size from the size and thickness', () => {
  expect([...PATTERNS.keys()]).toEqual([
    'stripes-diagonal',
    'stripes-horizontal',
    'stripes-vertical',
    'checks',
    'dots',
    'grid',
    'zigzag',
    'cross',
  ]);

  // A 24 pixel repeat at 25 percent: lines of 6 pixels, a diagonal line of 12.5 percent of the 50 percent repeat,
  // dots of radius 6 and zigzag triangles offset by half the size, all worked out by hand.
  const lineH = `repeating-linear-gradient(180deg, ${FG} 0px, ${FG} 6px, transparent 6px, transparent 24px)`;
  const lineV = `repeating-linear-gradient(90deg, ${FG} 0px, ${FG} 6px, transparent 6px, transparent 24px)`;
  const lineBottom = `repeating-linear-gradient(0deg, ${FG} 0px, ${FG} 6px, transparent 6px, transparent 24px)`;
  const diagonal = (angle: number) =>
    `repeating-linear-gradient(${angle}deg, ${FG} 0%, ${FG} 12.5%, transparent 12.5%, transparent 50%)`;
  const expected: Record<string, Record<string, string>> = {
    'stripes-diagonal': { 'background-image': diagonal(45) },
    'stripes-horizontal': { 'background-image': lineH },
    'stripes-vertical': { 'background-image': lineV },
    checks: {
      'background-image': `repeating-conic-gradient(${FG} 0%, ${FG} 25%, transparent 25%, transparent 50%)`,
    },
    dots: { 'background-image': `radial-gradient(circle at 50% 50%, ${FG} 0px, ${FG} 6px, transparent 6px)` },
    grid: { 'background-image': `${lineV}, ${lineBottom}` },
    zigzag: {
      'background-image': [135, 225, 315, 45]
        .map((angle) => `linear-gradient(${angle}deg, ${FG} 25%, transparent 25%)`)
        .join(', '),
      'background-position': '-12px 0, -12px 0, 0 0, 0 0',
    },
    cross: { 'background-image': `${diagonal(45)}, ${diagonal(135)}` },
  };
  for (const [pattern, extra] of Object.entries(expected)) {
    expect(gradientOf({ pattern, size: 24, thickness: 25 }), pattern).toEqual({
      ...PREVIEW_BOX,
      'background-color': BG,
      'background-size': '24px 24px',
      ...extra,
    });
  }

  // Another size and thickness: 40 pixels at 10 percent gives lines of 4 pixels, 5 percent diagonal lines and
  // zigzag triangles offset by 20 pixels.
  const lines = gradientOf({ pattern: 'stripes-horizontal', size: 40, thickness: 10 });
  expect(lines['background-image']).toBe(
    `repeating-linear-gradient(180deg, ${FG} 0px, ${FG} 4px, transparent 4px, transparent 40px)`,
  );
  expect(lines['background-size']).toBe('40px 40px');
  expect(gradientOf({ pattern: 'stripes-diagonal', size: 40, thickness: 10 })['background-image']).toContain(
    `${FG} 5%, transparent 5%`,
  );
  expect(gradientOf({ pattern: 'dots', size: 40, thickness: 10 })['background-image']).toBe(
    `radial-gradient(circle at 50% 50%, ${FG} 0px, ${FG} 4px, transparent 4px)`,
  );
  expect(gradientOf({ pattern: 'zigzag', size: 40 })['background-position']).toBe('-20px 0, -20px 0, 0 0, 0 0');

  // Checks and zigzag have no line thickness: the field does not change them and is not warned about.
  for (const pattern of ['checks', 'zigzag']) {
    const thin = generatePattern({ pattern, thickness: 1 });
    const thick = generatePattern({ pattern, thickness: 50 });
    expect(thin.css, pattern).toBe(thick.css);
    expect(generatePattern({ pattern, thickness: 9999 }).warnings, pattern).toEqual([]);
  }
  // The others do read it, and clamp it with a warning.
  const clamped = generatePattern({ pattern: 'grid', thickness: 9999, size: 3 });
  expect(clamped.warnings).toHaveLength(2);
  expect(clamped.warnings.find((w) => w.startsWith('Size'))).toMatch(/minimum of 4/);
  expect(clamped.warnings.find((w) => w.startsWith('Thickness'))).toMatch(/maximum of 50/);
  expect(generatePattern({ pattern: 'grid', size: 999 }).warnings[0]).toMatch(/^Size .*maximum of 200/);
  expect(generatePattern({ pattern: 'grid', thickness: 0 }).warnings[0]).toMatch(/^Thickness .*minimum of 1/);
  expect(generatePattern({ pattern: 'grid', size: Number.NaN, thickness: Infinity }).warnings).toHaveLength(2);

  // The preview box is a tree of one element, and the markup names the one class.
  const result = generatePattern({ pattern: 'dots' });
  expect(result.output).toBe('gradient');
  if (result.output === 'gradient') {
    expect(result.tree).toEqual({ className: 'pattern' });
    expect(() => assertSafeTree(result.tree)).not.toThrow();
  }
  expect(result.markup).toBe('<div class="pattern"></div>');
  for (const pattern of PATTERNS.keys()) {
    for (const size of [4, 5, 24, 199, 200]) {
      for (const thickness of [1, 2, 25, 49, 50]) {
        const css = generatePattern({ pattern, size, thickness, foreground: '#0f08' }).css;
        expect(findUnsafeCss(css), `${pattern} ${size} ${thickness}`).toBeNull();
        expect(css).not.toContain('url(');
      }
    }
  }
});

/** The tile of each pattern at 24 pixels and 25 percent, worked out by hand: lines of 6, half the size 12. */
const TILE_SHAPES: Record<string, string> = {
  'stripes-diagonal': `<polygon points="0,0 6,0 24,18 24,24" fill="${FG}"/><polygon points="0,18 0,24 6,24" fill="${FG}"/>`,
  'stripes-horizontal': `<rect width="24" height="6" fill="${FG}"/>`,
  'stripes-vertical': `<rect width="6" height="24" fill="${FG}"/>`,
  checks: `<rect x="12" width="12" height="12" fill="${FG}"/><rect y="12" width="12" height="12" fill="${FG}"/>`,
  dots: `<circle cx="12" cy="12" r="6" fill="${FG}"/>`,
  grid: `<rect width="6" height="24" fill="${FG}"/><rect y="18" width="24" height="6" fill="${FG}"/>`,
  zigzag: `<polygon points="0,0 24,0 12,12" fill="${FG}"/><polygon points="0,12 0,24 12,24" fill="${FG}"/><polygon points="24,12 24,24 12,24" fill="${FG}"/>`,
  cross: `<polygon points="0,0 6,0 24,18 24,24" fill="${FG}"/><polygon points="0,18 0,24 6,24" fill="${FG}"/><polygon points="0,0 6,0 0,6" fill="${FG}"/><polygon points="0,24 24,0 24,6 6,24" fill="${FG}"/>`,
};

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">';
const SVG_BACK = `<rect width="24" height="24" fill="${BG}"/>`;

it('the inline SVG form builds its tile from fixed templates and numbers and percent-encodes it', () => {
  // The exact tile of every pattern.
  for (const [pattern, shapes] of Object.entries(TILE_SHAPES)) {
    expect(patternSvg(pattern, 24, 25, FG, BG), pattern).toBe(`${SVG_OPEN}${SVG_BACK}${shapes}</svg>`);
  }

  // Only the fixed element names and attribute names, with plain numbers, points or colours for values.
  const elements = new Set(['svg', 'rect', 'circle', 'polygon']);
  const attributes = new Set(['xmlns', 'width', 'height', 'viewBox', 'x', 'y', 'cx', 'cy', 'r', 'points', 'fill']);
  for (const pattern of PATTERNS.keys()) {
    for (const [size, thickness] of [
      [4, 1],
      [24, 25],
      [37, 33],
      [200, 50],
    ] as const) {
      const svg = patternSvg(pattern, size, thickness, '#0f08', '#12345678');
      for (const tag of svg.matchAll(/<(\/?)([A-Za-z]+)([^>]*)>/g)) {
        expect(elements.has(tag[2]!), `${pattern} element ${tag[2]}`).toBe(true);
        for (const attribute of tag[3]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) {
          const [, name, value] = attribute;
          expect(attributes.has(name!), `${pattern} attribute ${name}`).toBe(true);
          if (name === 'xmlns') expect(value).toBe('http://www.w3.org/2000/svg');
          else if (name === 'fill') expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
          else if (name === 'viewBox') expect(value).toMatch(/^0 0 [0-9.]+ [0-9.]+$/);
          else if (name === 'points') expect(value).toMatch(/^[0-9.,\- ]+$/);
          else expect(value, `${pattern} ${name}`).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
        }
      }
      expect(svg.startsWith('<svg '), pattern).toBe(true);
      expect(svg.endsWith('</svg>'), pattern).toBe(true);
    }
  }

  // The CSS holds the tile percent-encoded: nothing outside letters, digits and . _ ~ : / = - and space is left bare.
  const tile = patternSvg('stripes-horizontal', 24, 25, FG, BG);
  const css = svgPatternCss(tile, BG, 24);
  const encoded =
    '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22%3E' +
    `%3Crect width=%2224%22 height=%2224%22 fill=%22%23${BG.slice(1)}%22/%3E` +
    `%3Crect width=%2224%22 height=%226%22 fill=%22%23${FG.slice(1)}%22/%3E%3C/svg%3E`;
  expect(css).toBe(
    `.pattern {\n  width: 240px;\n  height: 160px;\n  background-color: ${BG};\n  background-image: url("data:image/svg+xml,${encoded}");\n  background-size: 24px 24px;\n}`,
  );
  for (const pattern of PATTERNS.keys()) {
    const text = svgPatternCss(patternSvg(pattern, 24, 25, '#0f08', BG), BG, 24);
    const prefix = 'background-image: url("data:image/svg+xml,';
    const start = text.indexOf(prefix) + prefix.length;
    const payload = text.slice(start, text.indexOf('");', start));
    expect(payload, pattern).toMatch(/^[A-Za-z0-9 ._~:/=%-]+$/);
    expect(decodeURIComponent(payload), pattern).toBe(patternSvg(pattern, 24, 25, '#0f08', BG));
    // Between the quotes there is no bare quote, angle bracket, hash, comma, semicolon or backslash.
    for (const bare of ['"', '<', '>', '#', ',', ';', '\\', "'", '`', '(', ')', '&', '*', '!']) {
      expect(payload.includes(bare), `${pattern} holds a bare ${bare}`).toBe(false);
    }
  }

  // The writer refuses what is not a tile of its own making and a colour that is not hexadecimal.
  expect(() => patternSvg('nope', 24, 25, FG, BG)).toThrow(CssPatternError);
  expect(() => patternSvg('dots', Number.NaN, 25, FG, BG)).toThrow(CssPatternError);
  expect(() => patternSvg('dots', 24, Infinity, FG, BG)).toThrow(CssPatternError);
  expect(() => patternSvg('dots', 24, 25, 'red', BG)).toThrow(CssPatternError);
  expect(() => patternSvg('dots', 24, 25, FG, 'url(x)')).toThrow(CssPatternError);
  expect(() => svgPatternCss('<svg onload="x()"></svg>', BG, 24)).toThrow(CssPatternError);
  expect(() => svgPatternCss(tile, 'red', 24)).toThrow(CssPatternError);
  expect(() => svgPatternCss(tile, BG, Number.NaN)).toThrow(CssPatternError);
});

it('the same CSS string goes to the frame and to the code block', () => {
  for (const pattern of PATTERNS.keys()) {
    const result = generatePattern({ pattern, output: 'svg', size: 24, thickness: 25, foreground: FG, background: BG });
    expect(result.output).toBe('svg');
    if (result.output !== 'svg') continue;
    // The frame's page is a style element holding exactly the CSS, then the one element the CSS styles.
    expect(result.html, pattern).toBe(`<style>${result.css}</style><div class="pattern"></div>`);
    expect(result.html, pattern).toBe(svgPatternHtml(result.css));
    const inner = result.html.slice('<style>'.length, result.html.indexOf('</style>'));
    expect(inner, pattern).toBe(result.css);
    // The CSS is the one written from the tile of this pattern.
    expect(result.css, pattern).toBe(svgPatternCss(patternSvg(pattern, 24, 25, FG, BG), BG, 24));
    expect(result.markup, pattern).toBe('<div class="pattern"></div>');
    expect(result.warnings).toEqual([]);
  }
  // Text that could end the style element early is refused, whatever its source.
  expect(() => svgPatternHtml('</style><script>top.x=1</script>')).toThrow(CssPatternError);
  expect(() => svgPatternHtml('.pattern { width: 1px; } <b>')).toThrow(CssPatternError);
  expect(svgPatternHtml('.pattern {\n  width: 1px;\n}')).toBe(
    '<style>.pattern {\n  width: 1px;\n}</style><div class="pattern"></div>',
  );
});

it('hostile field values leave no trace in either CSS form', () => {
  const marker = 'FODT-PATTERN-MARKER';
  for (const hostile of [...HOSTILE_FIELD_VALUES, `#${marker}`, marker]) {
    for (const output of ['gradient', 'svg']) {
      for (const field of ['foreground', 'background'] as const) {
        let thrown: unknown;
        const options: GeneratePatternOptions = { output };
        options[field] = hostile;
        try {
          generatePattern(options);
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `${output} ${field} ${hostile}`).toBeInstanceOf(CssPatternError);
        const message = (thrown as Error).message;
        expect(message).not.toContain(hostile);
        expect(message).not.toContain(marker);
        expect(message).not.toContain('example.invalid');
        expect(message.toLowerCase()).toContain(field);
      }
      // A name field holding the text is refused too.
      expect(() => generatePattern({ output, pattern: hostile }), `pattern ${hostile}`).toThrow(CssPatternError);
      expect(() => generatePattern({ output: hostile }), `output ${hostile}`).toThrow(CssPatternError);
    }
  }

  // Numbers that are not usable, or far out of range, give clamped, safe CSS in both forms.
  for (const value of [Number.NaN, Infinity, -Infinity, 1e21, -1e21, -400, 0]) {
    for (const pattern of PATTERNS.keys()) {
      const gradient = generatePattern({ pattern, output: 'gradient', size: value, thickness: value });
      expect(findUnsafeCss(gradient.css), `${pattern} ${value}`).toBeNull();
      const svg = generatePattern({ pattern, output: 'svg', size: value, thickness: value });
      for (const css of [gradient.css, svg.css]) {
        expect(css).not.toContain('example.invalid');
        for (const bad of ['\\', '/*', '<', '!', "'", '`', '@'])
          expect(css.includes(bad), `${pattern} ${bad}`).toBe(false);
      }
      expect(gradient.css).not.toContain('url(');
      expect(svg.css.split('url(').length - 1).toBe(1);
      expect(svg.css).not.toContain('NaN');
      expect(svg.css).not.toContain('Infinity');
    }
  }

  // For a page whose colour box takes any text, a bad value falls back to the default with a warning that does not repeat it.
  expect(colourOrDefault('#12ab9f', '#000000', 'Foreground')).toEqual({ colour: '#12ab9f', warning: null });
  for (const hostile of HOSTILE_FIELD_VALUES) {
    const fallback = colourOrDefault(hostile, FG, 'Foreground');
    expect(fallback.colour).toBe(FG);
    expect(fallback.warning).toMatch(/^Foreground was not a valid hexadecimal colour/);
    expect(fallback.warning).not.toContain(hostile);
  }
});

it('pattern names are looked up safely for __proto__, constructor and toString', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'nope', '']) {
    expect(() => generatePattern({ pattern: bad }), `pattern ${bad}`).toThrow(CssPatternError);
    expect(() => generatePattern({ output: bad }), `output ${bad}`).toThrow(CssPatternError);
    expect(() => patternSvg(bad, 24, 25, FG, BG), `tile ${bad}`).toThrow(CssPatternError);
  }
  // Left out, every field has a default.
  const plain = generatePattern({});
  expect(plain.output).toBe('gradient');
  expect(plain.css).toContain('repeating-linear-gradient(45deg');
  expect(plain.warnings).toEqual([]);
  expect(generatePattern({ output: 'svg' }).output).toBe('svg');
});

it('css-safe.ts is the canonical copy', () => {
  const bytes = readFileSync(new URL('../src/css-safe.ts', import.meta.url));
  expect(createHash('md5').update(bytes).digest('hex')).toBe('ad0bffed52987b6b331c6d39227b080f');
});

it('nothing is written to the console while generating patterns', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
  try {
    for (const pattern of PATTERNS.keys()) {
      for (const output of ['gradient', 'svg']) {
        generatePattern({ pattern, output, size: -1, thickness: 99 });
        expect(() => generatePattern({ pattern, output, foreground: 'bad' })).toThrow(CssPatternError);
      }
    }
    expect(() => generatePattern({ pattern: 'nope' })).toThrow(CssPatternError);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
