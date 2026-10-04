import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_CELL_SHOWN, MAX_SHOWN, buildManifest, processManifest, type ManifestFinding } from '../src/index';

// Expected values below come from the W3C Web Application Manifest Working Draft of 13 August 2026 (its examples 1, 3,
// 4, 5 and 6 and the processing steps), the Image Resource draft section 6, RFC 5646 section 2.1.1 and Appendix A, and
// the browser's own Intl.getCanonicalLocales for the language tags the RFC and ECMAScript disagree about. They are never
// taken from this package's own output.

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

function run(json: Record<string, unknown>, manifestUrl = MANIFEST_URL, pageUrl = PAGE_URL) {
  return processManifest(json, manifestUrl, pageUrl);
}

function findingsFor(findings: ManifestFinding[], member: string): ManifestFinding[] {
  return findings.filter((finding) => finding.member === member);
}

it('start_url, id and scope resolve against the manifest and page addresses as the W3C processing steps say', () => {
  // Example 6 of the draft, "Resulting ids": json["id"] against manifest["start_url"] gives manifest["id"].
  const exampleSix: [string | undefined, string, string][] = [
    [undefined, 'https://example.com/my-app/start', 'https://example.com/my-app/start'],
    [undefined, 'https://example.com/my-app/#here', 'https://example.com/my-app/'],
    ['', 'https://example.com/my-app/start', 'https://example.com/my-app/start'],
    ['/', 'https://example.com/my-app/start', 'https://example.com/'],
    ['foo', 'https://example.com/my-app/start', 'https://example.com/foo'],
    ['foo?x=y', 'https://example.com/my-app/start', 'https://example.com/foo?x=y'],
    ['foo#heading', 'https://example.com/my-app/start', 'https://example.com/foo'],
    ['./foo', 'https://example.com/my-app/start', 'https://example.com/foo'],
    ['https://example.com/foo', 'https://example.com/my-app/start', 'https://example.com/foo'],
    ['https://anothersite.com/foo', 'https://example.com/my-app/start', 'https://example.com/my-app/start'],
  ];
  for (const [id, startUrl, expected] of exampleSix) {
    const json: Record<string, unknown> = { start_url: startUrl };
    if (id !== undefined) json.id = id;
    expect(run(json).processed.id, `id ${JSON.stringify(id)} with start_url ${startUrl}`).toBe(expected);
  }

  // Example 5: start_url ../start_point.html against https://example.com/resources/manifest.webmanifest.
  expect(
    run({ start_url: '../start_point.html' }, 'https://example.com/resources/manifest.webmanifest').processed.startUrl,
  ).toBe('https://example.com/start_point.html');

  // A start_url that is not set, or is empty, is the page address.
  expect(run({}, MANIFEST_URL, 'https://example.com/app/start.html').processed.startUrl).toBe(
    'https://example.com/app/start.html',
  );
  expect(run({ start_url: '' }, MANIFEST_URL, 'https://example.com/app/start.html').processed.startUrl).toBe(
    'https://example.com/app/start.html',
  );

  // A start_url on another origin is ignored, with a finding, and the page address is used.
  const other = run({ start_url: 'https://other.example/app/' }, MANIFEST_URL, 'https://example.com/app/start.html');
  expect(other.processed.startUrl).toBe('https://example.com/app/start.html');
  expect(findingsFor(other.findings, 'start_url').map((finding) => finding.severity)).toContain('ignored');
  // The same origin on another port is another origin.
  expect(run({ start_url: 'https://example.com:8443/' }).processed.startUrl).toBe(PAGE_URL);
  // An address the URL parser cannot read is ignored too.
  // A relative start_url is resolved against the manifest address, not the page address.
  expect(
    processManifest(
      { start_url: 'a.html' },
      'https://example.com/m/manifest.webmanifest',
      'https://example.com/p/index.html',
    ).processed.startUrl,
  ).toBe('https://example.com/m/a.html');
  const unreadable = run({ start_url: 'http://[' });
  expect(unreadable.processed.startUrl).toBe(PAGE_URL);
  expect(findingsFor(unreadable.findings, 'start_url').map((finding) => finding.severity)).toContain('ignored');

  // The default scope is the start URL with its filename, query and fragment removed.
  expect(run({ start_url: '/app/start.html?x=1#top' }).processed.scope).toBe('https://example.com/app/');
  expect(run({ start_url: '/app/start.html', scope: '' }).processed.scope).toBe('https://example.com/app/');
  // A scope is resolved against the manifest address and loses its query and fragment.
  expect(run({ start_url: '/app/start.html', scope: '/app/?q=1#x' }).processed.scope).toBe('https://example.com/app/');
  expect(
    run({ start_url: '/a/b/start.html', scope: '../' }, 'https://example.com/a/b/manifest.webmanifest').processed.scope,
  ).toBe('https://example.com/a/');

  // A start address equal to the scope is within it.
  const equal = run({ start_url: '/app/', scope: '/app/' });
  expect(equal.processed.scope).toBe('https://example.com/app/');
  expect(findingsFor(equal.findings, 'scope').filter((finding) => finding.severity === 'ignored')).toEqual([]);

  // A scope that does not contain the start URL is ignored, with a finding, and the default scope is kept.
  const outside = run({ start_url: '/a/b.html', scope: '/c/' });
  expect(outside.processed.scope).toBe('https://example.com/a/');
  expect(findingsFor(outside.findings, 'scope').map((finding) => finding.severity)).toContain('ignored');
  // A scope on another origin cannot contain the start URL either.
  expect(run({ start_url: '/a/b.html', scope: 'https://other.example/' }).processed.scope).toBe(
    'https://example.com/a/',
  );

  // Adjacency: the draft's within-scope test is a plain text prefix of the path, so a scope of /prefix contains
  // /prefix-of/resource.html (the draft's own words), and a finding says so.
  const prefix = run({ start_url: '/prefix-of/resource.html', scope: '/prefix' });
  expect(prefix.processed.scope).toBe('https://example.com/prefix');
  const explained = findingsFor(prefix.findings, 'scope').filter((finding) => finding.severity === 'warning');
  expect(explained).toHaveLength(1);
  expect(explained[0]?.message).toContain('plain text prefix');
  // A scope that ends with a slash does not match the sibling folder, and says nothing about it.
  const folder = run({ start_url: '/prefix-of/resource.html', scope: '/prefix/' });
  expect(folder.processed.scope).toBe('https://example.com/prefix-of/');
  // A scope without a slash that holds the start URL on a folder boundary has nothing to explain.
  const boundary = run({ start_url: '/app/start.html', scope: '/app' });
  expect(boundary.processed.scope).toBe('https://example.com/app');
  expect(findingsFor(boundary.findings, 'scope').filter((finding) => finding.severity === 'warning')).toEqual([]);

  // Example 1 of the draft, as one manifest.
  const typical = run({
    lang: 'en',
    dir: 'ltr',
    name: 'Super Racer 3000',
    short_name: 'Racer3K',
    icons: [
      { src: 'icon/lowres.webp', sizes: '64x64', type: 'image/webp' },
      { src: 'icon/lowres.png', sizes: '64x64' },
      { src: 'icon/hd_hi', sizes: '128x128' },
    ],
    scope: '/',
    id: 'superracer',
    start_url: '/start.html',
    display: 'fullscreen',
    orientation: 'landscape',
    theme_color: 'aliceblue',
    background_color: 'red',
  });
  const processed = typical.processed;
  expect(processed.name).toBe('Super Racer 3000');
  expect(processed.shortName).toBe('Racer3K');
  expect(processed.lang).toBe('en');
  expect(processed.dir).toBe('ltr');
  expect(processed.id).toBe('https://example.com/superracer');
  expect(processed.startUrl).toBe('https://example.com/start.html');
  expect(processed.scope).toBe('https://example.com/');
  expect(processed.display).toBe('fullscreen');
  expect(processed.orientation).toBe('landscape');
  expect(processed.themeColor?.rgba).toEqual([240, 248, 255, 1]);
  expect(processed.backgroundColor?.rgba).toEqual([255, 0, 0, 1]);
  expect(processed.icons.map((icon) => [icon.src, icon.sizes, icon.type, icon.purposes])).toEqual([
    ['https://example.com/icon/lowres.webp', ['64x64'], 'image/webp', ['any']],
    ['https://example.com/icon/lowres.png', ['64x64'], '', ['any']],
    ['https://example.com/icon/hd_hi', ['128x128'], '', ['any']],
  ]);
  expect(typical.findings.filter((finding) => finding.severity === 'ignored')).toEqual([]);

  // Example 3 of the draft: one icon with four sizes and one with none.
  const icons = run({
    icons: [
      { src: 'icon/lowres.webp', sizes: '48x48', type: 'image/webp' },
      { src: 'icon/lowres', sizes: '48x48' },
      { src: 'icon/hd_hi.ico', sizes: '72x72 96x96 128x128 256x256' },
      { src: 'icon/hd_hi.svg' },
    ],
  }).processed.icons;
  expect(icons.map((icon) => icon.sizes)).toEqual([['48x48'], ['48x48'], ['72x72', '96x96', '128x128', '256x256'], []]);

  // The manifest address, not the page address, is the base of relative addresses.
  expect(
    run({ icons: [{ src: 'a.png' }] }, 'https://example.com/m/manifest.webmanifest', 'https://example.com/page/')
      .processed.icons[0]?.src,
  ).toBe('https://example.com/m/a.png');

  // A manifest or page address that is not a full http or https address is replaced, with a warning that never repeats it.
  const fallback = processManifest({}, 'not an address', 'ftp://example.com/');
  expect(fallback.processed.startUrl).toBe(PAGE_URL);
  expect(findingsFor(fallback.findings, 'manifest address').map((finding) => finding.severity)).toEqual(['warning']);
  expect(findingsFor(fallback.findings, 'page address').map((finding) => finding.severity)).toEqual(['warning']);
  for (const finding of fallback.findings) expect(finding.message).not.toContain('not an address');
  // An empty address is named as empty, not as unreadable.
  const emptied = processManifest({}, '', '   ');
  expect(findingsFor(emptied.findings, 'manifest address')[0]?.message).toContain('is empty');
  expect(findingsFor(emptied.findings, 'page address')[0]?.message).toContain('is empty');
});

