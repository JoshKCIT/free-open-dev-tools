import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as babelParse } from '@babel/parser';
import ts from 'typescript';
import { convertToJsx, JsxConverterError } from '../src/index';
import { REACT_ATTRIBUTE_NAMES } from '../src/react-attribute-names';
import { SVG_TAG_NAMES } from '../src/svg-tag-names';
import { NEVER_RUN_MARKUP, assertNeverRan } from './never-evaluates';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');

// --- Fixture re-readers: line-pattern parsing, never importing or running --

/** Reads the vendored React source file by matching `key: 'Value',` and `'quoted-key': 'Value',` lines, never importing it. */
function readReactFixturePairs(): [string, string][] {
  const text = readFileSync(join(PACKAGE_ROOT, 'test/fixtures/react-dom-names/possibleStandardNames.js'), 'utf8');
  const re = /^\s*(?:'([^']+)'|([A-Za-z0-9]+)):\s*'([^']+)',?\s*$/;
  const pairs: [string, string][] = [];
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) pairs.push([(m[1] ?? m[2])!, m[3]!]);
  }
  return pairs;
}

/** Reads the vendored WHATWG table by matching `<td> <code>a</code>` pairs, never parsing full HTML. */
function readWhatwgFixturePairs(): [string, string][] {
  const text = readFileSync(join(PACKAGE_ROOT, 'test/fixtures/whatwg-svg-tag-names/svg-tag-names-table.html'), 'utf8');
  const codes = [...text.matchAll(/<code>([A-Za-z]+)<\/code>/g)].map((m) => m[1]!);
  const pairs: [string, string][] = [];
  for (let i = 0; i < codes.length; i += 2) pairs.push([codes[i]!, codes[i + 1]!]);
  return pairs;
}

const TMP_ROOT = join(PACKAGE_ROOT, 'node_modules', '.jsx-converter-ts-check');
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Type-checks `source` against the installed `typescript` compiler in strict
 * mode with `@types/react` resolvable. The temp file is written inside this
 * package's own `node_modules/` (gitignored either way) so TypeScript's
 * ordinary upward `node_modules/@types` search finds `@types/react` without
 * any custom `typeRoots`.
 */
function typeCheck(source: string, fileName: string): readonly ts.Diagnostic[] {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'check-'));
  tmpDirs.push(dir);
  const filePath = join(dir, fileName);
  writeFileSync(filePath, source, 'utf8');

  const program = ts.createProgram([filePath], {
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  });
  return ts.getPreEmitDiagnostics(program);
}

it('class, for, style and SVG attributes become the React prop names React DOM itself lists', () => {
  const { output, warnings } = convertToJsx('<label for="x" class="y">A</label>');
  expect(warnings).toEqual([]);
  expect(output).toContain('htmlFor="x"');
  expect(output).toContain('className="y"');

  const svgResult = convertToJsx(
    '<svg viewbox="0 0 1 1"><lineargradient id="g"/><rect stroke-width="2" xlink:href="#g"/></svg>',
  );
  expect(svgResult.output).toContain('viewBox="0 0 1 1"');
  expect(svgResult.output).toContain('<linearGradient');
  expect(svgResult.output).toContain('strokeWidth="2"');
  expect(svgResult.output).toContain('xlinkHref="#g"');
});

it('the React attribute table equals the vendored React source file', () => {
  const pairs = readReactFixturePairs();
  expect(pairs.length).toBeGreaterThan(0);
  expect(Object.keys(REACT_ATTRIBUTE_NAMES).length).toBe(pairs.length);
  for (const [key, value] of pairs) {
    expect(REACT_ATTRIBUTE_NAMES[key], `key "${key}"`).toBe(value);
  }
});

it('SVG element names get the camel case the HTML Living Standard parser table gives', () => {
  const pairs = readWhatwgFixturePairs();
  expect(pairs.length).toBeGreaterThan(0);
  expect(Object.keys(SVG_TAG_NAMES).length).toBe(pairs.length);
  for (const [key, value] of pairs) {
    expect(SVG_TAG_NAMES[key], `key "${key}"`).toBe(value);
  }
});

it('inline style strings become style objects with camel-cased properties and custom properties kept', () => {
  const { output } = convertToJsx('<div style="background-color: red; --gap: 4px">hi</div>');
  expect(output).toContain("style={{ backgroundColor: 'red', '--gap': '4px' }}");

  const vendor = convertToJsx('<div style="-webkit-transform: scale(1); -ms-flex: 1">hi</div>');
  expect(vendor.output).toContain("WebkitTransform: 'scale(1)'");
  expect(vendor.output).toContain("msFlex: '1'");
});

it('event handler attributes and script elements are dropped with a warning and never become code', () => {
  const { output, warnings } = convertToJsx('<button onclick="go()">Go</button><script>evil()</script>');
  expect(output).not.toContain('onclick');
  expect(output).not.toContain('go()');
  expect(output).not.toContain('<script');
  expect(output).not.toContain('evil()');
  expect(warnings.some((w) => w.includes('onclick'))).toBe(true);
  expect(warnings.some((w) => /script element/.test(w))).toBe(true);
});

it('converting markup never runs the pasted code', async () => {
  await assertNeverRan(() => convertToJsx(NEVER_RUN_MARKUP, { output: 'jsx' }));
  await assertNeverRan(() => convertToJsx(NEVER_RUN_MARKUP, { output: 'component' }));
  await assertNeverRan(() => convertToJsx(NEVER_RUN_MARKUP, { output: 'typescript' }));
});

it('text with braces, comments and multiple root elements produce valid JSX', () => {
  const { output } = convertToJsx('<p>{a}</p><!-- c --><p>b</p>');
  expect(output).toContain("{'{'}a{'}'}");
  expect(output).toContain('{/* c */}');
  expect(output.trim().startsWith('<>')).toBe(true);
  expect(output.trim().endsWith('</>')).toBe(true);
  expect(() => babelParse(output, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow();
});

it('every output parses as JSX or TSX with the Babel parser', () => {
  const markup = '<div class="a"><span style="color: red">hi &amp; bye</span><br></div>';
  for (const output of ['jsx', 'component', 'typescript'] as const) {
    const { output: text } = convertToJsx(markup, { output, componentName: 'Sample' });
    expect(() =>
      babelParse(text, { sourceType: 'module', plugins: output === 'typescript' ? ['jsx', 'typescript'] : ['jsx'] }),
    ).not.toThrow();
  }
});

it('the typed component compiles under the TypeScript compiler with React types in strict mode', () => {
  const { output } = convertToJsx('<div class="a"><span>hi</span></div>', {
    output: 'typescript',
    componentName: 'Sample',
  });
  const diagnostics = typeCheck(output, 'sample.tsx');
  const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  expect(messages, messages.join('\n')).toEqual([]);
});

it('nothing is written to the console while converting', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  try {
    convertToJsx('<div class="a" style="color: red" onclick="go()"><script>x()</script><span>hi</span></div>', {
      output: 'typescript',
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('an unparsable component name falls back to Markup with a warning', () => {
  const { output, warnings } = convertToJsx('<div>hi</div>', { output: 'component', componentName: '123 not valid' });
  expect(output).toContain('function Markup(');
  expect(warnings.some((w) => w.includes('Markup'))).toBe(true);
});

it('throws JsxConverterError for markup that cannot be parsed at all', () => {
  // htmlparser2's tolerant tokeniser accepts nearly anything as text/tags, so
  // this only proves the error class exists and is thrown for the one input
  // shape this package itself refuses: no content at all.
  expect(() => convertToJsx('')).toThrow(JsxConverterError);
});
