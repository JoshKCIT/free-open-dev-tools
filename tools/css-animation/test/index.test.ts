import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateAnimation, AnimationError, EASING_KEYWORDS } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

it('keyframes are written with percentage selectors in order and a name the CSS Animations Level 1 grammar allows', () => {
  // "two frames, 0 percent at rest and 100 percent moved 100 px right with
  // opacity 0, give a @keyframes slide-in block with 0% and 100% selectors
  // and transform and opacity declarations, plus .box with
  // animation-name: slide-in; and the other longhands."
  const result = generateAnimation({
    mode: 'keyframes',
    name: 'slide-in',
    frames: [
      { at: 0, x: 0, y: 0, opacity: 100 },
      { at: 100, x: 100, y: 0, opacity: 0 },
    ],
  });
  expect(result.css).toContain('@keyframes slide-in {');
  expect(result.css).toContain('0% {');
  expect(result.css).toContain('100% {');
  expect(result.css).toContain('animation-name: slide-in;');
  expect(result.warnings).toEqual([]);

  // Selectors are written in ascending order regardless of input order.
  const outOfOrder = generateAnimation({
    mode: 'keyframes',
    name: 'reorder-test',
    frames: [
      { at: 100, opacity: 0 },
      { at: 0, opacity: 100 },
      { at: 50, opacity: 50 },
    ],
  });
  const idx0 = outOfOrder.css.indexOf('0% {');
  const idx50 = outOfOrder.css.indexOf('50% {');
  const idx100 = outOfOrder.css.indexOf('100% {');
  expect(idx0).toBeGreaterThan(-1);
  expect(idx50).toBeGreaterThan(idx0);
  expect(idx100).toBeGreaterThan(idx50);
});

it('a keyframes name that is a CSS-wide keyword, none or not an identifier is refused', () => {
  // "a keyframes name of none, inherit, 2fast or one holding a space is
  // refused with a warning and the default name is used."
  for (const bad of ['none', 'inherit', '2fast', 'has space', 'Upper', '']) {
    const result = generateAnimation({ mode: 'keyframes', name: bad, frames: [{ at: 0 }, { at: 100 }] });
    expect(result.css).toContain('@keyframes slide-in {');
    expect(result.warnings.some((w) => /not a usable identifier/.test(w))).toBe(true);
  }
  const ok = generateAnimation({ mode: 'keyframes', name: 'my-fade', frames: [{ at: 0 }, { at: 100 }] });
  expect(ok.css).toContain('@keyframes my-fade {');
  expect(ok.warnings).toEqual([]);
});

it('animation longhands are written instead of the shorthand, so a name can never be read as a keyword', () => {
  // CSS Animations Level 1, section 3.10 "The animation shorthand property":
  // "Note that order is also important within each animation definition for
  // distinguishing <keyframes-name> values from other keywords. When
  // parsing, keywords that are valid for properties other than
  // animation-name whose values were not found earlier in the shorthand
  // must be accepted for those properties rather than for animation-name."
  // A keyframes name that happens to equal a valid keyword (e.g. "normal")
  // would be misread if written through the "animation" shorthand -- this
  // tool never writes that shorthand at all.
  const result = generateAnimation({
    mode: 'keyframes',
    name: 'normal',
    frames: [{ at: 0 }, { at: 100 }],
    timing: { duration: 500, delay: 10, iterations: 2, direction: 'reverse', fillMode: 'both', playState: 'paused' },
  });
  // The reduced-motion rule further down is allowed to write the shorthand
  // ("animation: none;") -- only the .box rule itself, where a keyframes
  // name could be misread, must avoid it.
  const boxRule = result.css.slice(0, result.css.indexOf('@keyframes'));
  expect(boxRule).not.toMatch(/\banimation:/);
  expect(result.css).toContain('animation-name: normal;');
  expect(result.css).toContain('animation-duration: 500ms;');
  expect(result.css).toContain('animation-timing-function: ease;');
  expect(result.css).toContain('animation-delay: 10ms;');
  expect(result.css).toContain('animation-iteration-count: 2;');
  expect(result.css).toContain('animation-direction: reverse;');
  expect(result.css).toContain('animation-fill-mode: both;');
  expect(result.css).toContain('animation-play-state: paused;');
});

it('cubic-bezier x values are kept between 0 and 1 and steps use the positions CSS Easing Functions Level 1 defines', () => {
  // CSS Easing Functions Level 1, section 2.2: "The x coordinates of P1 and
  // P2 are restricted to the range [0, 1]."
  const clamped = generateAnimation({
    mode: 'keyframes',
    frames: [{ at: 0 }, { at: 100 }],
    timing: { easing: 'cubic-bezier', bezier: { x1: -5, y1: 0.1, x2: 5, y2: 1 } },
  });
  expect(clamped.css).toContain('cubic-bezier(0, 0.1, 1, 1)');
  expect(clamped.warnings.some((w) => /x1/i.test(w))).toBe(true);
  expect(clamped.warnings.some((w) => /x2/i.test(w))).toBe(true);

  // "steps(4, jump-end) is written with a keyword from the Easing Functions
  // list." <step-position> = jump-start | jump-end | jump-none | jump-both |
  // start | end.
  const steps = generateAnimation({
    mode: 'keyframes',
    frames: [{ at: 0 }, { at: 100 }],
    timing: { easing: 'steps', steps: 4, stepPosition: 'jump-end' },
  });
  expect(steps.css).toContain('animation-timing-function: steps(4, jump-end);');

  // An unknown step position falls back to the specification's own default.
  const fallback = generateAnimation({
    mode: 'keyframes',
    frames: [{ at: 0 }, { at: 100 }],
    timing: { easing: 'steps', steps: 3, stepPosition: 'not-a-position' },
  });
  expect(fallback.css).toContain('steps(3, jump-end)');

  expect(EASING_KEYWORDS).toContain('linear');
  expect(EASING_KEYWORDS).toContain('ease-in-out');
});

