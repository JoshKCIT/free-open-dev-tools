import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { inspect } from '../src/index';
import { extractModules, type WastModule } from './wast';

/*
 * The binary format cases of the WebAssembly testsuite (Apache-2.0), vendored byte for byte under test/fixtures/testsuite
 * at commit b464a4cd100d98175ae6e3890db89a2e6c8302f7 (see UPSTREAM.md there). Only two forms are used: the
 * `(module binary ...)` modules, which are valid and must read with no finding, and the `assert_malformed (module
 * binary ...)` modules, which the suite says are malformed binaries.
 *
 * The reader reads the structure of a module and measures function bodies without decoding them (D-236 e), so a malformed
 * module whose fault is inside a function body is not flagged. Those are listed below by file, index (the position among
 * the binary modules of that file) and the message the suite states: never skipped silently. The list is exactly what
 * stays unflagged, so a module that begins to be flagged, or one that stops, fails the test.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'testsuite');
const FILES = [
  'binary.wast',
  'binary0.wast',
  'binary-leb128.wast',
  'binary_leb128_64.wast',
  'binary-gc.wast',
  'custom.wast',
];
const COMMIT = 'b464a4cd100d98175ae6e3890db89a2e6c8302f7';

interface Unflagged {
  file: string;
  index: number;
  message: string;
}

/** Faults inside function bodies (instruction immediates, a missing end, an opcode that does not exist), and two that need an instruction to tell. */
const BODY_LEVEL_FAULTS: readonly Unflagged[] = [
  { file: 'binary.wast', index: 37, message: 'END opcode expected' },
  { file: 'binary.wast', index: 38, message: 'unexpected end of section or function' },
  { file: 'binary.wast', index: 39, message: 'section size mismatch' },
  { file: 'binary.wast', index: 56, message: 'data count section required' },
  { file: 'binary.wast', index: 57, message: 'data count section required' },
  { file: 'binary.wast', index: 101, message: 'unexpected end of section or function' },
  { file: 'binary.wast', index: 126, message: 'illegal opcode ff' },
  { file: 'binary-leb128.wast', index: 41, message: 'integer representation too long' },
  { file: 'binary-leb128.wast', index: 42, message: 'integer representation too long' },
  { file: 'binary-leb128.wast', index: 67, message: 'integer too large' },
  { file: 'binary-leb128.wast', index: 68, message: 'integer too large' },
  { file: 'binary-leb128.wast', index: 69, message: 'integer too large' },
  { file: 'binary-leb128.wast', index: 70, message: 'integer too large' },
  { file: 'binary-leb128.wast', index: 82, message: 'integer representation too long' },
  { file: 'binary_leb128_64.wast', index: 1, message: 'integer too large' },
];

function modulesOf(file: string): WastModule[] {
  return extractModules(readFileSync(join(DIR, file), 'utf8'));
}

function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

it('the vendored testsuite files are the bytes of the blobs UPSTREAM.md names', () => {
  const upstream = readFileSync(join(DIR, 'UPSTREAM.md'), 'utf8');
  expect(upstream).toContain(COMMIT);
  for (const name of [...FILES, 'LICENSE']) {
    const bytes = readFileSync(join(DIR, name));
    const sha = gitBlobSha(bytes);
    expect(upstream, `${name} has blob sha ${sha}`).toContain(`\`${sha}\``);
    expect(upstream, `${name} has ${bytes.length} bytes`).toContain(bytes.length.toLocaleString('en-US'));
  }
  expect(readFileSync(join(DIR, 'LICENSE'), 'utf8')).toMatch(/Apache License\s+Version 2\.0/);
});

it('the 62 binary modules of the WebAssembly testsuite read with no finding', () => {
  let count = 0;
  const bad: string[] = [];
  for (const file of FILES) {
    for (const row of modulesOf(file).filter((module) => module.kind === 'valid')) {
      count++;
      const report = inspect(row.bytes);
      if (report.kind !== 'module' || report.findings.length > 0 || report.findingsLeftOut > 0) {
        bad.push(`${file} #${row.index}: ${report.kind} ${report.sentence ?? report.findings[0]?.message ?? ''}`);
      }
    }
  }
  expect(bad).toEqual([]);
  expect(count).toBe(62);
});

it('the malformed binary modules of the testsuite are flagged except the listed function body faults', () => {
  let malformed = 0;
  const unflagged: Unflagged[] = [];
  for (const file of FILES) {
    for (const row of modulesOf(file).filter((module) => module.kind === 'malformed')) {
      malformed++;
      const report = inspect(row.bytes);
      const flagged = report.kind !== 'module' || report.findings.length > 0 || report.findingsLeftOut > 0;
      if (!flagged) unflagged.push({ file, index: row.index, message: row.message });
    }
  }
  expect(malformed).toBe(177);
  expect(unflagged).toEqual(BODY_LEVEL_FAULTS);
});