it('display, orientation and dir accept only their listed values and report ignored values', () => {
  // The fallback chains of the draft: browser is empty, minimal-ui is browser, standalone is minimal-ui and browser,
  // fullscreen is standalone, minimal-ui and browser.
  const chains: [string, string[]][] = [
    ['browser', []],
    ['minimal-ui', ['browser']],
    ['standalone', ['minimal-ui', 'browser']],
    ['fullscreen', ['standalone', 'minimal-ui', 'browser']],
  ];
  for (const [mode, chain] of chains) {
    const { processed } = run({ display: mode });
    expect(processed.display).toBe(mode);
    expect(processed.displayFallback).toEqual(chain);
  }
  // Leading and trailing ASCII whitespace is stripped and the value is lowercased.
  expect(run({ display: ' FullScreen\t' }).processed.display).toBe('fullscreen');
  // Not set is browser.
  const unset = run({});
  expect(unset.processed.display).toBe('browser');
  expect(unset.processed.dir).toBe('auto');
  expect(unset.processed.orientation).toBeNull();

  // An unknown display value is ignored, with a finding, and browser is used; window-controls-overlay is not a W3C display.
  for (const bad of ['kiosk', 'sideways', 'window-controls-overlay', '', 'stand alone']) {
    const result = run({ display: bad });
    expect(result.processed.display, bad).toBe('browser');
    expect(
      findingsFor(result.findings, 'display').map((finding) => finding.severity),
      bad,
    ).toContain('ignored');
  }
  // A value that is not text is ignored too.
  expect(run({ display: 5 }).processed.display).toBe('browser');
  expect(findingsFor(run({ display: 5 }).findings, 'display').map((finding) => finding.severity)).toContain('ignored');

  // The eight orientation values of the draft are kept; others are ignored with a finding.
  const orientations = [
    'any',
    'natural',
    'landscape',
    'portrait',
    'portrait-primary',
    'portrait-secondary',
    'landscape-primary',
    'landscape-secondary',
  ];
  for (const value of orientations) expect(run({ orientation: value }).processed.orientation).toBe(value);
  expect(run({ orientation: ' LANDSCAPE-Primary ' }).processed.orientation).toBe('landscape-primary');
  for (const bad of ['diagonal', 'landscape primary', 'upside-down', '']) {
    const result = run({ orientation: bad });
    expect(result.processed.orientation, bad).toBeNull();
    expect(
      findingsFor(result.findings, 'orientation').map((finding) => finding.severity),
      bad,
    ).toContain('ignored');
  }

  // dir is ltr, rtl or auto; auto when not set or ignored.
  for (const value of ['ltr', 'rtl', 'auto']) expect(run({ dir: value }).processed.dir).toBe(value);
  expect(run({ dir: ' RTL ' }).processed.dir).toBe('rtl');
  for (const bad of ['sideways', 'left', '']) {
    const result = run({ dir: bad });
    expect(result.processed.dir, bad).toBe('auto');
    expect(
      findingsFor(result.findings, 'dir').map((finding) => finding.severity),
      bad,
    ).toContain('ignored');
  }
});

