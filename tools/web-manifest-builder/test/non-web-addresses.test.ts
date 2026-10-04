import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processManifest, manifestLinkTag, type ManifestFinding } from '../src/index';

const MANIFEST_URL = 'https://example.com/manifest.webmanifest';
const PAGE_URL = 'https://example.com/';

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function findingsFor(findings: ManifestFinding[], member: string): ManifestFinding[] {
  return findings.filter((finding) => finding.member === member);
}

/** Addresses whose origin is the origin of the address inside them, but which are not web addresses a browser would open as the app. */
const NON_WEB = [
  'blob:https://example.com/9f2c0f0e-8a0a-4a6c-9d7a-111111111111',
  'blob:http://example.com/x',
  'filesystem:https://example.com/temporary/x',
  'javascript:void(0)',
  'data:text/html,hello',
  'file:///etc/hosts',
  'ws://example.com/socket',
  'ftp://example.com/x',
  'about:blank',
];

it('an address that is not an http or https address is ignored with a finding in start_url, id, scope and shortcuts', () => {
  for (const address of NON_WEB) {
    // start_url: the page address is used, and nothing throws.
    const start = processManifest({ start_url: address }, MANIFEST_URL, PAGE_URL);
    expect(start.processed.startUrl, address).toBe(PAGE_URL);
    expect(start.processed.scope, address).toBe(PAGE_URL);
    const startFinding = findingsFor(start.findings, 'start_url');
    expect(startFinding, address).toHaveLength(1);
    expect(startFinding[0]?.severity, address).toBe('ignored');
    expect(startFinding[0]?.message, address).toContain('http or https address');
    expect(start.processed.rows.find((row) => row.member === 'start_url')?.status, address).toBe('ignored');

    // id: the start address identifies the app.
    const id = processManifest({ id: address }, MANIFEST_URL, PAGE_URL);
    expect(id.processed.id, address).toBe(PAGE_URL);
    expect(
      findingsFor(id.findings, 'id').map((f) => f.severity),
      address,
    ).toEqual(['ignored']);
    expect(findingsFor(id.findings, 'id')[0]?.message, address).toContain('http or https address');

    // scope: the folder of the start address is the scope.
    const scope = processManifest({ scope: address }, MANIFEST_URL, PAGE_URL);
    expect(scope.processed.scope, address).toBe(PAGE_URL);
    expect(
      findingsFor(scope.findings, 'scope').map((f) => f.severity),
      address,
    ).toEqual(['ignored']);
    expect(findingsFor(scope.findings, 'scope')[0]?.message, address).toContain('http or https address');

    // shortcuts: dropped, and the good one beside it is kept.
    const shortcuts = processManifest(
      {
        shortcuts: [
          { name: 'Bad', url: address },
          { name: 'Good', url: '/ok' },
        ],
      },
      MANIFEST_URL,
      PAGE_URL,
    );
    expect(shortcuts.processed.shortcuts, address).toEqual([{ name: 'Good', url: 'https://example.com/ok' }]);
    expect(
      findingsFor(shortcuts.findings, 'shortcuts').map((f) => f.severity),
      address,
    ).toEqual(['ignored']);
    expect(findingsFor(shortcuts.findings, 'shortcuts')[0]?.message, address).toContain('http or https address');
  }
});

it('a blob address as the start address no longer throws and never reaches the table as an address', () => {
  const blob = 'blob:https://example.com/9f2c0f0e';
  const everything = processManifest(
    { start_url: blob, id: blob, scope: blob, shortcuts: [{ name: 'A', url: blob }], icons: [{ src: 'i.png' }] },
    MANIFEST_URL,
    PAGE_URL,
  );
  expect(everything.processed.startUrl).toBe(PAGE_URL);
  expect(everything.processed.id).toBe(PAGE_URL);
  expect(everything.processed.scope).toBe(PAGE_URL);
  expect(everything.processed.shortcuts).toEqual([]);
  // The processed column shows only web addresses.
  for (const row of everything.processed.rows) {
    if (row.member === 'start_url' || row.member === 'id' || row.member === 'scope') {
      expect(row.processed.startsWith('https://example.com/'), row.member).toBe(true);
    }
  }
  // A blob manifest address or page address is the example address, as any other scheme is.
  const asAddress = processManifest({}, blob, blob);
  expect(asAddress.processed.manifestUrl).toBe(MANIFEST_URL);
  expect(asAddress.processed.pageUrl).toBe(PAGE_URL);
  expect(manifestLinkTag(blob, blob)).toBe('<link rel="manifest" href="/manifest.webmanifest">');
  // The messages quote nothing of what was typed.
  const marked = processManifest({ start_url: 'blob:https://example.com/FODT-MARK-7731' }, MANIFEST_URL, PAGE_URL);
  expect(JSON.stringify(marked.findings)).not.toContain('FODT-MARK-7731');
});

it('web addresses on the same origin are still read in start_url, id, scope and shortcuts', () => {
  const read = processManifest(
    {
      start_url: 'https://example.com/app/start',
      id: 'https://example.com/app-id',
      scope: 'https://example.com/app/',
      shortcuts: [{ name: 'New', url: 'https://example.com/app/new' }],
    },
    MANIFEST_URL,
    'https://example.com/app/',
  );
  expect(read.processed.startUrl).toBe('https://example.com/app/start');
  expect(read.processed.id).toBe('https://example.com/app-id');
  expect(read.processed.scope).toBe('https://example.com/app/');
  expect(read.processed.shortcuts).toEqual([{ name: 'New', url: 'https://example.com/app/new' }]);
  const insecure = processManifest({ start_url: 'http://example.com/app/start' }, MANIFEST_URL, 'http://example.com/');
  expect(insecure.processed.startUrl).toBe('http://example.com/app/start');
});
