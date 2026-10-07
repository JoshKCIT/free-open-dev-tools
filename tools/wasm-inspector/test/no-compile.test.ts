import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * The lines of a source text that reach the WebAssembly object with a member or an index, generate code, or import at run
 * time (D-232: the module is never compiled, validated or instantiated). Comments are checked too: no line, comment
 * included, may name a member of the WebAssembly object.
 */
function problemsIn(text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    const at = `line ${index + 1}`;
    if (/WebAssembly\s*[.[]/.test(line)) found.push(`${at} names a member of the WebAssembly object`);
    if (/\bnew\s+Function\b/.test(line)) found.push(`${at} makes a function from text`);
    if (/\beval\s*\(/.test(line)) found.push(`${at} calls eval`);
    if (/\bimport\s*\(/.test(line)) found.push(`${at} imports at run time`);
  });
  return found;
}

it('the source never touches the WebAssembly object, never generates code and never imports at run time', () => {
  // The detector can fail: each of these lines is found, and ordinary words are not.
  expect(problemsIn('const m = WebAssembly.compile(bytes);')).toHaveLength(1);
  expect(problemsIn("const m = WebAssembly['Module'];")).toHaveLength(1);
  expect(problemsIn('const f = new Function("return 1");')).toHaveLength(1);
  expect(problemsIn('const x = eval("1");')).toHaveLength(1);
  expect(problemsIn("const m = await import('./other');")).toHaveLength(1);
  expect(problemsIn('The WebAssembly binary format, read here; never run.')).toEqual([]);
  expect(problemsIn("import { Cursor } from './cursor';")).toEqual([]);

  // The real sources: every .ts file under src, none skipped.
  const files = readdirSync(SRC).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
  expect(files.length, 'the package has source files').toBeGreaterThan(3);
  const all: string[] = [];
  for (const name of files) {
    for (const problem of problemsIn(readFileSync(join(SRC, name), 'utf8'))) all.push(`${name}: ${problem}`);
  }
  expect(all).toEqual([]);
});
