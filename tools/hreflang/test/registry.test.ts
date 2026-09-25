/**
 * Independently re-parses the vendored IANA Language Subtag Registry file
 * (the same record-jar format RFC 5646 section 3.1.1 describes) and asserts
 * the bundled tools/hreflang/src/iana-language-subtag-registry.ts module
 * agrees with it record for record -- a transcription slip in the bundle
 * fails this test rather than passing silently. This parser is deliberately
 * independent of the scratch script that generated the bundle: it reads the
 * vendored file itself, not the generated module.
 *
 * Every `it` here is a required top-level title, matched by exact fullName
 * in this plan's own verify script -- none may be nested inside a
 * `describe()`, which would prefix the name and break that match.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { lookupSubtag, lookupTag, REGISTRY_FILE_DATE, type SubtagType } from '../src/iana-language-subtag-registry';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'iana-language-subtag-registry', 'language-subtag-registry');
const RAW = readFileSync(FIXTURE_PATH, 'utf8');

interface ParsedRecord {
  type: string;
  key: string;
  description: string;
  deprecated: boolean;
  preferredValue: string | null;
  prefixes: string[];
  macrolanguage: string | null;
  suppressScript: string | null;
}

function parseRegistry(raw: string): { fileDate: string; records: ParsedRecord[] } {
  const normalised = raw.replace(/\r\n/g, '\n');
  const rawLines = normalised.split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] = lines[lines.length - 1] + ' ' + line.trim();
    } else {
      lines.push(line);
    }
  }
  const folded = lines.join('\n');
  const recordTexts = folded.split(/\n%%\n?/).filter((s) => s.trim().length > 0);

  const fileDateMatch = recordTexts[0]!.match(/^File-Date:\s*(.+)$/m);
  if (!fileDateMatch) throw new Error('No File-Date record found in the vendored fixture');
  const fileDate = fileDateMatch[1]!.trim();

  const records: ParsedRecord[] = [];
  for (let i = 1; i < recordTexts.length; i++) {
    const recLines = recordTexts[i]!.split('\n').filter((l) => l.length > 0);
    const fields: Record<string, string[]> = {};
    for (const line of recLines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const name = line.slice(0, idx).trim();
      const body = line.slice(idx + 1).trim();
      (fields[name] ??= []).push(body);
    }
    const type = fields.Type?.[0];
    if (!type) continue;
    const key = type === 'grandfathered' || type === 'redundant' ? fields.Tag?.[0] : fields.Subtag?.[0];
    if (!key) continue;
    records.push({
      type,
      key,
      description: fields.Description?.[0] ?? '',
      deprecated: Boolean(fields.Deprecated),
      preferredValue: fields['Preferred-Value']?.[0] ?? null,
      prefixes: fields.Prefix ?? [],
      macrolanguage: fields.Macrolanguage?.[0] ?? null,
      suppressScript: fields['Suppress-Script']?.[0] ?? null,
    });
  }
  return { fileDate, records };
}

const { fileDate, records } = parseRegistry(RAW);

const SUBTAG_TYPES = new Set(['language', 'extlang', 'script', 'region', 'variant']);
const TAG_TYPES = new Set(['grandfathered', 'redundant']);

it('the bundled registry snapshot equals the vendored IANA registry file record for record', () => {
  expect(REGISTRY_FILE_DATE).toBe(fileDate);

  let checked = 0;
  for (const record of records) {
    if (SUBTAG_TYPES.has(record.type)) {
      const bundled = lookupSubtag(record.type as SubtagType, record.key);
      expect(bundled, `${record.type} "${record.key}" missing from bundle`).not.toBeNull();
      expect(bundled!.description).toBe(record.description);
      expect(bundled!.deprecated).toBe(record.deprecated);
      expect(bundled!.preferredValue).toBe(record.preferredValue);
      expect(bundled!.prefixes).toEqual(record.prefixes);
      expect(bundled!.macrolanguage).toBe(record.macrolanguage);
      expect(bundled!.suppressScript).toBe(record.suppressScript);
      checked++;
    } else if (TAG_TYPES.has(record.type)) {
      const bundled = lookupTag(record.key);
      expect(bundled, `${record.type} "${record.key}" missing from bundle`).not.toBeNull();
      expect(bundled!.description).toBe(record.description);
      expect(bundled!.deprecated).toBe(record.deprecated);
      expect(bundled!.preferredValue).toBe(record.preferredValue);
      checked++;
    }
  }
  expect(checked).toBe(records.length);
  expect(records.length).toBe(9296);
});

it('every subtag is looked up in the bundled IANA Language Subtag Registry snapshot', () => {
  expect(lookupSubtag('language', 'de')?.description).toBe('German');
  expect(lookupSubtag('language', 'DE')?.description).toBe('German'); // case-insensitive
  expect(lookupSubtag('script', 'Latn')).not.toBeNull();
  expect(lookupSubtag('region', 'US')).not.toBeNull();
  expect(lookupSubtag('variant', 'nedis')?.prefixes).toEqual(['sl']);
  expect(lookupSubtag('extlang', 'cmn')?.prefixes).toEqual(['zh']);
  expect(lookupSubtag('language', 'zzzzzzzz')).toBeNull();
  expect(lookupTag('art-lojban')).not.toBeNull();
  expect(lookupTag('not-a-real-tag')).toBeNull();
});

it('deprecated subtags and grandfathered tags are reported with the registry Preferred-Value', () => {
  const iw = lookupSubtag('language', 'iw');
  expect(iw?.deprecated).toBe(true);
  expect(iw?.preferredValue).toBe('he');

  const lojban = lookupTag('art-lojban');
  expect(lojban?.deprecated).toBe(true);
  expect(lojban?.preferredValue).toBe('jbo');
});