it('lang is checked as a structurally valid BCP 47 tag and given in canonical form', () => {
  // RFC 5646 section 2.1.1: language lower case, script title case, region upper case.
  const cases: [string, string][] = [
    ['en-us', 'en-US'],
    ['EN-latn-us', 'en-Latn-US'],
    ['zh-hans-cn', 'zh-Hans-CN'],
    ['DE-ch', 'de-CH'],
    [' fr ', 'fr'],
    ['de', 'de'],
    ['es-419', 'es-419'],
    ['en-AU', 'en-AU'],
  ];
  for (const [written, canonical] of cases) {
    const result = run({ lang: written });
    expect(result.processed.lang, written).toBe(canonical);
    expect(findingsFor(result.findings, 'lang').filter((finding) => finding.severity === 'ignored')).toEqual([]);
  }
  // A tag written in another case is shown in canonical form, with a finding that says so.
  expect(findingsFor(run({ lang: 'en-us' }).findings, 'lang').map((finding) => finding.severity)).toContain('info');
  expect(findingsFor(run({ lang: 'en-US' }).findings, 'lang')).toEqual([]);

  // Malformed tags are ignored, with a finding.
  for (const bad of ['e_', 'e', 'en_US', '', 'abcdefghi', 'en US', 'en--US', 'en-', '-en']) {
    const result = run({ lang: bad });
    expect(result.processed.lang, JSON.stringify(bad)).toBeNull();
    expect(
      findingsFor(result.findings, 'lang').map((finding) => finding.severity),
      bad,
    ).toContain('ignored');
  }
  expect(run({ lang: 5 }).processed.lang).toBeNull();

  // RFC 5646 Appendix A, "Some Invalid Tags": each is refused, as the RFC says.
  for (const invalid of ['de-419-DE', 'a-DE', 'ar-a-aaa-b-bbb-a-ccc']) {
    expect(run({ lang: invalid }).processed.lang, invalid).toBeNull();
  }
  // RFC 5646 Appendix A examples that are well formed and that ECMAScript also accepts.
  const accepted = [
    'de',
    'fr',
    'ja',
    'zh-Hant',
    'zh-Hans',
    'sr-Cyrl',
    'sr-Latn',
    'yue-HK',
    'zh-Hans-CN',
    'sr-Latn-RS',
    'sl-rozaj',
    'sl-nedis',
    'de-CH-1901',
    'sl-IT-nedis',
    'de-DE',
    'en-US',
    'es-419',
    'de-CH-x-phonebk',
    'qaa-Qaaa-QM-x-southern',
    'de-Qaaa',
    'sr-Latn-QM',
    'sr-Qaaa-RS',
    'en-US-u-islamcal',
    'zh-CN-a-myext-x-private',
    'en-a-myext-b-another',
  ];
  for (const tag of accepted) expect(run({ lang: tag }).processed.lang, tag).not.toBeNull();
  // Appendix A examples that RFC 5646 calls well formed and that the W3C draft, which hands the check to ECMAScript's
  // IsStructurallyValidLanguageTag, refuses: a grandfathered tag, extended language subtags and a private-use-only tag.
  // Listed by name, never dropped; the limits of the page say so.
  const refusedByEcmaScript = ['i-enochian', 'zh-cmn-Hans-CN', 'zh-yue-HK', 'x-whatever'];
  for (const tag of refusedByEcmaScript) expect(run({ lang: tag }).processed.lang, tag).toBeNull();
});

