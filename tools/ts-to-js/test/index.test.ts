import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripTypes } from '../src/index';
import { NEVER_RUN_JS, NEVER_RUN_TS, assertNeverRan } from './never-evaluates';

const HERE = dirname(fileURLToPath(import.meta.url));

it('type annotations, interfaces and type aliases are erased as the TypeScript handbook Erased Types section describes', () => {
  // TypeScript Handbook, "TypeScript for JavaScript Programmers", Erased
  // Types section's own example:
  //   function greet(person: string, date: Date) {
  //     console.log(`Hello ${person}, today is ${date.toDateString()}!`);
  //   }
  // becomes, after type erasure:
  //   function greet(person, date) {
  //     console.log(`Hello ${person}, today is ${date.toDateString()}!`);
  //   }
  const source = `interface Greeting { person: string }
type Greeter = (person: string, date: Date) => void;
function greet(person: string, date: Date) {
  console.log(\`Hello \${person}, today is \${date.toDateString()}!\`);
}`;
  const { output, diagnostics } = stripTypes(source);
  expect(diagnostics).toEqual([]);
  expect(output).toContain('function greet(person, date)');
  expect(output).not.toContain('interface');
  expect(output).not.toContain(': string');
  expect(output).not.toContain('type Greeter');
});

it('enums and namespaces become JavaScript because they exist at run time', () => {
  const source = `enum Color { Red, Green, Blue }
namespace Shapes { export const kind = 'circle'; }`;
  const { output, diagnostics } = stripTypes(source);
  expect(diagnostics).toEqual([]);
  // The enum and namespace are run-time constructs: the emitted JS defines
  // them (an IIFE or an object assignment), not merely erases them.
  expect(output).toContain('Color');
  expect(output).toMatch(/Color\s*=|var Color/);
  expect(output).toContain('Shapes');
});

it('a syntax error is reported with its line and column', () => {
  const source = 'function f() {\n  let x: = 1;\n}';
  const { output, diagnostics } = stripTypes(source);
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics[0]!.line).toBe(2);
  expect(typeof diagnostics[0]!.column).toBe('number');
  expect(diagnostics[0]!.column).toBeGreaterThan(0);
  // The output still shows, even with a diagnostic present.
  expect(typeof output).toBe('string');
  expect(output.length).toBeGreaterThan(0);
});

it('the chosen target, module format and JSX mode change the emitted JavaScript', () => {
  // Nullish coalescing (ES2020+) is downlevelled to a temporary-variable
  // pattern for an ES2015 target, but passes through unchanged for ESNext --
  // a real target-dependent rewrite, unlike an enum's IIFE shape which does
  // not vary by target.
  const nullishSource = 'const y: number = a ?? b;';
  const es2015 = stripTypes(nullishSource, { target: 'ES2015' });
  const esNext = stripTypes(nullishSource, { target: 'ESNext' });
  expect(es2015.output).not.toBe(esNext.output);
  expect(esNext.output).toContain('??');
  expect(es2015.output).not.toContain('??');

  const esmSource = 'export const x = 1;';
  const preserved = stripTypes(esmSource, { module: 'preserve' });
  const commonjs = stripTypes(esmSource, { module: 'commonjs' });
  expect(preserved.output).toContain('export');
  expect(commonjs.output).toContain('exports');

  const jsxSource = 'const el = <div>hi</div>;';
  const preservedJsx = stripTypes(jsxSource, { jsx: 'preserve' });
  const reactJsx = stripTypes(jsxSource, { jsx: 'react-jsx' });
  const classicReact = stripTypes(jsxSource, { jsx: 'react' });
  expect(preservedJsx.output).toContain('<div>');
  expect(reactJsx.output).not.toContain('<div>');
  expect(classicReact.output).not.toContain('<div>');
  expect(reactJsx.output).not.toBe(classicReact.output);
});

it('stripping types never runs the pasted code', async () => {
  await assertNeverRan(() => stripTypes(NEVER_RUN_TS));
});

it('the never-runs check itself catches code that does run the payload', async () => {
  await expect(
    assertNeverRan(() => {
      // Deliberately proving assertNeverRan detects real execution; never done in package source.
      new Function(NEVER_RUN_JS)();
    }),
  ).rejects.toThrow();
});

it('the typescript dependency stays on the 5.x line', () => {
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const range = pkg.dependencies?.typescript;
  expect(range, 'ts-to-js must declare typescript as a runtime dependency').toBeDefined();
  expect(range!.startsWith('^5.')).toBe(true);

  const installed = JSON.parse(
    readFileSync(join(HERE, '..', 'node_modules', 'typescript', 'package.json'), 'utf8'),
  ) as { version: string };
  expect(installed.version.split('.')[0]).toBe('5');
});

it('nothing is written to the console while transpiling', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  try {
    stripTypes('function greet(person: string, date: Date) {}');
    stripTypes('let x: = 1;');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
