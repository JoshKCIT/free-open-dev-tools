import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';

/**
 * HARD-09 (D-220): the catalog size is read from `docs/catalog.json` at run time by every spec that counts tools. A
 * literal size in a test title, an expectation or a comment goes stale the day a tool is added, and a stale number in
 * an expectation fails a correct build. This test scans the four specs that used to hold the size for the whole word
 * 211 (the size when the milestone began) and for the current size, and proves the scan can fail on a scratch copy.
 */

const COUNT_SPECS = [
  'e2e/live-catalog.spec.ts',
  'e2e/site.spec.ts',
  'e2e/all-tool-chunks.spec.ts',
  'e2e/privacy.spec.ts',
];

const catalogRaw = JSON.parse(readFileSync(join(ROOT, 'docs', 'catalog.json'), 'utf8'));
const CATALOG_SIZE = (Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.tools).length;

/** The size the milestone began with, and the size the catalog has now (the same today, different after a tool is added). */
const BANNED_NUMBERS = [...new Set(['211', String(CATALOG_SIZE)])];

/** The 1-based lines of `text` that hold a banned number as a whole word (so 2110 and 1211 never match). */
export function hardcodedCountLines(text, numbers = BANNED_NUMBERS) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_.])(?:${numbers.join('|')})(?![A-Za-z0-9_])`);
  const found = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (pattern.test(line)) found.push({ line: index + 1, text: line.trim() });
  });
  return found;
}

describe('no literal catalog size in the count specs', () => {
  for (const spec of COUNT_SPECS) {
    it(`${spec} holds neither the starting size nor the current size as a word`, () => {
      const text = readFileSync(join(ROOT, spec), 'utf8');
      expect(hardcodedCountLines(text), `${spec} holds a literal catalog size`).toEqual([]);
    });
  }

  it('the three count specs read the size from docs catalog json', () => {
    for (const spec of ['e2e/live-catalog.spec.ts', 'e2e/site.spec.ts', 'e2e/all-tool-chunks.spec.ts']) {
      expect(readFileSync(join(ROOT, spec), 'utf8'), `${spec} must read docs/catalog.json`).toContain('catalog.json');
    }
  });

  it('matches the number as a whole word in a title, an expectation and a comment', () => {
    expect(hardcodedCountLines("test('renders all 211 entries', () => {})")).toHaveLength(1);
    expect(hardcodedCountLines('expect(count).toBe(211);')).toHaveLength(1);
    expect(hardcodedCountLines('// the complete 211-tool catalog')).toHaveLength(1);
    expect(hardcodedCountLines(`// the catalog holds ${CATALOG_SIZE} tools`)).toHaveLength(1);
  });

  it('does not match the digits inside a longer number or a name', () => {
    expect(hardcodedCountLines('const x = 2110; const y = 1211; const z = a211b; const w = 0.211;')).toEqual([]);
  });

  it('fails on a scratch copy of a real spec that holds a literal size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fodt-counts-'));
    try {
      const real = readFileSync(join(ROOT, 'e2e/site.spec.ts'), 'utf8');
      const scratch = join(dir, 'site.spec.ts');
      writeFileSync(scratch, `${real}\n// this spec used to say 211 here\n`);
      const found = hardcodedCountLines(readFileSync(scratch, 'utf8'));
      expect(found).toHaveLength(1);
      expect(found[0].text).toContain('211');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
