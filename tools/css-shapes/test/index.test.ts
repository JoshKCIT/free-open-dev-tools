import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateShape,
  CssShapesError,
  SHAPES,
  TRIANGLE_DIRECTIONS,
  colourOrDefault,
  TAIL_SIDES,
  type GenerateShapeOptions,
} from '../src/index';
import { assertSafeTree, findUnsafeCss, type PreviewTreeNode } from '../src/css-safe';

const BLUE = '#1d4ed8';
const PALE = '#dbeafe';

/** Reads each rule of a stylesheet into selector, then property, then value. */
function rules(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const block of css.split('}')) {
    const open = block.indexOf('{');
    if (open < 0) continue;
    const selector = block.slice(0, open).trim();
    const declarations = new Map<string, string>();
    for (const line of block.slice(open + 1).split(';')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      declarations.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    out.set(selector, declarations);
  }
  return out;
}

function ruleOf(css: string, selector: string): Record<string, string> {
  const found = rules(css).get(selector);
  expect(found, `${selector} is missing from ${css}`).toBeDefined();
  return Object.fromEntries(found!);
}

function classesIn(css: string): string[] {
  return [...css.matchAll(/^\.([a-z][a-z0-9-]*) \{/gm)].map((m) => m[1]!);
}

function walk(node: PreviewTreeNode, into: PreviewTreeNode[] = []): PreviewTreeNode[] {
  into.push(node);
  for (const child of node.children ?? []) walk(child, into);
  return into;
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

const TRIANGLE_BORDERS: Record<string, Record<string, string>> = {
  // A 100 by 60 triangle in blue: every direction by its border sides, worked out from the way two borders meet.
  up: {
    'border-right': '50px solid transparent',
    'border-bottom': `60px solid ${BLUE}`,
    'border-left': '50px solid transparent',
  },
  down: {
    'border-top': `60px solid ${BLUE}`,
    'border-right': '50px solid transparent',
    'border-left': '50px solid transparent',
  },
  left: {
    'border-top': '30px solid transparent',
    'border-right': `100px solid ${BLUE}`,
    'border-bottom': '30px solid transparent',
  },
  right: {
    'border-top': '30px solid transparent',
    'border-bottom': '30px solid transparent',
    'border-left': `100px solid ${BLUE}`,
  },
  'up-left': { 'border-top': `60px solid ${BLUE}`, 'border-right': '100px solid transparent' },
  'up-right': { 'border-top': `60px solid ${BLUE}`, 'border-left': '100px solid transparent' },
  'down-left': { 'border-right': '100px solid transparent', 'border-bottom': `60px solid ${BLUE}` },
  'down-right': { 'border-bottom': `60px solid ${BLUE}`, 'border-left': '100px solid transparent' },
};

const TRIANGLE_POLYGONS: Record<string, string> = {
  up: 'polygon(50% 0, 100% 100%, 0 100%)',
  down: 'polygon(0 0, 100% 0, 50% 100%)',
  left: 'polygon(100% 0, 100% 100%, 0 50%)',
  right: 'polygon(0 0, 100% 50%, 0 100%)',
  'up-left': 'polygon(0 0, 100% 0, 0 100%)',
  'up-right': 'polygon(0 0, 100% 0, 100% 100%)',
  'down-left': 'polygon(0 0, 100% 100%, 0 100%)',
  'down-right': 'polygon(100% 0, 100% 100%, 0 100%)',
};

it('triangles in eight directions by borders and by clip-path write the documented border sides and polygon points', () => {
  expect([...TRIANGLE_DIRECTIONS.keys()]).toEqual([
    'up',
    'down',
    'left',
    'right',
    'up-left',
    'up-right',
    'down-left',
    'down-right',
  ]);

  // The plain case: a 100 pixel up triangle by borders.
  const plain = generateShape({
    shape: 'triangle',
    direction: 'up',
    method: 'border',
    width: 100,
    height: 100,
    colour: BLUE,
  });
  expect(ruleOf(plain.css, '.triangle')).toEqual({
    width: '0',
    height: '0',
    'border-right': '50px solid transparent',
    'border-bottom': `100px solid ${BLUE}`,
    'border-left': '50px solid transparent',
  });
  expect(plain.markup).toBe('<div class="triangle"></div>');
  expect(plain.tree).toEqual({ className: 'triangle' });

  for (const [direction, borders] of Object.entries(TRIANGLE_BORDERS)) {
    const byBorder = generateShape({
      shape: 'triangle',
      direction,
      method: 'border',
      width: 100,
      height: 60,
      colour: BLUE,
    });
    expect(ruleOf(byBorder.css, '.triangle'), `border ${direction}`).toEqual({ width: '0', height: '0', ...borders });
  }

  // The same triangle by clip-path: a coloured box cut to a polygon.
  const clipped = generateShape({
    shape: 'triangle',
    direction: 'up',
    method: 'clip-path',
    width: 100,
    height: 100,
    colour: BLUE,
  });
  expect(clipped.css).toContain('clip-path: polygon(50% 0, 100% 100%, 0 100%);');
  for (const [direction, polygon] of Object.entries(TRIANGLE_POLYGONS)) {
    const byClip = generateShape({
      shape: 'triangle',
      direction,
      method: 'clip-path',
      width: 100,
      height: 60,
      colour: BLUE,
    });
    expect(ruleOf(byClip.css, '.triangle'), `clip-path ${direction}`).toEqual({
      width: '100px',
      height: '60px',
      'background-color': BLUE,
      'clip-path': polygon,
    });
  }

  // Half widths that are not whole numbers are written exactly.
  const odd = generateShape({
    shape: 'triangle',
    direction: 'up',
    method: 'border',
    width: 101,
    height: 40,
    colour: BLUE,
  });
  expect(ruleOf(odd.css, '.triangle')['border-left']).toBe('50.5px solid transparent');
});

it('ribbons, speech bubbles and tooltip arrows use child elements for their tails and ends', () => {
  expect([...SHAPES.keys()]).toEqual(['triangle', 'ribbon', 'bubble', 'tooltip']);
  expect(TAIL_SIDES.get('bubble')).toEqual(['bottom-left', 'bottom-right', 'left', 'right']);
  expect(TAIL_SIDES.get('tooltip')).toEqual(['top', 'bottom', 'left', 'right']);

  // A ribbon: a container, a notched piece at each end and a body that holds the text.
  const ribbon = generateShape({
    shape: 'ribbon',
    width: 160,
    height: 80,
    colour: '#ffffff',
    background: BLUE,
    text: 'New',
  });
  expect(ribbon.tree).toEqual({
    className: 'ribbon',
    children: [{ className: 'ribbon-left' }, { className: 'ribbon-body', text: 'New' }, { className: 'ribbon-right' }],
  });
  expect(ruleOf(ribbon.css, '.ribbon')).toMatchObject({ position: 'relative', width: '160px', height: '80px' });
  expect(ruleOf(ribbon.css, '.ribbon-left')).toMatchObject({
    position: 'absolute',
    left: '0',
    width: '40px',
    height: '80px',
    'background-color': BLUE,
    'clip-path': 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 60% 50%)',
  });
  expect(ruleOf(ribbon.css, '.ribbon-right')).toMatchObject({
    position: 'absolute',
    right: '0',
    width: '40px',
    'clip-path': 'polygon(0 0, 100% 0, 40% 50%, 100% 100%, 0 100%)',
  });
  expect(ruleOf(ribbon.css, '.ribbon-body')).toMatchObject({
    left: '40px',
    width: '80px',
    color: '#ffffff',
    'background-color': BLUE,
  });

  // A speech bubble: a tail on each of its four sides, always a child element.
  const bubbleTails: Record<string, Record<string, string>> = {
    'bottom-left': {
      left: '20px',
      top: '100%',
      'border-top': `16px solid ${PALE}`,
      'border-right': '16px solid transparent',
    },
    'bottom-right': {
      right: '20px',
      top: '100%',
      'border-top': `16px solid ${PALE}`,
      'border-left': '16px solid transparent',
    },
    left: { left: '-16px', top: '20px', 'border-right': `16px solid ${PALE}`, 'border-top': '16px solid transparent' },
    right: { right: '-16px', top: '20px', 'border-left': `16px solid ${PALE}`, 'border-top': '16px solid transparent' },
  };
  for (const [tail, expected] of Object.entries(bubbleTails)) {
    const bubble = generateShape({
      shape: 'bubble',
      tail,
      width: 200,
      height: 80,
      colour: BLUE,
      background: PALE,
      text: 'Hi',
    });
    expect(bubble.tree, tail).toEqual({ className: 'bubble', text: 'Hi', children: [{ className: 'bubble-tail' }] });
    expect(ruleOf(bubble.css, '.bubble-tail'), tail).toEqual({
      position: 'absolute',
      width: '0',
      height: '0',
      ...expected,
    });
    expect(ruleOf(bubble.css, '.bubble')).toMatchObject({
      position: 'relative',
      width: '200px',
      height: '80px',
      color: BLUE,
      'background-color': PALE,
    });
  }

  // A tooltip: a symmetric arrow centred on the chosen side and pointing outwards.
  const arrows: Record<string, Record<string, string>> = {
    top: {
      left: '50%',
      bottom: '100%',
      'margin-left': '-10px',
      'border-left': '10px solid transparent',
      'border-right': '10px solid transparent',
      'border-bottom': `10px solid ${PALE}`,
    },
    bottom: {
      left: '50%',
      top: '100%',
      'margin-left': '-10px',
      'border-left': '10px solid transparent',
      'border-right': '10px solid transparent',
      'border-top': `10px solid ${PALE}`,
    },
    left: {
      top: '50%',
      right: '100%',
      'margin-top': '-10px',
      'border-top': '10px solid transparent',
      'border-bottom': '10px solid transparent',
      'border-right': `10px solid ${PALE}`,
    },
    right: {
      top: '50%',
      left: '100%',
      'margin-top': '-10px',
      'border-top': '10px solid transparent',
      'border-bottom': '10px solid transparent',
      'border-left': `10px solid ${PALE}`,
    },
  };
  for (const [tail, expected] of Object.entries(arrows)) {
    const tooltip = generateShape({
      shape: 'tooltip',
      tail,
      width: 120,
      height: 40,
      colour: BLUE,
      background: PALE,
      text: 'Tip',
    });
    expect(tooltip.tree, tail).toEqual({
      className: 'tooltip',
      text: 'Tip',
      children: [{ className: 'tooltip-arrow' }],
    });
    expect(ruleOf(tooltip.css, '.tooltip-arrow'), tail).toEqual({
      position: 'absolute',
      width: '0',
      height: '0',
      ...expected,
    });
  }

  // No pseudo-element and no descendant selector anywhere: the canonical writer refuses both.
  for (const shape of ['ribbon', 'bubble', 'tooltip']) {
    const result = generateShape({ shape, colour: BLUE, background: PALE, text: 'x' });
    expect(result.css).not.toContain('::');
    expect(result.css).not.toMatch(/:(before|after)/);
    expect(result.css).not.toContain('>');
  }
});

it('every combination writes CSS that passes the canonical safety check and a tree within its limits', () => {
  const combinations: GenerateShapeOptions[] = [];
  for (const direction of TRIANGLE_DIRECTIONS.keys()) {
    for (const method of ['border', 'clip-path']) {
      combinations.push({ shape: 'triangle', direction, method, colour: BLUE });
    }
  }
  combinations.push({ shape: 'ribbon', text: 'Ribbon' });
  for (const tail of TAIL_SIDES.get('bubble')!) combinations.push({ shape: 'bubble', tail, text: 'Bubble' });
  for (const tail of TAIL_SIDES.get('tooltip')!) combinations.push({ shape: 'tooltip', tail, text: 'Tooltip' });
  // Sizes at and past both ends of the range, colours with an alpha part.
  for (const shape of SHAPES.keys()) {
    for (const size of [8, 9, 399, 400]) {
      combinations.push({ shape, width: size, height: size, colour: '#0f08', background: '#12345678', text: 'x' });
    }
  }
  expect(combinations.length).toBeGreaterThan(30);

  for (const options of combinations) {
    const result = generateShape(options);
    const label = JSON.stringify(options);
    expect(findUnsafeCss(result.css), label).toBeNull();
    expect(() => assertSafeTree(result.tree), label).not.toThrow();
    expect(walk(result.tree).length, label).toBeLessThanOrEqual(32);
    // Every class the CSS styles is in the markup the visitor copies, and every class in the markup is styled.
    const styled = classesIn(result.css);
    const used = walk(result.tree).flatMap((n) => n.className.split(' '));
    for (const name of styled) expect(result.markup, `${label} ${name}`).toContain(name);
    expect([...new Set(used)].sort(), label).toEqual([...new Set(styled)].sort());
    expect(result.markup.startsWith('<div class="'), label).toBe(true);
  }
});

it('colours must be hexadecimal, sizes are clamped with a warning and names come from closed lists', () => {
  // A colour that is not 3, 4, 6 or 8 hexadecimal digits is refused, and the refusal never repeats the typed text.
  const marker = 'FODT-SHAPE-MARKER';
  for (const bad of ['red', 'rgb(0, 0, 0)', '#12', '#12345', '#gggggg', '', `url(${marker})`, `#${marker}`]) {
    for (const field of ['colour', 'background'] as const) {
      let thrown: unknown;
      const options: GenerateShapeOptions = { shape: 'bubble' };
      options[field] = bad;
      try {
        generateShape(options);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${field} ${bad}`).toBeInstanceOf(CssShapesError);
      expect((thrown as Error).message).not.toContain(marker);
      expect((thrown as Error).message.toLowerCase()).toContain(field === 'colour' ? 'colour' : 'background');
    }
  }
  expect(generateShape({ shape: 'triangle', colour: '#ABC' }).css).toContain('#aabbcc');

  // For a page whose colour box takes any text, a bad value falls back to the default with a warning that does not repeat it.
  const kept = colourOrDefault('#12ab9f', '#000000', 'Colour');
  expect(kept).toEqual({ colour: '#12ab9f', warning: null });
  const fallback = colourOrDefault('CANARY-' + marker, '#1d4ed8', 'Colour');
  expect(fallback.colour).toBe('#1d4ed8');
  expect(fallback.warning).toMatch(/^Colour was not a valid hexadecimal colour/);
  expect(fallback.warning).not.toContain(marker);

  // A size outside 8 to 400, or not a number, is clamped and named in a warning.
  const small = generateShape({ shape: 'triangle', method: 'clip-path', width: -5, height: 9999 });
  expect(ruleOf(small.css, '.triangle')).toMatchObject({ width: '8px', height: '400px' });
  expect(small.warnings).toHaveLength(2);
  expect(small.warnings[0]).toMatch(/^Width .*minimum of 8/);
  expect(small.warnings[1]).toMatch(/^Height .*maximum of 400/);
  const broken = generateShape({ shape: 'triangle', method: 'clip-path', width: Number.NaN, height: Infinity });
  expect(broken.warnings).toHaveLength(2);
  expect(findUnsafeCss(broken.css)).toBeNull();
  expect(generateShape({ shape: 'triangle', width: 8, height: 400 }).warnings).toEqual([]);

  // Names come from closed lists, so a name that merely exists on every object is refused too.
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope', ''];
  for (const bad of names) {
    expect(() => generateShape({ shape: bad }), `shape ${bad}`).toThrow(CssShapesError);
    expect(() => generateShape({ shape: 'triangle', direction: bad }), `direction ${bad}`).toThrow(CssShapesError);
    expect(() => generateShape({ shape: 'triangle', method: bad }), `method ${bad}`).toThrow(CssShapesError);
    expect(() => generateShape({ shape: 'bubble', tail: bad }), `bubble tail ${bad}`).toThrow(CssShapesError);
    expect(() => generateShape({ shape: 'tooltip', tail: bad }), `tooltip arrow ${bad}`).toThrow(CssShapesError);
  }
  // A side that belongs to the other shape is refused too.
  expect(() => generateShape({ shape: 'bubble', tail: 'top' })).toThrow(CssShapesError);
  expect(() => generateShape({ shape: 'tooltip', tail: 'bottom-left' })).toThrow(CssShapesError);
  // A field the shape does not use is not read, so it cannot change the result.
  const withStale = generateShape({ shape: 'ribbon', direction: '__proto__', tail: 'nope', method: 'nope', text: 'x' });
  expect(withStale.css).toBe(generateShape({ shape: 'ribbon', text: 'x' }).css);
  // Left out, every field has a default.
  expect(generateShape({}).tree.className).toBe('triangle');
  expect(generateShape({ shape: 'bubble' }).tree.children?.[0]?.className).toBe('bubble-tail');
});

it('typed bubble text reaches only the tree and the escaped markup, never the CSS', () => {
  const baseline = generateShape({ shape: 'bubble', colour: BLUE, background: PALE, text: '' });
  for (const hostile of HOSTILE_FIELD_VALUES) {
    for (const shape of ['bubble', 'tooltip', 'ribbon']) {
      const result = generateShape({ shape, colour: BLUE, background: PALE, text: hostile });
      const label = `${shape} ${hostile}`;
      expect(findUnsafeCss(result.css), label).toBeNull();
      expect(result.css, label).not.toContain('example.invalid');
      expect(result.css, label).not.toContain('url(');
      expect(result.css, label).not.toContain('evil');
      const holder = walk(result.tree).find((n) => n.text !== undefined)!;
      expect(holder.text, label).toBe(hostile);
      // The markup carries the text escaped: no angle bracket or quote of it survives.
      expect(result.markup, label).not.toContain('<script');
      expect(result.markup, label).not.toContain('</style');
      expect(result.markup.replace(/<\/?div[^>]*>/g, ''), label).not.toMatch(/[<>"']/);
    }
  }
  // The text changes nothing in the CSS.
  expect(generateShape({ shape: 'bubble', colour: BLUE, background: PALE, text: 'anything at all' }).css).toBe(
    baseline.css,
  );

  const escaped = generateShape({ shape: 'bubble', text: `<b>&"'` });
  expect(escaped.markup).toContain('&lt;b&gt;&amp;&quot;&#39;');

  // A triangle has no text.
  expect(generateShape({ shape: 'triangle', text: 'ignored' }).tree).toEqual({ className: 'triangle' });

  // Text over 200 characters is cut with a warning that does not repeat it; a surrogate pair is never split.
  const long = generateShape({ shape: 'bubble', text: 'a'.repeat(300) });
  expect(long.tree.text).toHaveLength(200);
  expect(long.warnings.join(' ')).toMatch(/200 characters/);
  expect(long.warnings.join(' ')).not.toContain('aaaa');
  const pairs = generateShape({ shape: 'bubble', text: String.fromCodePoint(0x1f600).repeat(150) });
  expect(pairs.tree.text).toHaveLength(200);
  expect(pairs.tree.text!.codePointAt(pairs.tree.text!.length - 2)).toBe(0x1f600);
  expect(() => assertSafeTree(pairs.tree)).not.toThrow();

  // Control and direction characters are removed with a warning; the markup never holds them.
  const sneaky = `a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x0)}c${String.fromCodePoint(0x200b)}d${String.fromCodePoint(0x85)}e`;
  const cleaned = generateShape({ shape: 'tooltip', text: sneaky });
  expect(cleaned.tree.text).toBe('abcde');
  expect(cleaned.markup).toContain('abcde');
  expect(cleaned.warnings.join(' ')).toMatch(/control|direction/i);
});

it('css-safe.ts is the canonical copy', () => {
  const bytes = readFileSync(new URL('../src/css-safe.ts', import.meta.url));
  expect(createHash('md5').update(bytes).digest('hex')).toBe('ad0bffed52987b6b331c6d39227b080f');
});

it('nothing is written to the console while generating shapes', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
  try {
    for (const shape of SHAPES.keys()) {
      generateShape({ shape, text: 'quiet', width: -1, height: 9999 });
      expect(() => generateShape({ shape, colour: 'bad' })).toThrow(CssShapesError);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('text has zero-width characters removed, tab and line breaks turned into a space, and an all-removed text is no text', () => {
  const zeroWidth = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((cp) => String.fromCodePoint(cp));
  const TAB = String.fromCodePoint(9);
  const LF = String.fromCodePoint(10);
  const CR = String.fromCodePoint(13);
  for (const z of zeroWidth) {
    const code = z.codePointAt(0)!.toString(16);
    expect(generateShape({ shape: 'bubble', text: `a${z}b` }).tree.text, `U+${code}`).toBe('ab');
  }
  // Each of tab, line feed and carriage return is one space.
  expect(generateShape({ shape: 'bubble', text: `a${TAB}b` }).tree.text).toBe('a b');
  expect(generateShape({ shape: 'tooltip', text: `a${LF}b` }).tree.text).toBe('a b');
  expect(generateShape({ shape: 'ribbon', text: `a${CR}${LF}b` }).tree.children?.[1]?.text).toBe('a  b');
  // Text made only of removed characters is the same as no text: the shape is drawn without any.
  const plain = generateShape({ shape: 'bubble', text: '' });
  for (const text of [zeroWidth.join(''), `${TAB}${LF}${CR}`, `${zeroWidth[0]!}${LF}${zeroWidth[1]!}`]) {
    const result = generateShape({ shape: 'bubble', text });
    expect(result.tree, JSON.stringify(text)).toEqual(plain.tree);
    expect(result.markup, JSON.stringify(text)).toBe(plain.markup);
    expect(result.warnings.join(' ')).toMatch(/removed|replaced/i);
  }
  // Plain spaces typed by the visitor are not touched.
  expect(generateShape({ shape: 'bubble', text: '  hi  ' }).tree.text).toBe('  hi  ');
});