it('a shortcut without a name or a url within scope is dropped with a finding', () => {
  const base = { start_url: '/app/start.html', scope: '/app/' };
  const result = run({
    ...base,
    shortcuts: [
      { name: 'Play Later', url: '/app/play-later' },
      { url: '/app/noname' },
      { name: '', url: '/app/emptyname' },
      { name: 'No address' },
      { name: 'Number address', url: 5 },
      { name: 'Outside scope', url: '/elsewhere' },
      { name: 'Other origin', url: 'https://other.example/app/x' },
      { name: 'Relative', url: 'sub/page' },
      { name: 'Subscriptions', url: '/app/subscriptions?sort=desc' },
      5,
      null,
      'text',
      ['name'],
    ],
  });
  expect(result.processed.shortcuts.map((shortcut) => [shortcut.name, shortcut.url])).toEqual([
    ['Play Later', 'https://example.com/app/play-later'],
    ['Subscriptions', 'https://example.com/app/subscriptions?sort=desc'],
  ]);
  // Every dropped shortcut has its own finding that names its position (counting from 1), not its text.
  const dropped = findingsFor(result.findings, 'shortcuts').filter((finding) => finding.severity === 'ignored');
  expect(dropped).toHaveLength(11);
  for (const position of [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13]) {
    expect(
      dropped.some((finding) => finding.message.startsWith(`Shortcut ${position}`)),
      `position ${position}`,
    ).toBe(true);
  }
  // "sub/page" resolves against the manifest address (/manifest.webmanifest), so it is /sub/page: outside /app/.
  // Example 4 of the draft, with the manifest at https://example.com/manifest.webmanifest: both shortcuts are within scope.
  const exampleFour = run({
    shortcuts: [
      { name: 'Play Later', description: 'View the list of podcasts you saved for later', url: '/play-later' },
      {
        name: 'Subscriptions',
        description: 'View the list of podcasts you listen to',
        url: '/subscriptions?sort=desc',
      },
    ],
  });
  expect(exampleFour.processed.shortcuts.map((shortcut) => shortcut.url)).toEqual([
    'https://example.com/play-later',
    'https://example.com/subscriptions?sort=desc',
  ]);
  // A value that is not a list is ignored with a finding; no shortcuts at all is fine and says nothing.
  const notList = run({ shortcuts: 'play' });
  expect(notList.processed.shortcuts).toEqual([]);
  expect(findingsFor(notList.findings, 'shortcuts').map((finding) => finding.severity)).toContain('ignored');
  expect(findingsFor(run({}).findings, 'shortcuts')).toEqual([]);
});

