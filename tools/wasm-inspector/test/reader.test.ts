import { expect, it } from 'vitest';
import { inspect } from '../src/index';
import { FIXTURE_BYTES, FIXTURE_SHA256, fixtureBytes } from './fixtures/fixture';
import { createHash } from 'node:crypto';

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION_1 = [0x01, 0x00, 0x00, 0x00];
const COMPONENT = [0x0d, 0x00, 0x01, 0x00];

function oneSentence(sentence: string | null): void {
  expect(sentence, 'a sentence is given').not.toBeNull();
  expect(sentence).toMatch(/^[A-Z][^\n]*[.]$/);
}

it('an empty file, the magic alone and a component binary each give one plain sentence', () => {
  const empty = inspect(new Uint8Array(0));
  expect(empty.kind).toBe('unreadable');
  oneSentence(empty.sentence);
  expect(empty.sentence).toMatch(/empty/);

  const magicAlone = inspect(Uint8Array.from(MAGIC));
  expect(magicAlone.kind).toBe('unreadable');
  oneSentence(magicAlone.sentence);
  expect(magicAlone.sentence).toMatch(/version/);

  const component = inspect(Uint8Array.from([...MAGIC, ...COMPONENT]));
  expect(component.kind).toBe('component');
  oneSentence(component.sentence);
  expect(component.sentence).toMatch(/component/);

  for (const report of [empty, magicAlone, component]) {
    expect(report.findings, 'a sentence is the whole answer').toEqual([]);
    expect(report.sections).toEqual([]);
    expect(report.imports.rows).toEqual([]);
    expect(report.exports.rows).toEqual([]);
  }

  // Not a module at all, and a version the format does not have.
  const text = inspect(new TextEncoder().encode('hello, this is not a module'));
  expect(text.kind).toBe('unreadable');
  oneSentence(text.sentence);
  expect(text.sentence).toMatch(/signature/);
  const future = inspect(Uint8Array.from([...MAGIC, 0x02, 0x00, 0x00, 0x00]));
  expect(future.kind).toBe('unreadable');
  oneSentence(future.sentence);
  expect(future.sentence).toMatch(/version/);
});

it('the magic and the version alone are a valid empty module shown with zero of everything', () => {
  const report = inspect(Uint8Array.from([...MAGIC, ...VERSION_1]));
  expect(report.kind).toBe('module');
  expect(report.sentence).toBeNull();
  expect(report.size).toBe(8);
  expect(report.findings).toEqual([]);
  expect(report.sections).toEqual([]);
  expect(report.types.count).toBe(0);
  expect(report.imports.count).toBe(0);
  expect(report.exports.count).toBe(0);
  expect(report.functions.defined).toBe(0);
  expect(report.start).toBeNull();
});

it('the 329 byte fixture module gives the imports and exports V8 gives', () => {
  const bytes = fixtureBytes();
  expect(bytes.length).toBe(FIXTURE_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(FIXTURE_SHA256);

  const report = inspect(bytes);
  expect(report.kind).toBe('module');
  expect(report.findings).toEqual([]);

  // Tests may compile: V8 is the second opinion on this module, and the source under test never does.
  const compiled = new WebAssembly.Module(bytes);
  const kindOf = (kind: string): string => (kind === 'func' ? 'function' : kind);
  const v8Imports = WebAssembly.Module.imports(compiled).map((i) => `${i.module}.${i.name}:${i.kind}`);
  const v8Exports = WebAssembly.Module.exports(compiled).map((e) => `${e.name}:${e.kind}`);
  expect(report.imports.rows.map((i) => `${i.module}.${i.field}:${kindOf(i.kind)}`)).toEqual(v8Imports);
  expect(report.exports.rows.map((e) => `${e.name}:${kindOf(e.kind)}`)).toEqual(v8Exports);

  // What the WAT text says, written out.
  expect(v8Imports).toEqual(['env.log:function', 'env.limit:global']);
  expect(v8Exports).toEqual(['memory:memory', 'add:function', 'twice:function', 'counter:global']);
  expect(report.functions.imported).toBe(1);
  expect(report.functions.defined).toBe(3);
  expect(report.sections.map((s) => s.name)).toEqual([
    'type',
    'import',
    'function',
    'table',
    'memory',
    'global',
    'export',
    'start',
    'element',
    'code',
    'data',
    'custom',
  ]);
  expect(report.start).toBe(3);
});
