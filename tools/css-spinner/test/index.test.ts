import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateSpinner,
  colourOrDefault,
  CssSpinnerError,
  SPINNER_TYPES,
  type GenerateSpinnerOptions,
} from '../src/index';
import { assertSafeTree, findUnsafeCss, type PreviewTreeNode } from '../src/css-safe';

const BLUE = '#1d4ed8';
const PRELUDE = '@media (prefers-reduced-motion: reduce) {';

/** Reads each rule of a block of rules into selector, then property, then value. */
function rules(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const block of text.split('}')) {
    const open = block.indexOf('{');
    if (open < 0) continue;
    const declarations: Record<string, string> = {};
    for (const line of block.slice(open + 1).split(';')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      declarations[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    out.set(block.slice(0, open).trim(), declarations);
  }
  return out;
}

/** The rules written before any at-rule. */
function baseRules(css: string): Map<string, Record<string, string>> {
  const at = css.indexOf('@');
  return rules(at < 0 ? css : css.slice(0, at));
}

/** The rules inside the reduced-motion block. */
function reducedRules(css: string): Map<string, Record<string, string>> {
  const start = css.indexOf(PRELUDE);
  expect(start, `no reduced-motion rule in ${css}`).toBeGreaterThanOrEqual(0);
  const inner = css.slice(start + PRELUDE.length);
  return rules(inner.slice(0, inner.lastIndexOf('}')));
}

function walk(node: PreviewTreeNode, into: PreviewTreeNode[] = []): PreviewTreeNode[] {
  into.push(node);
  for (const child of node.children ?? []) walk(child, into);
  return into;
}

/** The seconds in a value such as 0.167s. */
function seconds(value: string | undefined): number {
  expect(value, 'a time is missing').toMatch(/^[0-9.]+s$/);
  return Number(value!.slice(0, -1));
}

const KEYFRAME_NAMES: Record<string, string> = {
  ring: 'spin',
  'dual-ring': 'spin',
  dots: 'bounce',
  bars: 'stretch',
  pulse: 'pulse',
  ripple: 'ripple',
};

it('each spinner kind writes its keyframes and animation and a reduced-motion rule that stops every animated class', () => {
  expect([...SPINNER_TYPES.keys()]).toEqual(['ring', 'dual-ring', 'dots', 'bars', 'pulse', 'ripple']);

  // A ring of size 48 and speed 1, worked out by hand: a border of 5 pixels (one tenth of 48, rounded), a track at
  // 20 percent opacity (51 is 33 in hex) and a coloured top edge that turns.
  const ring = generateSpinner({ type: 'ring', size: 48, colour: BLUE, speed: 1 });
  expect(baseRules(ring.css).get('.spinner')).toEqual({
    'box-sizing': 'border-box',
    width: '48px',
    height: '48px',
    border: '5px solid #1d4ed833',
    'border-top-color': BLUE,
    'border-radius': '50%',
    'animation-name': 'spin',
    'animation-duration': '1s',
    'animation-timing-function': 'linear',
    'animation-iteration-count': 'infinite',
  });
  expect(ring.css).toContain('@keyframes spin {');
  expect(ring.css).toContain('from {\n    transform: rotate(0deg);');
  expect(ring.css).toContain('to {\n    transform: rotate(360deg);');

  for (const type of SPINNER_TYPES.keys()) {
    const result = generateSpinner({ type, size: 48, colour: BLUE, speed: 1 });
    const base = baseRules(result.css);
    const animated = [...base].filter(([, declarations]) => declarations['animation-name'] !== undefined);
    expect(animated.length, type).toBeGreaterThan(0);
    for (const [, declarations] of animated) {
      expect(declarations['animation-name'], type).toBe(KEYFRAME_NAMES[type]);
      expect(declarations['animation-duration'], type).toBe('1s');
      expect(declarations['animation-iteration-count'], type).toBe('infinite');
    }
    expect(result.css, type).toContain(`@keyframes ${KEYFRAME_NAMES[type]} {`);
    // Every animated class is repeated in the reduced-motion block with animation set to none.
    const reduced = reducedRules(result.css);
    for (const [selector] of animated) {
      expect(reduced.get(selector), `${type} ${selector}`).toBeDefined();
      expect(reduced.get(selector)!.animation, `${type} ${selector}`).toBe('none');
    }
    // The block holds no rule for a class that does not animate.
    for (const selector of reduced.keys()) {
      expect(
        animated.map(([s]) => s),
        `${type} ${selector}`,
      ).toContain(selector);
    }
  }

  // A pulse and a ripple stay readable when still: they are not left empty or invisible.
  expect(reducedRules(generateSpinner({ type: 'ripple' }).css).get('.ring')).toMatchObject({
    animation: 'none',
    opacity: '0.6',
  });
  expect(baseRules(generateSpinner({ type: 'pulse' }).css).get('.spinner')).toMatchObject({
    'border-radius': '50%',
    'background-color': BLUE,
  });
});

it('dots and bars use numbered child classes with increasing delays', () => {
  // Three dots a sixth of the time apart and four bars an eighth apart at speed 1, then two ripples half a turn apart.
  const dots = generateSpinner({ type: 'dots', size: 48, colour: BLUE, speed: 1 });
  expect(dots.tree).toEqual({
    className: 'spinner',
    children: [{ className: 'dot dot-1' }, { className: 'dot dot-2' }, { className: 'dot dot-3' }],
  });
  const dotRules = baseRules(dots.css);
  expect(dotRules.get('.dot')).toMatchObject({
    width: '12px',
    height: '12px',
    'border-radius': '50%',
    'background-color': BLUE,
  });
  expect(dotRules.get('.dot-1')).toEqual({ 'animation-delay': '0s' });
  expect(dotRules.get('.dot-2')).toEqual({ 'animation-delay': '0.167s' });
  expect(dotRules.get('.dot-3')).toEqual({ 'animation-delay': '0.333s' });

  const bars = generateSpinner({ type: 'bars', size: 48, colour: BLUE, speed: 1 });
  expect(bars.tree.children?.map((c) => c.className)).toEqual(['bar bar-1', 'bar bar-2', 'bar bar-3', 'bar bar-4']);
  const barRules = baseRules(bars.css);
  expect(barRules.get('.bar')).toMatchObject({ width: '6px', height: '100%', 'background-color': BLUE });
  expect(['.bar-1', '.bar-2', '.bar-3', '.bar-4'].map((s) => barRules.get(s)!['animation-delay'])).toEqual([
    '0s',
    '0.125s',
    '0.25s',
    '0.375s',
  ]);

  const ripple = generateSpinner({ type: 'ripple', size: 48, colour: BLUE, speed: 1 });
  expect(ripple.tree.children?.map((c) => c.className)).toEqual(['ring ring-1', 'ring ring-2']);
  expect(baseRules(ripple.css).get('.ring-1')).toEqual({ 'animation-delay': '0s' });
  expect(baseRules(ripple.css).get('.ring-2')).toEqual({ 'animation-delay': '0.5s' });

  // Whatever the speed, the delays never go down (a pulse or ripple faster than its minimum is held to the minimum).
  for (const speed of [0.2, 0.7, 1, 3.3, 5]) {
    for (const [type, selectors] of [
      ['dots', ['.dot-1', '.dot-2', '.dot-3']],
      ['bars', ['.bar-1', '.bar-2', '.bar-3', '.bar-4']],
      ['ripple', ['.ring-1', '.ring-2']],
    ] as const) {
      const sheet = baseRules(generateSpinner({ type, speed }).css);
      const delays = selectors.map((s) => seconds(sheet.get(s)!['animation-delay']));
      const held = seconds(
        sheet.get(type === 'ripple' ? '.ring' : type === 'dots' ? '.dot' : '.bar')!['animation-duration'],
      );
      for (let i = 1; i < delays.length; i++) expect(delays[i]!, `${type} ${speed}`).toBeGreaterThan(delays[i - 1]!);
      expect(delays[delays.length - 1]!, `${type} ${speed}`).toBeLessThan(held);
    }
  }
});

it('size and speed are written exactly and clamped with a warning outside their ranges', () => {
  const exact = generateSpinner({ type: 'ring', size: 64, speed: 2.5, colour: BLUE });
  expect(baseRules(exact.css).get('.spinner')).toMatchObject({
    width: '64px',
    height: '64px',
    'animation-duration': '2.5s',
  });
  expect(exact.warnings).toEqual([]);
  const edges = generateSpinner({ type: 'ring', size: 16, speed: 0.2 });
  expect(baseRules(edges.css).get('.spinner')).toMatchObject({
    width: '16px',
    height: '16px',
    'animation-duration': '0.2s',
  });
  expect(generateSpinner({ type: 'pulse', size: 256, speed: 5 }).warnings).toEqual([]);

  const low = generateSpinner({ type: 'ring', size: 4, speed: 0 });
  expect(baseRules(low.css).get('.spinner')).toMatchObject({
    width: '16px',
    height: '16px',
    'animation-duration': '0.2s',
  });
  expect(low.warnings).toHaveLength(2);
  expect(low.warnings[0]).toMatch(/^Size .*minimum of 16/);
  expect(low.warnings[1]).toMatch(/^Speed .*minimum of 0\.2/);

  const high = generateSpinner({ type: 'ring', size: 999, speed: 99 });
  expect(baseRules(high.css).get('.spinner')).toMatchObject({
    width: '256px',
    height: '256px',
    'animation-duration': '5s',
  });
  expect(high.warnings[0]).toMatch(/^Size .*maximum of 256/);
  expect(high.warnings[1]).toMatch(/^Speed .*maximum of 5/);

  const broken = generateSpinner({ type: 'ring', size: Number.NaN, speed: Infinity });
  expect(broken.warnings).toHaveLength(2);
  expect(findUnsafeCss(broken.css)).toBeNull();
  // Left out, the defaults are used without a warning.
  const plain = generateSpinner({});
  expect(plain.warnings).toEqual([]);
  expect(baseRules(plain.css).get('.spinner')).toMatchObject({ width: '48px', 'animation-duration': '1s' });
});

it('every spinner stylesheet passes the canonical safety check and carries the exact reduced-motion prelude', () => {
  const combinations: GenerateSpinnerOptions[] = [];
  for (const type of SPINNER_TYPES.keys()) {
    for (const size of [16, 17, 48, 255, 256]) {
      for (const speed of [0.2, 1, 4.9, 5]) combinations.push({ type, size, speed, colour: '#0f08' });
    }
    combinations.push({ type, colour: '#ABCDEF' }, { type, colour: '#12345678' });
  }
  for (const options of combinations) {
    const result = generateSpinner(options);
    const label = JSON.stringify(options);
    expect(findUnsafeCss(result.css), label).toBeNull();
    expect(result.css, label).toContain(PRELUDE);
    expect(result.css, label).not.toContain('url(');
    expect(() => assertSafeTree(result.tree), label).not.toThrow();
    expect(walk(result.tree).length, label).toBeLessThanOrEqual(32);
    // Every class the CSS styles is in the tree, and every class in the tree is styled.
    const styled = [...baseRules(result.css).keys()].map((s) => s.slice(1));
    const used = walk(result.tree).flatMap((n) => n.className.split(' '));
    expect([...new Set(used)].sort(), label).toEqual([...new Set(styled)].sort());
    // The markup names the same classes and announces itself to a screen reader.
    expect(result.markup.startsWith('<div class="spinner" role="status" aria-label="Loading">'), label).toBe(true);
    for (const name of styled) expect(result.markup, `${label} ${name}`).toContain(name);
  }
});

it('kind names are looked up safely for __proto__, constructor and toString', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'nope', '']) {
    expect(() => generateSpinner({ type: bad }), `type ${bad}`).toThrow(CssSpinnerError);
  }
  expect(generateSpinner({}).tree.className).toBe('spinner');

  // A colour that is not 3, 4, 6 or 8 hexadecimal digits is refused, and the refusal never repeats the typed text.
  const marker = 'FODT-SPINNER-MARKER';
  for (const bad of ['red', 'rgb(0, 0, 0)', '#12', '#12345', '#gggggg', '', `url(${marker})`, `#${marker}`]) {
    let thrown: unknown;
    try {
      generateSpinner({ colour: bad });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, bad).toBeInstanceOf(CssSpinnerError);
    expect((thrown as Error).message).not.toContain(marker);
    expect((thrown as Error).message.toLowerCase()).toContain('colour');
  }
  expect(generateSpinner({ colour: '#ABC' }).css).toContain('#aabbcc');

  // For a page whose colour box takes any text, a bad value falls back to the default with a warning that does not repeat it.
  expect(colourOrDefault('#12ab9f', '#000000', 'Colour')).toEqual({ colour: '#12ab9f', warning: null });
  const fallback = colourOrDefault(marker, BLUE, 'Colour');
  expect(fallback.colour).toBe(BLUE);
  expect(fallback.warning).toMatch(/^Colour was not a valid hexadecimal colour/);
  expect(fallback.warning).not.toContain(marker);
});

