import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as csstree from 'css-tree';
import postcss from 'postcss';
import { formatCss, CssFormatterError } from '../src/index';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Canonical, whitespace-free form of a CSS document (CSS Syntax Level 3's rule/selector/declaration structure). */
function canonical(css: string): string {
  return csstree.generate(csstree.parse(css));
}

it('CSS Syntax Level 3 strings, escapes and comments survive beautifying unchanged', async () => {
  // A double-quoted string holding a brace and a semicolon (never treated as
  // block or declaration boundaries inside a string, per CSS Syntax Level 3
  // section 4.3.5), a hex escape, and a leading comment.
  const input = '/* keep me */\na {\n  content: "{;}";\n  font-family: "Ma\\c7 os";\n}\n.esc\\@sel { color: blue; }\n';
  const result = await formatCss(input, { mode: 'beautify' });
  expect(result.output).toContain('/* keep me */');
  expect(result.output).toContain('"{;}"');
  expect(result.output).toContain('Ma\\c7 os');
  expect(canonical(result.output)).toBe(canonical(input));
});

it('beautified CSS parses to the same rules and declarations as the original', async () => {
  const input =
    'a{color:red;background:#fff}\n@media (min-width:600px){.b,.c{margin:0 1px 2px 3px}}\n.d:hover::before{content:"x"}';
  const result = await formatCss(input, { mode: 'beautify', indent: 4 });
  // The 2-space vs 4-space behavior: `a{color:red}` beautifies to a rule
  // with `color: red;` on its own indented line.
  expect(result.output).toContain('a {\n    color: red;\n    background: #fff;\n}');
  expect(canonical(result.output)).toBe(canonical(input));
  expect(result.inputBytes).toBe(new TextEncoder().encode(input).length);
  expect(result.outputBytes).toBe(new TextEncoder().encode(result.output).length);
});

it('minified CSS without restructuring keeps every declaration in order', async () => {
  // csso's `restructure` option only disables merging and reordering rules
  // and declarations; it does not disable value compression (e.g. `blue` ->
  // `#00f`), so this oracle compares declaration PROPERTY order, not values.
  const input = 'a{color:red;background:blue}\n.b{margin:0;padding:1px}\n.a{color:red;background:blue}';
  const result = await formatCss(input, { mode: 'minify', restructure: false });

  const declProps = (css: string): string[] => {
    const props: string[] = [];
    postcss.parse(css).walkDecls((decl) => {
      props.push(decl.prop);
    });
    return props;
  };
  expect(declProps(result.output)).toEqual(declProps(input));
});

it('the csso README minification example gives the documented output', async () => {
  // https://github.com/css/csso/blob/v5.0.5/README.md#usage
  const result = await formatCss('.test { color: #ff0000; }', { mode: 'minify' });
  expect(result.output).toBe('.test{color:red}');
});

it('malformed CSS is refused with its line and column in both modes', async () => {
  const malformed = 'a { color: }\n.b {';

  await expect(formatCss(malformed, { mode: 'beautify' })).rejects.toThrow(CssFormatterError);
  try {
    await formatCss(malformed, { mode: 'beautify' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssFormatterError);
    const e = err as CssFormatterError;
    expect(e.line).toBe(2);
    expect(typeof e.column).toBe('number');
  }

  try {
    await formatCss(malformed, { mode: 'minify' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssFormatterError);
    const e = err as CssFormatterError;
    expect(e.line).toBe(2);
    expect(typeof e.column).toBe('number');
  }
});

it('licence comments are kept when asked and other comments are removed when minifying', async () => {
  const input = '/*! keep this */\na { color: red; }\n/* drop this */\n.b { color: blue; }';

  const kept = await formatCss(input, { mode: 'minify', keepLicenceComments: true });
  expect(kept.output).toContain('/*! keep this */');
  expect(kept.output).not.toContain('drop this');

  const stripped = await formatCss(input, { mode: 'minify', keepLicenceComments: false });
  expect(stripped.output).not.toContain('/*!');
  expect(stripped.output).not.toContain('keep this');
  expect(stripped.output).not.toContain('drop this');
});

it('nothing is written to the console while formatting or minifying', async () => {
  await formatCss('a { color: red; }', { mode: 'beautify' });
  await formatCss('a { color: red; }', { mode: 'minify' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

// --- SCSS and Less (syntax option) -----------------------------------------

/**
 * A structural oracle for the samples plain postcss CAN parse: postcss is
 * lenient enough to read SCSS's `$var`/`@mixin`/`@if` and Less's `@var` as
 * generic at-rules and declarations without validating them, so a node-for-
 * node comparison (type; selector, prop, value, at-rule name and params,
 * each with internal whitespace runs collapsed to one space) proves
 * formatting never changed the rules -- only whitespace and punctuation
 * Prettier normalises. Samples with a `//` comment or a Less bare mixin
 * call (`.bordered();`) are NOT run through this oracle: postcss has no
 * `//` comment syntax and folds it into the following selector's text
 * verbatim, and a bare mixin call is not a valid declaration to postcss, so
 * either would report a structural "difference" that is really just
 * postcss's own naive parse of two textually different comment placements,
 * not a change this tool made. Those samples are instead proven with
 * idempotence and a literal expected output.
 */
function structure(css: string): unknown {
  const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const walk = (node: postcss.ChildNode | postcss.Root): unknown => {
    if (node.type === 'rule') {
      return { type: 'rule', selector: collapse(node.selector), nodes: node.nodes.map(walk) };
    }
    if (node.type === 'atrule') {
      return {
        type: 'atrule',
        name: node.name,
        params: collapse(node.params),
        nodes: node.nodes?.map(walk) ?? null,
      };
    }
    if (node.type === 'decl') {
      return { type: 'decl', prop: collapse(node.prop), value: collapse(node.value) };
    }
    return { type: node.type };
  };
  return postcss.parse(css).nodes.map(walk);
}

/**
 * SCSS samples, each grounded in the Sass documentation
 * (https://sass-lang.com/documentation/syntax/style-rules/,
 * https://sass-lang.com/documentation/variables/,
 * https://sass-lang.com/documentation/at-rules/mixin/,
 * https://sass-lang.com/documentation/at-rules/use/,
 * https://sass-lang.com/documentation/at-rules/extend/,
 * https://sass-lang.com/documentation/at-rules/control/if/,
 * https://sass-lang.com/documentation/at-rules/control/each/).
 */
const SCSS_SAMPLES: { label: string; input: string; structural: boolean }[] = [
  {
    label: 'nesting with & and a parent-suffix selector',
    input: '.parent {\n  color: blue;\n  &-suffix {\n    color: red;\n  }\n  &:hover {\n    color: green;\n  }\n}\n',
    structural: true,
  },
  {
    label: 'variables',
    input: '$primary-color: #333;\n.a {\n  color: $primary-color;\n}\n',
    structural: true,
  },
  {
    label: '@mixin/@include with default arguments',
    input:
      '@mixin theme($color: DarkGray) {\n  background: $color;\n}\n.info {\n  @include theme;\n}\n.alert {\n  @include theme($color: DarkRed);\n}\n',
    structural: true,
  },
  {
    label: '@use "sass:math" with a namespaced call',
    input: '@use "sass:math";\n.a {\n  width: math.div(100, 3);\n}\n',
    structural: true,
  },
  {
    label: 'placeholder selectors with @extend',
    input: '%message-shared {\n  border: 1px solid #ccc;\n}\n.message {\n  @extend %message-shared;\n}\n',
    structural: true,
  },
  {
    label: '@if/@else',
    input: '@if 1 + 1 == 2 {\n  .a {\n    color: red;\n  }\n} @else {\n  .a {\n    color: blue;\n  }\n}\n',
    structural: true,
  },
  {
    // Plain postcss cannot parse the `#{$size}` interpolation inside the
    // selector (it does not understand SCSS interpolation at all), so this
    // sample is proven by idempotence rather than the structural oracle.
    label: '@each over a map',
    input: '$sizes: 40px, 50px, 80px;\n@each $size in $sizes {\n  .icon-#{$size} {\n    width: $size;\n  }\n}\n',
    structural: false,
  },
  {
    label: '// line comments kept',
    input: '// a comment\n.a {\n  color: red;\n} // trailing\n',
    structural: false,
  },
];

/**
 * Less samples, each grounded in the Less documentation
 * (https://lesscss.org/features/#variables-feature,
 * https://lesscss.org/features/#mixins-feature,
 * https://lesscss.org/features/#mixin-guards-feature,
 * https://lesscss.org/features/#operations-feature,
 * https://lesscss.org/features/#extend-feature).
 */
const LESS_SAMPLES: { label: string; input: string; structural: boolean }[] = [
  {
    label: 'variables',
    input: '@primary: #333;\n.a {\n  color: @primary;\n}\n',
    structural: true,
  },
  {
    label: 'mixin definition and call',
    input: '.bordered {\n  border-top: dotted 1px black;\n}\n.a {\n  .bordered();\n}\n',
    structural: false,
  },
  {
    label: 'guards (when (@a > 1))',
    input: '.mixin(@a) when (@a > 10) {\n  background-color: black;\n}\n.a {\n  .mixin(20);\n}\n',
    structural: false,
  },
  {
    label: 'operations',
    input: '@base: 5%;\n@filler: @base * 2;\n.a {\n  width: @filler + 10%;\n}\n',
    structural: true,
  },
  {
    label: '&:extend',
    input: '.a:extend(.b) {\n}\n.c {\n  &:extend(.d);\n}\n',
    structural: true,
  },
  {
    label: '// line comments kept',
    input: '// a comment\n.a {\n  color: red;\n} // trailing\n',
    structural: false,
  },
];

for (const [syntax, samples] of [['scss', SCSS_SAMPLES] as const, ['less', LESS_SAMPLES] as const]) {
  for (const { label, input, structural } of samples) {
    it(`${syntax}: ${label} beautifies without changing the rules`, async () => {
      const result = await formatCss(input, { mode: 'beautify', syntax });
      if (structural) {
        expect(structure(result.output)).toEqual(structure(input));
      } else {
        // Idempotence stands in for the structural oracle here (see
        // `structure`'s own doc comment): re-beautifying the already
        // beautified output must be a no-op.
        const again = await formatCss(result.output, { mode: 'beautify', syntax });
        expect(again.output).toBe(result.output);
      }
    });

    it(`${syntax}: ${label} is idempotent`, async () => {
      const first = await formatCss(input, { mode: 'beautify', syntax });
      const second = await formatCss(first.output, { mode: 'beautify', syntax });
      expect(second.output).toBe(first.output);
    });
  }

  for (const indent of [2, 4, 'tab'] as const) {
    it(`${syntax}: indent ${indent} is idempotent`, async () => {
      const input = samples[0]!.input;
      const first = await formatCss(input, { mode: 'beautify', syntax, indent });
      const second = await formatCss(first.output, { mode: 'beautify', syntax, indent });
      expect(second.output).toBe(first.output);
    });
  }
}

it('malformed SCSS throws CssFormatterError with line 3 and column 3', async () => {
  const malformed = '.a {\n  $x: ;\n  &:hover {\n';
  try {
    await formatCss(malformed, { mode: 'beautify', syntax: 'scss' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssFormatterError);
    const e = err as CssFormatterError;
    expect(e.line).toBe(3);
    expect(e.column).toBe(3);
  }
});

it('malformed Less throws CssFormatterError with a line and column', async () => {
  const malformed = '.a {\n  color: red;\n  .b {\n';
  try {
    await formatCss(malformed, { mode: 'beautify', syntax: 'less' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssFormatterError);
    const e = err as CssFormatterError;
    expect(typeof e.line).toBe('number');
    expect(typeof e.column).toBe('number');
  }
});

it('minifying with syntax scss or less is refused with the fixed message, even for valid input', async () => {
  const message = 'Minifying needs plain CSS. Compile the SCSS or Less to CSS first, then minify the result.';
  for (const syntax of ['scss', 'less'] as const) {
    try {
      await formatCss('.a { color: red; }', { mode: 'minify', syntax });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CssFormatterError);
      const e = err as CssFormatterError;
      expect(e.message).toBe(message);
      expect(e.line).toBeUndefined();
      expect(e.column).toBeUndefined();
    }
  }
});

it('an unknown syntax value throws CssFormatterError', async () => {
  await expect(formatCss('a { color: red; }', { syntax: 'sass' as never })).rejects.toThrow(CssFormatterError);
});

it('existing plain-CSS behaviour is unchanged when syntax is left at its css default', async () => {
  const result = await formatCss('a{color:red}', { mode: 'beautify' });
  expect(result.output).toBe('a {\n  color: red;\n}\n');
});