it('display_override is labelled as outside the W3C specification and unknown tokens are reported', () => {
  const result = run({
    display_override: ['window-controls-overlay', 'minimal-ui', 'bogus', ' Tabbed ', 'FULLSCREEN'],
  });
  expect(result.processed.displayOverride).toEqual(['window-controls-overlay', 'minimal-ui', 'tabbed', 'fullscreen']);
  const found = findingsFor(result.findings, 'display_override');
  // One label, in plain words, that this member is not part of the W3C specification and that the token list is incomplete.
  const labels = found.filter((finding) => finding.severity === 'info');
  expect(labels).toHaveLength(1);
  expect(labels[0]?.message).toContain('not part of the W3C specification');
  expect(labels[0]?.message).toContain('incomplete');
  // The unknown token has its own finding naming its position, not its text.
  const unknown = found.filter((finding) => finding.severity === 'ignored');
  expect(unknown).toHaveLength(1);
  expect(unknown[0]?.message).toContain('Token 3');
  expect(unknown[0]?.message).not.toContain('bogus');
  // All four W3C display modes, window-controls-overlay and tabbed are known.
  const known = run({
    display_override: ['fullscreen', 'standalone', 'minimal-ui', 'browser', 'window-controls-overlay', 'tabbed'],
  });
  expect(known.processed.displayOverride).toHaveLength(6);
  expect(findingsFor(known.findings, 'display_override').filter((finding) => finding.severity === 'ignored')).toEqual(
    [],
  );
  // Not a list: ignored with a finding. Not set: no member and no finding.
  const notList = run({ display_override: 'standalone' });
  expect(notList.processed.displayOverride).toBeNull();
  expect(findingsFor(notList.findings, 'display_override').map((finding) => finding.severity)).toContain('ignored');
  expect(run({}).processed.displayOverride).toBeNull();
  expect(findingsFor(run({}).findings, 'display_override')).toEqual([]);
  // An item that is not text is an unknown token.
  expect(run({ display_override: [5, 'standalone'] }).processed.displayOverride).toEqual(['standalone']);
});

