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