it('transitions write the CSS Transitions Level 1 longhands on the element and the target state in a hover rule', () => {
  // CSS Transitions Level 1's own four longhands: transition-property,
  // transition-duration, transition-timing-function, transition-delay.
  const result = generateAnimation({
    mode: 'transition',
    timing: { duration: 200, easing: 'ease-out', delay: 50 },
    transition: { property: 'transform', x: 0, y: -12, scale: 1.05, opacity: 100, color: '#111111' },
  });
  expect(result.css).toContain('.box {');
  expect(result.css).toContain('transition-property: transform;');
  expect(result.css).toContain('transition-duration: 200ms;');
  expect(result.css).toContain('transition-timing-function: ease-out;');
  expect(result.css).toContain('transition-delay: 50ms;');
  expect(result.css).toContain('.box:hover {');
  const hoverRule = result.css.slice(result.css.indexOf('.box:hover {'));
  expect(hoverRule).toContain('transform: translate(0, -12px) scale(1.05);');
  expect(hoverRule).toContain('background-color: #111111;');
});

it('the reduced motion rule turns the motion off as the Media Queries Level 5 feature describes', () => {
  // Media Queries Level 5, section 12.1: "prefers-reduced-motion ... Value:
  // no-preference | reduce."
  const withRule = generateAnimation({ mode: 'keyframes', frames: [{ at: 0 }, { at: 100 }], reducedMotion: true });
  expect(withRule.css.endsWith('}')).toBe(true);
  expect(withRule.css).toContain('@media (prefers-reduced-motion: reduce) {');
  const reducedBlock = withRule.css.slice(withRule.css.indexOf('@media (prefers-reduced-motion: reduce) {'));
  expect(reducedBlock).toContain('animation: none;');
  expect(reducedBlock).toContain('transition: none;');
  // The reduced-motion rule is the very last thing written.
  expect(withRule.css.trimEnd().endsWith('}')).toBe(true);
  expect(withRule.css.lastIndexOf('@media')).toBeGreaterThan(withRule.css.lastIndexOf('@keyframes'));

  const without = generateAnimation({ mode: 'keyframes', frames: [{ at: 0 }, { at: 100 }], reducedMotion: false });
  expect(without.css).not.toContain('@media');

  const transitionWithRule = generateAnimation({ mode: 'transition', reducedMotion: true });
  expect(transitionWithRule.css).toContain('@media (prefers-reduced-motion: reduce) {');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateAnimation({ mode: 'keyframes', name: 'slide-in', frames: [{ at: 0 }, { at: 100, x: 100, opacity: 0 }] }),
    generateAnimation({
      mode: 'keyframes',
      name: 'pulse',
      frames: [
        { at: 0, scale: 1 },
        { at: 50, scale: 1.2 },
        { at: 100, scale: 1 },
      ],
      timing: { easing: 'cubic-bezier', bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
    }),
    generateAnimation({
      mode: 'keyframes',
      name: 'stepper',
      frames: [{ at: 0 }, { at: 100 }],
      timing: { easing: 'steps', steps: 4, stepPosition: 'jump-none' },
    }),
    generateAnimation({
      mode: 'transition',
      timing: { duration: 300, easing: 'ease-in-out', delay: 0 },
      transition: { property: 'all', x: 10, y: -10, scale: 1.1, opacity: 80, color: '#334455' },
    }),
  ];
  for (const result of samples) {
    const ast = csstree.parse(result.css, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.css}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.css}`).not.toBeNull();
      }
    });
    expect(declarationCount).toBeGreaterThan(0);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    let result;
    try {
      result = generateAnimation({
        mode: 'keyframes',
        name: hostile,
        frames: [{ at: 0 }, { at: 100 }],
        background: hostile,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AnimationError);
      continue;
    }
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
    expect(result.css).not.toContain('url(');

    let transitionResult;
    try {
      transitionResult = generateAnimation({
        mode: 'transition',
        transition: { color: hostile },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AnimationError);
      continue;
    }
    expect(findUnsafeCss(transitionResult.css), transitionResult.css).toBeNull();
    expect(transitionResult.css).not.toContain('example.invalid');
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateAnimation({
      mode: 'keyframes',
      frames: [
        { at: value, x: value, y: value, rotate: value, scale: value, opacity: value },
        { at: value, x: value, y: value, rotate: value, scale: value, opacity: value },
      ],
      timing: {
        duration: value,
        delay: value,
        iterations: value,
        bezier: { x1: value, y1: value, x2: value, y2: value },
      },
      width: value,
      height: value,
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateAnimation({ mode: 'keyframes', frames: [{ at: 0 }, { at: 100 }] });
  expect(result.tree.className).toBe('box');
  expect(result.css).toContain('.box {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateAnimation({ mode: 'keyframes', name: 'slide-in', frames: [{ at: 0 }, { at: 100 }] });
    generateAnimation({ mode: 'keyframes', name: 'none', frames: [{ at: 0 }, { at: 0 }] });
    generateAnimation({ mode: 'transition', transition: { color: 'not-a-colour' } });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