it('name and short name lengths are counted in code points', () => {
  // Three grinning faces are 3 code points and 6 UTF-16 code units; four are 4 code points and 8 units.
  const face = String.fromCodePoint(0x1f600);
  const three = face.repeat(3);
  const four = face.repeat(4);
  const result = run({ name: three, short_name: four });
  const warnings = findingsFor(result.findings, 'short_name').filter((finding) => finding.severity === 'warning');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.message).toContain('4 characters');
  expect(warnings[0]?.message).toContain('3 characters');
  const nameRow = result.processed.rows.find((row) => row.member === 'name');
  expect(nameRow?.processed).toContain('(3 characters)');
  const shortRow = result.processed.rows.find((row) => row.member === 'short_name');
  expect(shortRow?.processed).toContain('(4 characters)');

  // A short name that is not longer than the name has no warning.
  const fine = run({ name: four, short_name: three });
  expect(findingsFor(fine.findings, 'short_name').filter((finding) => finding.severity === 'warning')).toEqual([]);
  // Leading and trailing ASCII whitespace is stripped before counting.
  const stripped = run({ name: '  Racer  ', short_name: 'Racer' });
  expect(stripped.processed.name).toBe('Racer');
  expect(findingsFor(stripped.findings, 'short_name').filter((finding) => finding.severity === 'warning')).toEqual([]);
  // Neither name nor short_name: one warning on name. A value that is not text is ignored.
  const none = run({});
  expect(findingsFor(none.findings, 'name').map((finding) => finding.severity)).toEqual(['warning']);
  const notText = run({ name: 5, short_name: ['x'] });
  expect(notText.processed.name).toBeNull();
  expect(notText.processed.shortName).toBeNull();
  expect(findingsFor(notText.findings, 'name').map((finding) => finding.severity)).toContain('ignored');
  expect(findingsFor(notText.findings, 'short_name').map((finding) => finding.severity)).toContain('ignored');
  // Only spaces counts as empty.
  const blank = run({ name: '   ', short_name: 'Racer' });
  expect(blank.processed.name).toBeNull();
  expect(findingsFor(blank.findings, 'name').map((finding) => finding.severity)).toContain('warning');
});

it('typed text in every field never stops a run and never appears in a finding beyond 40 escaped characters', () => {
  const tail = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8);
  const bell = String.fromCodePoint(7);
  const rlo = String.fromCodePoint(0x202e);
  const marker = `FODT-MARKER-4417-${tail}${bell}${rlo}`;
  const cells = (count: number) => Array.from({ length: count }, () => marker);
  const built = buildManifest({
    name: marker,
    shortName: marker,
    id: marker,
    startUrl: marker,
    scope: marker,
    display: marker,
    displayOverride: marker,
    orientation: marker,
    dir: marker,
    lang: marker,
    themeColor: marker,
    backgroundColor: marker,
    icons: [cells(4)],
    shortcuts: [cells(2)],
  });
  const results = [
    processManifest(built, MANIFEST_URL, PAGE_URL),
    processManifest(built, marker, marker),
    processManifest(built, `https://example.com/${marker}`, `https://example.com/${marker}`),
  ];
  for (const result of results) {
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      // At most 40 characters of the marker are ever shown, and no raw control or direction character.
      expect(finding.message, finding.member).not.toContain(marker.slice(0, 41));
      expect(finding.message, finding.member).not.toContain(bell);
      expect(finding.message, finding.member).not.toContain(rlo);
    }
    for (const row of result.processed.rows) {
      for (const cell of [row.written, row.processed]) {
        expect(cell).not.toContain(bell);
        expect(cell).not.toContain(rlo);
        // A table cell shows at most 200 characters of what was typed.
        expect(cell).not.toContain(marker.slice(0, 201));
      }
    }
  }
  // A direction-changing character inside the shown part is written as its code point, so a name cannot read backwards.
  const bidi = run({ name: 'a' + rlo + 'b' + bell });
  const backslash = String.fromCharCode(92);
  expect(bidi.processed.rows.find((row) => row.member === 'name')?.written).toBe(
    'a' + backslash + 'u{202E}b' + backslash + 'u{7}',
  );
  // A finding is cut at MAX_SHOWN characters and a table cell at MAX_CELL_SHOWN, with an ellipsis after it.
  expect(MAX_SHOWN).toBe(40);
  expect(MAX_CELL_SHOWN).toBe(200);
  const longName = results[0]?.processed.rows.find((row) => row.member === 'name');
  expect(longName?.written).toBe(marker.slice(0, 200) + String.fromCodePoint(0x2026));

  // Values that are not text, in every member, are ignored and never throw.
  const hostile: Record<string, unknown> = {};
  for (const member of [
    'name',
    'short_name',
    'id',
    'start_url',
    'scope',
    'display',
    'display_override',
    'orientation',
    'dir',
    'lang',
    'theme_color',
    'background_color',
    'icons',
    'shortcuts',
  ]) {
    hostile[member] = [5, null, { a: 1 }, [marker], true];
  }
  expect(() => processManifest(hostile, MANIFEST_URL, PAGE_URL)).not.toThrow();
  for (const value of [5, null, true, 'text', [1, 2], { icons: 7 }]) {
    const json = { name: value, short_name: value, id: value, start_url: value, scope: value, icons: value };
    expect(() => processManifest(json as Record<string, unknown>, MANIFEST_URL, PAGE_URL)).not.toThrow();
  }
  // A manifest that is not an object at all is read as an empty one, as the draft says.
  expect(() => processManifest(5 as unknown as Record<string, unknown>, MANIFEST_URL, PAGE_URL)).not.toThrow();
  expect(() => processManifest(null as unknown as Record<string, unknown>, MANIFEST_URL, PAGE_URL)).not.toThrow();
});

