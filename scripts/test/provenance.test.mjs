import { describe, it, expect } from 'vitest';
import { redactDenylistTokens, extractCatalogEntries } from '../lib/provenance.mjs';

// These tests use an invented, synthetic token that has nothing to do with
// the real provenance denylist. The real denylist lives only in a
// git-ignored local file and a CI repository secret, and must never be
// written into a tracked file (see 01-REVIEW.md hard prohibitions).
const SYNTHETIC_TOKEN = 'zzz-synthetic-denylist-token';

describe('redactDenylistTokens (CR-01 regression)', () => {
  it('redacts a token that appears inside a tracked file path, the way a layer-1 filename match would', () => {
    // Mirrors the exact bug: a file's own path contains the matched token,
    // and that path is interpolated into the problem message.
    const rel = `docs/inventory/mapping/${SYNTHETIC_TOKEN}.psv`;
    const message = `${rel}: file name matches the provenance denylist (layer 1, name).`;

    const redacted = redactDenylistTokens(message, [SYNTHETIC_TOKEN]);

    expect(redacted).not.toContain(SYNTHETIC_TOKEN);
    expect(redacted).toContain('[redacted]');
    // The reader still needs to know which directory the file is in and
    // which layer matched.
    expect(redacted).toContain('docs/inventory/mapping/');
    expect(redacted).toContain('layer 1, name');
  });

  it('is case-insensitive and redacts every occurrence, not just the first', () => {
    const message = `Match at ${SYNTHETIC_TOKEN} and again at ${SYNTHETIC_TOKEN.toUpperCase()}.`;

    const redacted = redactDenylistTokens(message, [SYNTHETIC_TOKEN]);

    expect(redacted.toLowerCase()).not.toContain(SYNTHETIC_TOKEN);
    expect(redacted.match(/\[redacted\]/g)).toHaveLength(2);
  });

  it('runs every token in the list over the text, not just the first one that matches', () => {
    const message = `path/${SYNTHETIC_TOKEN}-other-token.txt`;
    const otherToken = 'other-token';

    const redacted = redactDenylistTokens(message, [SYNTHETIC_TOKEN, otherToken]);

    expect(redacted).not.toContain(SYNTHETIC_TOKEN);
    expect(redacted).not.toContain(otherToken);
  });

  it('leaves text with no token match untouched', () => {
    const message = 'docs/README.md: nothing to see here (layer 1, name).';
    expect(redactDenylistTokens(message, [SYNTHETIC_TOKEN])).toBe(message);
  });

  it('is safe against denylist tokens containing regex metacharacters', () => {
    const trickyToken = 'weird.token+chars';
    const message = `path/${trickyToken}/file.txt`;
    const redacted = redactDenylistTokens(message, [trickyToken]);
    expect(redacted).not.toContain(trickyToken);
    expect(redacted).toContain('[redacted]');
  });
});

describe('extractCatalogEntries (CR-02 regression)', () => {
  it('finds entries under the real shape build-catalog.mjs actually writes: { tools: [...] }', () => {
    const data = { tools: [{ id: 'a' }, { id: 'b' }] };
    const result = extractCatalogEntries(data);
    expect(result.found).toBe(true);
    expect(result.entries).toEqual(data.tools);
  });

  it('still recognises a bare top-level array, for robustness', () => {
    const data = [{ id: 'a' }];
    const result = extractCatalogEntries(data);
    expect(result.found).toBe(true);
    expect(result.entries).toBe(data);
  });

  it('still recognises the legacy { canonical: [...] } shape, for robustness against a future rename back', () => {
    const data = { canonical: [{ id: 'a' }] };
    const result = extractCatalogEntries(data);
    expect(result.found).toBe(true);
    expect(result.entries).toEqual(data.canonical);
  });

  it('reports found: false, not a silent empty array, when no known shape matches', () => {
    const data = { somethingElse: [{ id: 'a' }] };
    const result = extractCatalogEntries(data);
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it('the per-entry forbidden-key check actually fires against the real { tools: [...] } shape', () => {
    // This is the exact scenario CR-02 describes: a per-tool source-attribution
    // field on a real catalog entry, under the shape the generator actually
    // writes. Before the fix, `entries` always resolved to [] here.
    const data = {
      tools: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', sources: ['x'] },
      ],
    };
    const { entries, found } = extractCatalogEntries(data);
    const FORBIDDEN_ENTRY_KEYS = ['sources', 'feeds', 'replacesDiscoveredTools'];

    expect(found).toBe(true);
    expect(entries.some((e) => FORBIDDEN_ENTRY_KEYS.some((k) => Object.hasOwn(e, k)))).toBe(true);
  });
});
