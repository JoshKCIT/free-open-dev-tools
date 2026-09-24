import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lookup,
  typesForExtension,
  extensionsForType,
  normaliseMediaType,
  citationFor,
  MIME_DB_VERSION,
} from '../src/index';

// Source: https://www.iana.org/assignments/media-types/application.csv,
// text.csv and image.csv, fetched 2026-09-24. Five type names hand-transcribed
// from those fetched CSVs.
const IANA_HAND_TRANSCRIBED = ['application/json', 'application/pdf', 'image/png', 'text/html', 'text/css'];

it('json, a filename with a capitalised extension and a leading dot all resolve to application/json', () => {
  for (const query of ['json', '.json', 'Report.JSON']) {
    const rows = typesForExtension(query);
    expect(
      rows.some((r) => r.type === 'application/json'),
      `query "${query}" did not resolve to application/json`,
    ).toBe(true);
  }
});

it('application/json lists its extension and cites the IANA Media Types registry', () => {
  const result = lookup('application/json');
  expect(result.rows.length).toBeGreaterThan(0);
  const row = result.rows[0]!;
  expect(row.extensions).toContain('json');
  expect(row.ianaRegistered).toBe(true);
  const citation = citationFor(row);
  expect(citation.label).toBe('IANA Media Types registry');
  expect(citation.url).toContain('iana.org/assignments/media-types');
});

it('an extension claimed by several media types lists every one with the IANA-registered type first', () => {
  const rows = typesForExtension('fdf');
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows[0]!.type).toBe('application/fdf');
  expect(rows[0]!.ianaRegistered).toBe(true);
  expect(rows.some((r) => r.type === 'application/vnd.fdf' && !r.ianaRegistered)).toBe(true);
});

it('RFC 6838 type names are matched case-insensitively and parameters are ignored', () => {
  expect(normaliseMediaType('Text/HTML; charset=utf-8')).toBe('text/html');
  const result = lookup('Text/HTML; charset=utf-8');
  expect(result.rows.length).toBe(1);
  expect(result.rows[0]!.type).toBe('text/html');
});

it('types the IANA registry lists are marked IANA-registered and others name their non-IANA source', () => {
  for (const type of IANA_HAND_TRANSCRIBED) {
    const result = lookup(type);
    expect(result.rows.length, `${type} not found`).toBeGreaterThan(0);
    expect(result.rows[0]!.ianaRegistered, `${type} should be IANA-registered`).toBe(true);
    const citation = citationFor(result.rows[0]!);
    expect(citation.label).toBe('IANA Media Types registry');
  }

  const apacheRow = typesForExtension('fdf').find((r) => r.type === 'application/vnd.fdf')!;
  expect(apacheRow.ianaRegistered).toBe(false);
  const apacheCitation = citationFor(apacheRow);
  expect(apacheCitation.label).toContain('not IANA-registered');
  expect(apacheCitation.label.toLowerCase()).toContain('apache');
});

it('the bundled table is the declared mime-db version and an unknown extension is reported as not found', () => {
  const installedPkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../node_modules/mime-db/package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  expect(MIME_DB_VERSION).toBe(installedPkg.version);

  const rows = typesForExtension('not-a-real-extension-xyz');
  expect(rows.length).toBe(0);
});
