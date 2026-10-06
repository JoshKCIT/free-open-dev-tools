import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';
import { buildInlineFiles, fixtureCoverageProblems, inlineFileProblems } from '../../e2e/fixture-inline.ts';

/**
 * HARD-09 (D-223 e): the live-catalog checks accept a new catalog id by rule, and a fixture can carry real files
 * inline. The pure functions in `e2e/fixture-inline.ts` are tested here without a browser, and the real shape of the
 * repository (the catalog, the built pages, the fixture files and the frozen id lists written in the spec) is proved to
 * satisfy the rule today.
 */

const SPEC_TEXT = readFileSync(join(ROOT, 'e2e', 'live-catalog.spec.ts'), 'utf8');

/** The ids inside `const NAME = [ ... ];` in the spec, in order. */
function listIds(name) {
  const match = new RegExp(`const ${name}[^=]*=\\s*(?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(SPEC_TEXT);
  if (!match) throw new Error(`e2e/live-catalog.spec.ts has no list named ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const LEGACY_LIST_NAMES = [
  'PHASE_3_TOOL_IDS',
  'PHASE_4_TOOL_IDS',
  'PHASE_5_TOOL_IDS',
  'PHASE_6_TOOL_IDS',
  'PHASE_7_TOOL_IDS',
  'PHASE_8_TOOL_IDS',
  'PHASE_9_TOOL_IDS',
  'PHASE_10_TOOL_IDS',
  'PHASE_11_TOOL_IDS',
  'PHASE_12_TOOL_IDS',
  'PHASE_13_TOOL_IDS',
  'PHASE_14_TOOL_IDS',
  'PHASE_15_TOOL_IDS',
  'PHASE_16_TOOL_IDS',
  'ADDED_2026_09_29_TOOL_IDS',
];

const catalogRaw = JSON.parse(readFileSync(join(ROOT, 'docs', 'catalog.json'), 'utf8'));
const CATALOG_IDS = (Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.tools).map((e) => e.id);
const BUILT_IDS = readdirSync(join(ROOT, 'apps', 'web', 'src', 'tools'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''));
const FIXTURE_DIR = join(ROOT, 'e2e', 'live-fixtures');
const FIXTURE_IDS = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')).id);

const LEGACY_IDS = LEGACY_LIST_NAMES.flatMap(listIds);
const EXEMPT_IDS = [...listIds('NEW_TOOL_IDS'), ...listIds('EARLY_TOOL_IDS')];

/** A small catalog of its own, so a rule check does not depend on the real one. */
const SMALL = {
  catalogIds: ['a', 'b', 'c'],
  builtIds: ['a', 'b', 'c'],
  fixtureIds: ['a', 'b', 'c'],
  legacyIds: ['a', 'b'],
};

describe('fixtureCoverageProblems on the real repository', () => {
  it('finds no problem in the catalog, the built pages and the live fixture files', () => {
    expect(
      fixtureCoverageProblems({
        catalogIds: CATALOG_IDS,
        builtIds: BUILT_IDS,
        fixtureIds: FIXTURE_IDS,
        legacyIds: LEGACY_IDS,
        exemptIds: EXEMPT_IDS,
      }),
    ).toEqual([]);
  });

  it('reads the legacy set as the union of the fifteen lists the spec freezes', () => {
    const frozen = /const LEGACY_TOOL_IDS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(SPEC_TEXT);
    expect(frozen, 'LEGACY_TOOL_IDS must be written as a frozen list of spreads').not.toBeNull();
    const spread = [...frozen[1].matchAll(/\.\.\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(spread).toEqual(LEGACY_LIST_NAMES);
    expect(new Set(LEGACY_IDS).size, 'no id sits in two of the fifteen lists').toBe(LEGACY_IDS.length);
  });

  it('keeps the exempt ids exactly the frozen list, so no later tool can skip its live fixture by joining one', () => {
    // The tools built before first-use fixture files existed (NEW_TOOL_IDS and EARLY_TOOL_IDS in the spec). A tool added
    // to either list would need no live fixture; this literal is the whole list, forever, and is never extended.
    const FROZEN_EXEMPT = [
      'base32',
      'base58',
      'base64',
      'basic-auth',
      'bcrypt',
      'case-converter',
      'chmod-calculator',
      'classical-cipher',
      'data-uri',
      'hash-file',
      'hash-text',
      'hmac',
      'html-entities',
      'ieee754',
      'ip-subnet',
      'json-formatter',
      'json-string-escape',
      'jwt-decoder',
      'jwt-signature',
      'luhn',
      'morse-code',
      'nato-phonetic',
      'number-base',
      'number-to-words',
      'password-generator',
      'password-strength',
      'random-number',
      'random-string',
      'roman-numerals',
      'scientific-notation',
      'slug-generator',
      'text-diff',
      'text-radix',
      'unicode-inspector',
      'unix-timestamp',
      'url-codec',
      'uuid',
      'word-counter',
    ];
    expect([...EXEMPT_IDS].sort()).toEqual(FROZEN_EXEMPT);
    expect(new Set(EXEMPT_IDS).size, 'no id sits in both exempt lists').toBe(EXEMPT_IDS.length);
  });

  it('accepts a simulated new tool that has a built page and exactly one live fixture', () => {
    const problems = fixtureCoverageProblems({
      catalogIds: [...CATALOG_IDS, 'future-tool'],
      builtIds: [...BUILT_IDS, 'future-tool'],
      fixtureIds: [...FIXTURE_IDS, 'future-tool'],
      legacyIds: LEGACY_IDS,
      exemptIds: EXEMPT_IDS,
    });
    expect(problems).toEqual([]);
  });
});

describe('fixtureCoverageProblems rule', () => {
  it('passes the small shape', () => {
    expect(fixtureCoverageProblems(SMALL)).toEqual([]);
  });

  it('passes a new id outside the legacy set with one fixture', () => {
    expect(
      fixtureCoverageProblems({
        ...SMALL,
        catalogIds: [...SMALL.catalogIds, 'd'],
        builtIds: [...SMALL.builtIds, 'd'],
        fixtureIds: [...SMALL.fixtureIds, 'd'],
      }),
    ).toEqual([]);
  });

  it('fails a new id with no fixture, naming the file to add', () => {
    const problems = fixtureCoverageProblems({
      ...SMALL,
      catalogIds: [...SMALL.catalogIds, 'd'],
      builtIds: [...SMALL.builtIds, 'd'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('e2e/live-fixtures/d.json');
  });

  it('fails a new id with two fixtures', () => {
    const problems = fixtureCoverageProblems({
      ...SMALL,
      catalogIds: [...SMALL.catalogIds, 'd'],
      builtIds: [...SMALL.builtIds, 'd'],
      fixtureIds: [...SMALL.fixtureIds, 'd', 'd'],
    });
    expect(problems.join(' ')).toContain('"d" is declared 2 times');
  });

  it('fails a new id whose page is not built, with or without a fixture', () => {
    const base = { ...SMALL, catalogIds: [...SMALL.catalogIds, 'd'] };
    expect(fixtureCoverageProblems({ ...base, fixtureIds: [...SMALL.fixtureIds, 'd'] }).join(' ')).toContain(
      'has no built page',
    );
    expect(fixtureCoverageProblems(base).join(' ')).toContain('"d" has no built page');
  });

  it('fails a legacy id that lost its fixture', () => {
    const problems = fixtureCoverageProblems({ ...SMALL, fixtureIds: ['b', 'c'] });
    expect(problems.join(' ')).toContain('legacy id "a" has no live fixture');
  });

  it('fails a fixture id that is not a catalog id', () => {
    const problems = fixtureCoverageProblems({ ...SMALL, fixtureIds: [...SMALL.fixtureIds, 'ghost'] });
    expect(problems.join(' ')).toContain('"ghost" is not a catalog id');
  });

  it('needs no fixture for an exempt id, but not for an id missing from the catalog', () => {
    const exempt = fixtureCoverageProblems({ ...SMALL, fixtureIds: ['a', 'b'], exemptIds: ['c'] });
    expect(exempt).toEqual([]);
    expect(fixtureCoverageProblems({ ...SMALL, exemptIds: ['zzz'] }).join(' ')).toContain('exempt id "zzz"');
  });

  it('fails an id repeated in the catalog', () => {
    expect(fixtureCoverageProblems({ ...SMALL, catalogIds: ['a', 'b', 'c', 'c'] }).join(' ')).toContain(
      'catalog id "c" appears 2 times',
    );
  });
});

describe('inline fixture files', () => {
  const good = { name: 'tiny.wasm', mimeType: 'application/wasm', base64: 'AGFzbQEAAAA=' };

  it('accepts a base64 file and a text file', () => {
    expect(inlineFileProblems([good, { name: 'a.eml', mimeType: 'message/rfc822', text: 'x' }], 'f')).toEqual([]);
  });

  it('refuses an empty array, naming where', () => {
    expect(inlineFileProblems([], 'e2e/live-fixtures/x.json: steps[0].files').join(' ')).toContain(
      'e2e/live-fixtures/x.json: steps[0].files',
    );
  });

  it('refuses an entry with both base64 and text, with neither, and a value that is not a list', () => {
    expect(inlineFileProblems([{ ...good, text: 'x' }], 'f')).toHaveLength(1);
    expect(inlineFileProblems([{ name: 'a', mimeType: 'text/plain' }], 'f')).toHaveLength(1);
    expect(inlineFileProblems({ name: 'a' }, 'f')).toHaveLength(1);
    expect(inlineFileProblems([null], 'f')).toHaveLength(1);
  });

  it('refuses a name or type that is not a string, an unknown key and a malformed base64 text', () => {
    expect(inlineFileProblems([{ ...good, name: 5 }], 'f')).toHaveLength(1);
    expect(inlineFileProblems([{ ...good, mimeType: undefined }], 'f')).toHaveLength(1);
    expect(inlineFileProblems([{ ...good, extra: 1 }], 'f').join(' ')).toContain('unknown key');
    expect(inlineFileProblems([{ ...good, base64: 'not base64!' }], 'f')).toHaveLength(1);
    expect(inlineFileProblems([{ ...good, name: 'a/b.bin' }], 'f')).toHaveLength(1);
  });

  it('decodes base64 exactly and encodes text as UTF-8', () => {
    const [wasm, text] = buildInlineFiles([good, { name: 'n.txt', mimeType: 'text/plain', text: 'café' }], 'M');
    expect([...wasm.buffer]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    expect(wasm.name).toBe('tiny.wasm');
    expect(wasm.mimeType).toBe('application/wasm');
    expect([...text.buffer]).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9]);
  });

  it('replaces every marker placeholder in text, and leaves base64 alone', () => {
    const [text, bytes] = buildInlineFiles(
      [
        { name: 'n.txt', mimeType: 'text/plain', text: 'a {{MARKER}} b {{MARKER}} $& c' },
        { name: 'b.bin', mimeType: 'application/octet-stream', base64: 'e3tNQVJLRVJ9fQ==' },
      ],
      'CANARY-1',
    );
    expect(Buffer.from(text.buffer).toString('utf8')).toBe('a CANARY-1 b CANARY-1 $& c');
    expect(Buffer.from(bytes.buffer).toString('utf8')).toBe('{{MARKER}}');
  });

  it('throws on a malformed list instead of attaching it', () => {
    expect(() => buildInlineFiles([], 'M')).toThrow(/empty array/);
  });
});