it('css-safe.ts is the canonical copy', () => {
  const bytes = readFileSync(new URL('../src/css-safe.ts', import.meta.url));
  expect(createHash('md5').update(bytes).digest('hex')).toBe('9fe7f3cafc6240284c78b958bde1343b');
});

it('nothing is written to the console while generating spinners', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
  try {
    for (const type of SPINNER_TYPES.keys()) {
      generateSpinner({ type, size: -1, speed: 99 });
      expect(() => generateSpinner({ type, colour: 'bad' })).toThrow(CssSpinnerError);
    }
    expect(() => generateSpinner({ type: 'nope' })).toThrow(CssSpinnerError);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('a pulse or a ripple never flashes more than three times a second', () => {
  // A pulse fades once a turn and a ripple has two rings half a turn apart, so it fades twice a turn.
  const flashes: [string, string, number][] = [
    ['pulse', '.spinner', 1],
    ['ripple', '.ring', 2],
  ];
  for (const [type, selector, perTurn] of flashes) {
    for (const speed of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 1, 5]) {
      const result = generateSpinner({ type, speed });
      const turn = seconds(baseRules(result.css).get(selector)!['animation-duration']);
      expect(perTurn / turn, `${type} at ${speed}`).toBeLessThanOrEqual(3);
      expect(turn, `${type} at ${speed}`).toBeGreaterThanOrEqual(Math.min(speed, 5));
    }
    // Held to the minimum, with a warning that names the number.
    const fast = generateSpinner({ type, speed: 0.2 });
    expect(fast.warnings).toHaveLength(1);
    expect(fast.warnings[0]).toMatch(/^Speed was below its minimum of 0.[47], so 0.[47] was used.$/);
    // A speed that is already slow enough is written as typed, without a warning.
    expect(generateSpinner({ type, speed: 1 }).warnings).toEqual([]);
  }
  expect(baseRules(generateSpinner({ type: 'pulse', speed: 0.2 }).css).get('.spinner')).toMatchObject({
    'animation-duration': '0.4s',
  });
  expect(baseRules(generateSpinner({ type: 'ripple', speed: 0.2 }).css).get('.ring')).toMatchObject({
    'animation-duration': '0.7s',
  });
  // The kinds that do not fade keep the old minimum.
  for (const type of ['ring', 'dual-ring', 'dots', 'bars']) {
    const result = generateSpinner({ type, speed: 0.2 });
    expect(result.warnings, type).toEqual([]);
    expect(result.css, type).toContain('animation-duration: 0.2s;');
  }
});
