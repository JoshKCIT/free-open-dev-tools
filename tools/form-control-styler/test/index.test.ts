import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CONTROLS,
  FormControlError,
  PRESETS,
  colourOrDefault,
  contrastRatio,
  styleControls,
  usesRadius,
  type StyleControlsOptions,
} from '../src/index';
import { ALLOWED_SELECTORS, controlCss, findUnsafeControlCss, type ControlRule } from '../src/control-css';

const CONTROL_IDS = ['button', 'switch', 'checkbox', 'radio', 'range'];
const PRESET_IDS = ['plain', 'rounded', 'pill', 'outline', 'soft', 'bold'];
const REDUCED_PRELUDE = '@media (prefers-reduced-motion: reduce) {';

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

/** The class name each control's rules use. */
const CLASS_OF: Record<string, string> = {
  button: 'fc-button',
  switch: 'fc-switch',
  checkbox: 'fc-check',
  radio: 'fc-radio',
  range: 'fc-range',
};

/** Every control with every preset, once with and once without the disabled copy. */
function everyCombination(extra: StyleControlsOptions = {}): { label: string; options: StyleControlsOptions }[] {
  const all: { label: string; options: StyleControlsOptions }[] = [];
  for (const control of CONTROL_IDS) {
    for (const preset of PRESET_IDS) {
      for (const showDisabled of [false, true]) {
        all.push({
          label: `${control}/${preset}/${showDisabled ? 'with' : 'without'} disabled`,
          options: { control, preset, showDisabled, ...extra },
        });
      }
    }
  }
  return all;
}

/** Reads one rule of a stylesheet (searching from `from`) into its property and value pairs. */
function ruleOf(css: string, selector: string, from = 0): Record<string, string> | null {
  const start = css.indexOf(`${selector} {\n`, from);
  if (start < 0) return null;
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const declarations: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    declarations[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/;$/, '');
  }
  return declarations;
}

/** The selectors of every rule outside the reduced-motion block, in the order written. */
function selectorsInOrder(css: string): string[] {
  const outside = css.split(REDUCED_PRELUDE)[0]!;
  return outside
    .split('\n')
    .filter((line) => line.endsWith(' {'))
    .map((line) => line.slice(0, -2));
}

const STATE_ORDER = ['', ':hover', ':focus-visible', ':active', ':checked', ':disabled'];

/** 0 for a rule with no state, then the index of its pseudo-class in the fixed order. */
function stateRank(selector: string): number {
  const withoutElement = selector.split('::')[0]!;
  const colon = withoutElement.indexOf(':');
  const pseudo = colon < 0 ? '' : withoutElement.slice(colon);
  return STATE_ORDER.indexOf(pseudo);
}