it('named colour, member and token lookups treat __proto__, constructor and toString as unknown', () => {
  const words = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const word of words) {
    const colour = run({ theme_color: word, background_color: word });
    expect(colour.processed.themeColor, word).toBeNull();
    expect(colour.processed.backgroundColor, word).toBeNull();
    expect(run({ display: word }).processed.display, word).toBe('browser');
    expect(run({ orientation: word }).processed.orientation, word).toBeNull();
    expect(run({ dir: word }).processed.dir, word).toBe('auto');
    const override = run({ display_override: [word, 'standalone'] });
    expect(override.processed.displayOverride, word).toEqual(['standalone']);
    const icons = run({ icons: [{ src: 'a.png', purpose: word, sizes: word }] });
    expect(icons.processed.icons, word).toEqual([]);
  }
  // JSON.parse makes __proto__ and constructor ordinary own keys; no member is ever read through the prototype chain.
  const polluted = JSON.parse(
    '{"__proto__": {"name": "Inherited", "start_url": "/inherited"}, "constructor": {"name": "Constructor"}}',
  ) as Record<string, unknown>;
  const result = run(polluted);
  expect(result.processed.name).toBeNull();
  expect(result.processed.startUrl).toBe(PAGE_URL);
  expect(({} as Record<string, unknown>).name).toBeUndefined();
});

it('findings and table rows follow one fixed member order', () => {
  const order = [
    'manifest address',
    'page address',
    'name',
    'short_name',
    'id',
    'start_url',
    'scope',
    'display',
    'display_override',
    'orientation',
    'dir',
    'lang',
    'theme_color',
    'background_color',
    'icons',
    'shortcuts',
  ];
  // Every member is given something to complain about, in the reverse of the fixed order.
  const reversed: Record<string, unknown> = {
    shortcuts: [{ name: '' }],
    icons: [{ src: 'a.png', purpose: 'fizzbuzz' }],
    background_color: 'nonsense',
    theme_color: 'nonsense',
    lang: 'e_',
    dir: 'sideways',
    orientation: 'diagonal',
    display_override: ['bogus'],
    display: 'kiosk',
    scope: '/x/',
    start_url: 'https://other.example/y.html',
    id: 5,
    short_name: 5,
    name: 5,
  };
  const result = processManifest(reversed, 'nothing', 'nothing');
  const seen = result.findings.map((finding) => order.indexOf(finding.member));
  expect(seen.every((index) => index >= 0)).toBe(true);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(new Set(result.findings.map((finding) => finding.member)).size).toBe(order.length);
  const rowOrder = result.processed.rows.map((row) => row.member.replace(/\[\d+\]$/, ''));
  const rowRanks = rowOrder.map((member) => order.indexOf(member));
  expect(rowRanks.every((index) => index >= 0)).toBe(true);
  expect(rowRanks).toEqual([...rowRanks].sort((a, b) => a - b));
});