it('every control is its native element in the markup and keeps a visible focus-visible rule', () => {
  expect([...CONTROLS.keys()]).toEqual(CONTROL_IDS);
  expect([...PRESETS.keys()]).toEqual(PRESET_IDS);

  for (const { label, options } of everyCombination()) {
    const result = styleControls(options);
    const control = options.control!;
    const markup = result.markup;
    const disabledCount = (markup.match(/ disabled/g) ?? []).length;
    expect(disabledCount, label).toBe(options.showDisabled ? 1 : 0);

    // The native element, and no stand-in for it: the switch role is the only role the markup carries.
    const roles = markup.match(/role="[^"]*"/g) ?? [];
    const switchCount = control === 'switch' ? (options.showDisabled ? 2 : 1) : 0;
    expect(roles, label).toEqual(Array.from({ length: switchCount }, () => 'role="switch"'));
    expect(markup, label).not.toMatch(/<(div|span|a)[^>]*(tabindex|onclick|role)/);
    const inputs = markup.match(/<input [^>]*>/g) ?? [];
    const buttons = markup.match(/<button [^>]*>/g) ?? [];
    if (control === 'button') {
      expect(inputs, label).toEqual([]);
      expect(buttons.length, label).toBe(options.showDisabled ? 2 : 1);
      for (const tag of buttons) expect(tag, label).toContain('type="button"');
    } else {
      expect(buttons, label).toEqual([]);
      const type =
        control === 'switch' || control === 'checkbox' ? 'checkbox' : control === 'radio' ? 'radio' : 'range';
      const expected = control === 'radio' ? 3 : options.showDisabled ? 2 : 1;
      expect(inputs.length, label).toBe(expected);
      for (const tag of inputs) {
        expect(tag, label).toContain(`type="${type}"`);
        expect(tag, label).toContain(`class="${CLASS_OF[control]}"`);
      }
    }
    if (control === 'radio') {
      // One group: a name shared by all three, so the arrow keys move between them.
      for (const tag of inputs) expect(tag, label).toContain('name="fc-choice"');
    }

    // The focus ring: a solid outline of at least 2 pixels, in every family, and no outline taken away anywhere.
    const focus = ruleOf(result.css, `.${CLASS_OF[control]}:focus-visible`);
    expect(focus, `${label} has no focus-visible rule`).not.toBeNull();
    const outline = /^(\d+(?:\.\d+)?)px solid #[0-9a-f]{6}$/.exec(focus!.outline ?? '');
    expect(outline, `${label}: outline is ${focus!.outline}`).not.toBeNull();
    expect(Number(outline![1]), label).toBeGreaterThanOrEqual(2);
    expect(result.css, label).not.toMatch(/outline(-style)?: (none|0)/);

    // appearance none only where the same rule draws the replacement.
    const base = ruleOf(result.css, `.${CLASS_OF[control]}`);
    expect(base, label).not.toBeNull();
    expect(base!.appearance, label).toBe('none');
    expect(base!['background-color'], label).toMatch(/^#[0-9a-f]{6}$/);
  }

  // Hand check of the switch at size 20: a 36 by 20 track, a 14 pixel thumb 3 pixels in, which travels 16 pixels.
  const sw = styleControls({ control: 'switch', preset: 'rounded', size: 20 });
  expect(ruleOf(sw.css, '.fc-switch')).toMatchObject({ width: '36px', height: '20px', 'border-radius': '10px' });
  expect(ruleOf(sw.css, '.fc-switch::before')).toMatchObject({
    width: '14px',
    height: '14px',
    top: '3px',
    left: '3px',
  });
  expect(ruleOf(sw.css, '.fc-switch:checked::before')?.transform).toBe('translateX(16px)');
  // The native check box carries a tick drawn by the checked rule, and the radio is round.
  const check = styleControls({ control: 'checkbox', preset: 'rounded', size: 20, radius: 6 });
  expect(ruleOf(check.css, '.fc-check')).toMatchObject({ width: '20px', height: '20px', 'border-radius': '6px' });
  expect(ruleOf(check.css, '.fc-check:checked::before')?.content).toBe('""');
  const radio = styleControls({ control: 'radio', preset: 'bold', size: 24 });
  expect(ruleOf(radio.css, '.fc-radio')).toMatchObject({ width: '24px', height: '24px', 'border-radius': '50%' });
  // A range track of 6 pixels under a 20 pixel thumb sits 7 pixels up.
  const range = styleControls({ control: 'range', preset: 'plain', size: 20 });
  expect(ruleOf(range.css, '.fc-range::-webkit-slider-runnable-track')?.height).toBe('6px');
  expect(ruleOf(range.css, '.fc-range::-webkit-slider-thumb')).toMatchObject({
    width: '20px',
    height: '20px',
    'margin-top': '-7px',
  });
  expect(ruleOf(range.css, '.fc-range::-moz-range-thumb')).toMatchObject({ width: '20px', height: '20px' });
});

it('the same options give byte-identical CSS and markup and rules come in a fixed order', () => {
  for (const { label, options } of everyCombination({ accent: '#be123c', background: '#fff7ed', text: 'Notify me' })) {
    const first = styleControls(options);
    // Other options in between, then the same options again, with the keys written in the opposite order.
    styleControls({ control: 'range', preset: 'bold', accent: '#000000', background: '#ffffff', text: 'Other' });
    const reversed = Object.fromEntries(Object.entries(options).reverse()) as StyleControlsOptions;
    const second = styleControls(reversed);
    expect(second.css, label).toBe(first.css);
    expect(second.markup, label).toBe(first.markup);
    expect(second.html, label).toBe(first.html);
    expect(second.warnings, label).toEqual(first.warnings);
    expect(first.html, label).toBe(`<style>${first.css}</style>${first.markup}`);

    // Base, hover, focus-visible, active, checked, disabled, then the reduced-motion block.
    const selectors = selectorsInOrder(first.css);
    const ranks = selectors.map(stateRank);
    expect(
      ranks.every((rank) => rank >= 0),
      `${label}: ${selectors.join(' | ')}`,
    ).toBe(true);
    expect(ranks, label).toEqual([...ranks].sort((a, b) => a - b));
    expect(first.css.split(REDUCED_PRELUDE).length, label).toBe(2);
  }

  // The writer sorts, so any order of the same rules gives the same text.
  const rules: ControlRule[] = [
    { selector: '.fc-switch:disabled', declarations: [['opacity', '0.5']] },
    { selector: '.fc-switch:checked::before', declarations: [['transform', 'translateX(16px)']] },
    { selector: '.fc-switch', declarations: [['appearance', 'none']] },
    { selector: '.fc-switch:focus-visible', declarations: [['outline', '3px solid #2563eb']] },
    { selector: '.fc-switch:hover', declarations: [['cursor', 'pointer']] },
    { selector: '.fc-switch::before', declarations: [['content', '""']] },
    { selector: '.fc-switch:checked', declarations: [['background-color', '#2563eb']] },
    { selector: '.fc-switch:active', declarations: [['cursor', 'pointer']] },
  ];
  const reduced: ControlRule[] = [{ selector: '.fc-switch::before', declarations: [['transition', 'none']] }];
  const forward = controlCss({ rules, reducedMotion: reduced });
  const backward = controlCss({ rules: [...rules].reverse(), reducedMotion: reduced });
  expect(backward).toBe(forward);
  expect(selectorsInOrder(forward)).toEqual([
    '.fc-switch',
    '.fc-switch::before',
    '.fc-switch:hover',
    '.fc-switch:focus-visible',
    '.fc-switch:active',
    '.fc-switch:checked',
    '.fc-switch:checked::before',
    '.fc-switch:disabled',
  ]);

  // A corner radius is read only where it is used, so it never changes anything else (the page hides the field there).
  for (const control of CONTROL_IDS) {
    for (const preset of PRESET_IDS) {
      const small = styleControls({ control, preset, radius: 2 });
      const large = styleControls({ control, preset, radius: 20 });
      const absurd = styleControls({ control, preset, radius: Number.NaN });
      if (usesRadius(control, preset)) {
        expect(large.css, `${control}/${preset}`).not.toBe(small.css);
        expect(
          absurd.warnings.some((w) => w.includes('Corner radius')),
          `${control}/${preset}`,
        ).toBe(true);
      } else {
        expect(large.css, `${control}/${preset}`).toBe(small.css);
        expect(absurd.css, `${control}/${preset}`).toBe(small.css);
        expect(absurd.warnings, `${control}/${preset}`).toEqual(small.warnings);
      }
    }
  }
  expect(usesRadius('button', 'plain')).toBe(false);
  expect(usesRadius('button', 'pill')).toBe(false);
  expect(usesRadius('switch', 'bold')).toBe(false);
  expect(usesRadius('radio', 'soft')).toBe(false);
  expect(usesRadius('checkbox', 'outline')).toBe(true);
});

it('colour pairs below 3 to 1 contrast are warned about and equal colours always are', () => {
  // WCAG 2.2 relative luminance: black on white is 21 to 1, #767676 on white is 4.54 to 1, #949494 on white is 3.03 to 1.
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
  expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
  expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  expect(contrastRatio('#949494', '#ffffff')).toBeCloseTo(3.03, 2);
  expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  expect(contrastRatio('#fff', '#FFFFFF')).toBe(1);

  const warns = (accent: string, background: string): string[] =>
    styleControls({ control: 'switch', accent, background }).warnings.filter((w) => w.includes('3 to 1'));

  expect(warns('#767676', '#ffffff')).toEqual([]);
  expect(warns('#949494', '#ffffff')).toEqual([]);
  expect(warns('#2563eb', '#ffffff')).toEqual([]);
  for (const [accent, background] of [
    ['#bbbbbb', '#ffffff'],
    ['#ffffff', '#ffffff'],
    ['#fff', '#ffffff'],
    ['#2563eb', '#2563eb'],
    ['#000000', '#000000'],
    ['#ffff00', '#ffffff'],
  ] as const) {
    const found = warns(accent, background);
    expect(found.length, `${accent} on ${background}`).toBe(1);
    expect(found[0], `${accent} on ${background}`).toContain('focus ring');
  }
  // The same pair warns for every control, and equal colours still draw every control with a visible focus ring.
  for (const control of CONTROL_IDS) {
    const result = styleControls({ control, accent: '#ffffff', background: '#ffffff' });
    expect(
      result.warnings.some((w) => w.includes('3 to 1')),
      control,
    ).toBe(true);
    const outline = ruleOf(result.css, `.${CLASS_OF[control]}:focus-visible`)?.outline ?? '';
    expect(outline, control).toMatch(/^3px solid #[0-9a-f]{6}$/);
    expect(outline, control).not.toContain('#ffffff');
  }
});

it('an empty label gets the default and label text is escaped in the markup and kept out of the CSS', () => {
  for (const control of CONTROL_IDS) {
    for (const text of ['', '   ', '\n\t']) {
      const result = styleControls({ control, text });
      expect(result.markup, `${control} ${JSON.stringify(text)}`).toContain('Option');
    }
    // Never an empty control name: a label or a button text is always present.
    expect(styleControls({ control, text: '' }).markup).not.toMatch(/><\/button>/);
    expect(styleControls({ control, text: '' }).markup).not.toMatch(/<\/label>\s*<\/label>/);
  }
  expect(styleControls({ control: 'button', text: '' }).markup).toContain('>Option</button>');

  // At most 40 characters, counted as characters (a letter outside the basic plane counts once).
  const long = styleControls({ control: 'checkbox', text: 'a'.repeat(60) });
  expect(long.markup).toContain(`> ${'a'.repeat(40)}</label>`);
  expect(long.markup).not.toContain('a'.repeat(41));
  const wide = styleControls({ control: 'button', text: '\u{1d4d0}'.repeat(45) });
  expect(wide.markup).toContain(`>${'\u{1d4d0}'.repeat(40)}</button>`);
  expect(wide.markup).not.toContain('\u{1d4d0}'.repeat(41));

  // Characters that mean something in HTML are written as text.
  const escaped = styleControls({ control: 'button', text: `<b>&"'` });
  expect(escaped.markup).toContain('>&lt;b&gt;&amp;&quot;&#39;</button>');
  expect(escaped.markup).not.toContain('<b>');
  // Control and bidirectional characters are replaced by a space, never kept.
  const hidden = styleControls({
    control: 'button',
    text: `a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x0007)}c${String.fromCodePoint(0x0085)}d`,
  });
  expect(hidden.markup).toContain('>a b c d</button>');

  // The label is only ever in the markup.
  const marker = 'FODT-LABEL-MARKER';
  for (const { label, options } of everyCombination({ text: marker })) {
    const result = styleControls(options);
    expect(result.css, label).not.toContain(marker);
    expect(result.markup, label).toContain(marker);
    for (const warning of result.warnings) expect(warning, label).not.toContain(marker);
  }
});

it('hostile field values leave no trace in the CSS and the safety scan refuses resource and escape constructs', () => {
  for (const hostile of HOSTILE_FIELD_VALUES) {
    for (const field of ['accent', 'background'] as const) {
      let message = '';
      try {
        styleControls({ [field]: hostile });
      } catch (err) {
        expect(err).toBeInstanceOf(FormControlError);
        message = (err as Error).message;
      }
      expect(message, `${field} ${hostile} was accepted`).not.toBe('');
      expect(message).not.toContain(hostile);
      expect(message).not.toContain('example.invalid');
      // A page whose colour box takes any text falls back to the default, with a warning that never repeats the text.
      const fallback = colourOrDefault(hostile, '#2563eb', 'Accent');
      expect(fallback.colour).toBe('#2563eb');
      expect(fallback.warning).not.toBeNull();
      expect(fallback.warning).not.toContain(hostile);
      expect(fallback.warning).not.toContain('example.invalid');
    }
    for (const field of ['control', 'preset'] as const) {
      expect(() => styleControls({ [field]: hostile })).toThrow(FormControlError);
    }
    // A label holding the hostile text is only ever HTML text: nothing reaches the CSS and no tag or comment opens.
    for (const control of CONTROL_IDS) {
      const result = styleControls({ control, text: hostile });
      for (const token of ['url(', '@import', 'image-set(', 'example.invalid', 'expression(', '</style']) {
        expect(result.css.toLowerCase(), `${control} ${hostile}`).not.toContain(token);
      }
      expect(result.markup, `${control} ${hostile}`).not.toMatch(/<script|<\/style|<!--/i);
      expect(result.html.match(/<style>/g)?.length, `${control} ${hostile}`).toBe(1);
      expect(result.css, `${control} ${hostile}`).not.toContain('<');
    }
  }
  // A colour with transparency is used opaque, with a warning; numbers that are not usable are clamped with a warning.
  const transparent = styleControls({ accent: '#2563eb80' });
  expect(transparent.warnings.some((w) => w.includes('Accent') && w.includes('transparency'))).toBe(true);
  expect(transparent.css).not.toMatch(/#[0-9a-f]{8}/);
  for (const size of [Number.NaN, Number.POSITIVE_INFINITY, -1e9, 1e9, -1]) {
    for (const radius of [Number.NaN, Number.NEGATIVE_INFINITY, -1e9, 1e9]) {
      const result = styleControls({ control: 'checkbox', preset: 'rounded', size, radius });
      expect(result.css).not.toMatch(/NaN|Infinity|\de[+-]?\d/);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(findUnsafeControlCss(result.css)).toBeNull();
    }
  }
  expect(styleControls({ control: 'checkbox', size: 1e9 }).css).toContain('width: 32px');
  expect(styleControls({ control: 'checkbox', size: -5 }).css).toContain('width: 12px');
  expect(styleControls({ control: 'checkbox', preset: 'rounded', radius: 1e9, size: 32 }).css).toContain(
    'border-radius: 16px',
  );

  // Every stylesheet the writer produces passes the scan.
  for (const { label, options } of everyCombination({ text: HOSTILE_FIELD_VALUES[9] })) {
    const result = styleControls(options);
    expect(findUnsafeControlCss(result.css), label).toBeNull();
  }

  // The scan refuses a resource function, an import, an escape, a script expression, a comment, an unknown name.
  const good = '.fc-button:hover {\n  color: #ffffff;\n}';
  expect(findUnsafeControlCss(good)).toBeNull();
  const refused = [
    '.fc-button {\n  background-color: url(https://example.invalid/x);\n}',
    '.fc-button {\n  background-color: URL (https://example.invalid/x);\n}',
    '@import url(https://example.invalid/x);',
    '.fc-button {\n  content: "\\";\n}',
    '.fc-button {\n  width: expression(alert(1));\n}',
    '.fc-button {\n  behavior: url(x);\n}',
    '/* x */ .fc-button {\n  color: #ffffff;\n}',
    '.fc-button {\n  color: #ffffff !important;\n}',
    '.evil {\n  color: #ffffff;\n}',
    'button {\n  color: #ffffff;\n}',
    '.fc-button:visited {\n  color: #ffffff;\n}',
    '.fc-button::after {\n  color: #ffffff;\n}',
    '.fc-button, .evil {\n  color: #ffffff;\n}',
    '.fc-button .fc-switch {\n  color: #ffffff;\n}',
    '.fc-button[type] {\n  color: #ffffff;\n}',
    '.fc-button {\n  color: #ffffff;\n}\n@media (min-width: 10px) {\n.fc-button {\n  color: #ffffff;\n}\n}',
    '@font-face {\n  font-family: x;\n}',
    '.fc-button {\n  color: #ffffff\n',
    '.fc-button {\n  color: red; background: blue;\n}',
  ];
  for (const text of refused) {
    expect(findUnsafeControlCss(text), JSON.stringify(text)).not.toBeNull();
  }
  // The writer refuses the same things before it writes anything.
  expect(() => controlCss({ rules: [{ selector: '.evil', declarations: [['color', '#ffffff']] }] })).toThrow();
  expect(() =>
    controlCss({ rules: [{ selector: '.fc-button:visited', declarations: [['color', '#ffffff']] }] }),
  ).toThrow();
  expect(() =>
    controlCss({ rules: [{ selector: '.fc-button', declarations: [['background-color', 'url(x)']] }] }),
  ).toThrow();
  expect(() => controlCss({ rules: [{ selector: '.fc-button', declarations: [['behavior', 'none']] }] })).toThrow();
  expect(() =>
    controlCss({ rules: [{ selector: '.fc-button', declarations: [['color', '#fff; background: red']] }] }),
  ).toThrow();
  expect(ALLOWED_SELECTORS).toEqual(['.fc-surface', '.fc-button', '.fc-switch', '.fc-check', '.fc-radio', '.fc-range']);
});

it('the CSS turns off transitions under the exact reduced-motion prelude', () => {
  for (const { label, options } of everyCombination()) {
    const css = styleControls(options).css;
    const at = css.indexOf(REDUCED_PRELUDE);
    expect(at, label).toBeGreaterThan(0);
    // Exactly one block, written last, closed by a final brace.
    expect(css.indexOf(REDUCED_PRELUDE, at + 1), label).toBe(-1);
    expect(css.endsWith('\n}'), label).toBe(true);
    const block = css.slice(at + REDUCED_PRELUDE.length);
    expect(block, label).toContain('transition: none');
    expect(block, label).not.toMatch(/transition: [^n]/);

    // Every rule that has a transition has a matching rule in the block that removes it.
    const outside = css.slice(0, at);
    const withTransition = outside
      .split('\n}\n')
      .map((rule) => rule.trim())
      .filter((rule) => /\n {2}transition: /.test(rule))
      .map((rule) => rule.slice(0, rule.indexOf(' {')));
    expect(withTransition.length, label).toBeGreaterThan(0);
    for (const selector of withTransition) {
      expect(block, `${label}: ${selector} keeps its transition`).toContain(`${selector} {\n  transition: none;\n}`);
    }
  }
  // The shape of the block, for the switch: the track and the thumb.
  const sw = styleControls({ control: 'switch' }).css;
  expect(sw.slice(sw.indexOf(REDUCED_PRELUDE))).toBe(
    `${REDUCED_PRELUDE}\n.fc-switch {\n  transition: none;\n}\n\n.fc-switch::before {\n  transition: none;\n}\n}`,
  );
});

it('control and preset names are looked up safely for __proto__, constructor and toString', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(CONTROLS.has(name), name).toBe(false);
    expect(PRESETS.has(name), name).toBe(false);
    expect(() => styleControls({ control: name }), name).toThrow(FormControlError);
    expect(() => styleControls({ preset: name }), name).toThrow(FormControlError);
    expect(() => styleControls({ control: name }), name).toThrow(/choices on offer/);
  }
  // A name that is not a string is refused the same way, and the message never echoes it.
  expect(() => styleControls({ control: 5 as unknown as string })).toThrow(FormControlError);
});

it('css-safe.ts is the canonical copy', () => {
  const bytes = readFileSync(new URL('../src/css-safe.ts', import.meta.url));
  expect(createHash('md5').update(bytes).digest('hex')).toBe('ad0bffed52987b6b331c6d39227b080f');
});

it('nothing is written to the console while styling controls', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
  try {
    for (const { options } of everyCombination({ text: 'Note' })) styleControls(options);
    try {
      styleControls({ accent: 'not a colour' });
    } catch {
      // The refusal is a thrown error, never a log line.
    }
    colourOrDefault('x', '#2563eb', 'Accent');
    findUnsafeControlCss('.evil {}');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
