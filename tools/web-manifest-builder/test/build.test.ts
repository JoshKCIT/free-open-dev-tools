import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MAX_FIELD_CHARACTERS,
  MAX_ICONS,
  MAX_JSON_BYTES,
  MAX_SHORTCUTS,
  ManifestBuilderError,
  buildManifest,
  installAdvice,
  manifestLinkTag,
  manifestToJson,
  processManifest,
} from '../src/index';

// The member order below is the order the plan gives and the order of the draft's own example manifest (Example 1 lists
// them in another order, which is why the order is fixed here instead of being the order fields were filled in). JSON is
// written by JSON.stringify, so the expected text is what JSON itself defines (RFC 8259): characters outside ASCII are
// kept, control characters are escaped.

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
  vi.unstubAllGlobals();
});

const FIXED_ORDER = [
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

it('the built manifest is valid JSON with members in a fixed order and nothing fetched', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  // Fields are given in a scrambled order; members come out in the fixed one, and icons and shortcuts keep their rows.
  const manifest = buildManifest({
    shortcuts: [
      ['Second shortcut', '/second'],
      ['First shortcut', '/first'],
    ],
    backgroundColor: '#ffffff',
    icons: [
      ['b.png', '512x512', 'image/png', 'maskable'],
      ['a.png', '192x192', 'image/png', ''],
    ],
    lang: 'en',
    dir: 'ltr',
    orientation: 'portrait',
    displayOverride: 'window-controls-overlay, minimal-ui  tabbed',
    display: 'standalone',
    scope: '/app/',
    startUrl: '/app/start.html',
    id: 'racer',
    shortName: 'Racer',
    name: 'Super Racer',
    themeColor: '#0b57d0',
  });
  expect(Object.keys(manifest)).toEqual(FIXED_ORDER);
  expect(manifest.icons).toEqual([
    { src: 'b.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'a.png', sizes: '192x192', type: 'image/png' },
  ]);
  expect(manifest.shortcuts).toEqual([
    { name: 'Second shortcut', url: '/second' },
    { name: 'First shortcut', url: '/first' },
  ]);
  expect(manifest.display_override).toEqual(['window-controls-overlay', 'minimal-ui', 'tabbed']);
  // The keys of an icon are written in the order src, sizes, type, purpose.
  expect(Object.keys((manifest.icons as Record<string, unknown>[])[0] ?? {})).toEqual([
    'src',
    'sizes',
    'type',
    'purpose',
  ]);

  // The text is valid JSON that reads back as the same object, in the same member order.
  const json = manifestToJson(manifest);
  expect(JSON.parse(json)).toEqual(manifest);
  expect(Object.keys(JSON.parse(json) as object)).toEqual(FIXED_ORDER);
  expect(json.startsWith('{\n  "name": "Super Racer",\n  "short_name": "Racer",')).toBe(true);
  expect(json.endsWith('\n')).toBe(false);

  // Empty fields leave their member out, spaces count as empty, and rows with nothing in them are skipped.
  expect(buildManifest({})).toEqual({});
  expect(
    Object.keys(
      buildManifest({
        name: '   ',
        startUrl: '',
        icons: [
          ['', '', '', ''],
          ['  ', '', '', ''],
        ],
        shortcuts: [['', '']],
      }),
    ),
  ).toEqual([]);
  expect(buildManifest({ name: '  Padded  ', icons: [['', '48x48', '', '']], shortcuts: [['', '/x']] })).toEqual({
    name: 'Padded',
    icons: [{ sizes: '48x48' }],
    shortcuts: [{ url: '/x' }],
  });
  // Cells missing from a short row read as empty.
  expect(buildManifest({ icons: [['only-src.png']], shortcuts: [['Only name']] })).toEqual({
    icons: [{ src: 'only-src.png' }],
    shortcuts: [{ name: 'Only name' }],
  });

  // JSON.stringify keeps characters outside ASCII and escapes control characters and quotes.
  const odd = buildManifest({ name: `名前 "quoted" ${String.fromCodePoint(7)} ${String.fromCodePoint(0x1f600)}` });
  const oddJson = manifestToJson(odd);
  expect(oddJson).toContain('名前');
  expect(oddJson).toContain(String.fromCodePoint(0x1f600));
  expect(oddJson).toContain(String.fromCharCode(92) + '"quoted' + String.fromCharCode(92) + '"');
  expect(oddJson).toContain(String.fromCharCode(92) + 'u0007');
  expect(oddJson).not.toContain(String.fromCodePoint(7));
  expect((JSON.parse(oddJson) as { name: string }).name).toBe(odd.name);

  // Addresses are text: building and processing manifests that name addresses never calls fetch.
  const processed = processManifest(
    { ...manifest, icons: [{ src: 'https://127.0.0.1:9/icon.png' }], start_url: 'https://127.0.0.1:9/' },
    'https://127.0.0.1:9/manifest.webmanifest',
    'https://127.0.0.1:9/',
  );
  expect(processed.processed.startUrl).toBe('https://127.0.0.1:9/');
  expect(manifestLinkTag('https://127.0.0.1:9/manifest.webmanifest', 'https://127.0.0.1:9/')).toContain(
    'rel="manifest"',
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('the link tag is relative to the page when both share an origin and escapes the address for an HTML attribute', () => {
  expect(manifestLinkTag('https://example.com/app/manifest.webmanifest', 'https://example.com/app/start.html')).toBe(
    '<link rel="manifest" href="/app/manifest.webmanifest">',
  );
  expect(manifestLinkTag('https://example.com/manifest.webmanifest', 'https://example.com/')).toBe(
    '<link rel="manifest" href="/manifest.webmanifest">',
  );
  // Another origin: the whole address.
  expect(manifestLinkTag('https://cdn.example/m/manifest.webmanifest', 'https://example.com/')).toBe(
    '<link rel="manifest" href="https://cdn.example/m/manifest.webmanifest">',
  );
  // A query keeps its parts; & is written as an entity and a single quote is escaped (HTML attribute values).
  expect(manifestLinkTag("https://example.com/it's.json?a=1&b=2", 'https://example.com/')).toBe(
    '<link rel="manifest" href="/it&#39;s.json?a=1&amp;b=2">',
  );
  // The URL parser percent-encodes the characters that could close a tag or an attribute.
  const tag = manifestLinkTag('https://example.com/a"b<c>d.json?x="y"', 'https://example.com/');
  expect(tag.startsWith('<link rel="manifest" href="')).toBe(true);
  expect(tag.endsWith('">')).toBe(true);
  expect(tag.slice('<link rel="manifest" href="'.length, -2)).not.toMatch(/["<>]/);
  // An address that cannot be read falls back to the example address, so a tag is always given.
  expect(manifestLinkTag('not an address', 'also not')).toBe('<link rel="manifest" href="/manifest.webmanifest">');
});

it('fields, rows and JSON over the limits are refused naming the field and never repeating the text', () => {
  expect(MAX_FIELD_CHARACTERS).toBe(2_048);
  expect(MAX_ICONS).toBe(50);
  expect(MAX_SHORTCUTS).toBe(20);
  expect(MAX_JSON_BYTES).toBe(262_144);

  const long = 'FODT-LONG-' + 'x'.repeat(MAX_FIELD_CHARACTERS);
  function refusal(run: () => unknown): ManifestBuilderError {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestBuilderError);
      return error as ManifestBuilderError;
    }
    throw new Error('expected a refusal');
  }

  const field = refusal(() => buildManifest({ name: long }));
  expect(field.message).toContain('name');
  expect(field.message).toContain('2,048');
  expect(field.message).not.toContain('FODT-LONG');
  expect(refusal(() => buildManifest({ startUrl: long })).message).toContain('start_url');
  expect(refusal(() => buildManifest({ displayOverride: long })).message).toContain('display_override');
  const cell = refusal(() => buildManifest({ icons: [['a.png', '48x48', 'image/png', long]] }));
  expect(cell.message).toContain('icons');
  expect(cell.message).toContain('row 1');
  expect(cell.message).not.toContain('FODT-LONG');
  expect(
    refusal(() =>
      buildManifest({
        shortcuts: [
          ['x', '/x'],
          ['Name', long],
        ],
      }),
    ).message,
  ).toContain('row 2');

  // Exactly the limit is fine, counted in code points: 2,048 grinning faces are 4,096 UTF-16 code units.
  const face = String.fromCodePoint(0x1f600);
  expect(() => buildManifest({ name: face.repeat(MAX_FIELD_CHARACTERS) })).not.toThrow();
  expect(() => buildManifest({ name: face.repeat(MAX_FIELD_CHARACTERS + 1) })).toThrow(ManifestBuilderError);

  // 50 icons and 20 shortcuts are fine; one more of each is refused.
  const icon = (n: number) => [`icon-${n}.png`, '48x48', '', ''];
  expect(buildManifest({ icons: Array.from({ length: MAX_ICONS }, (_, n) => icon(n)) }).icons).toHaveLength(MAX_ICONS);
  const tooManyIcons = refusal(() =>
    buildManifest({ icons: Array.from({ length: MAX_ICONS + 1 }, (_, n) => icon(n)) }),
  );
  expect(tooManyIcons.message).toContain('50 icons');
  const shortcut = (n: number) => [`Shortcut ${n}`, `/s${n}`];
  expect(
    buildManifest({ shortcuts: Array.from({ length: MAX_SHORTCUTS }, (_, n) => shortcut(n)) }).shortcuts,
  ).toHaveLength(MAX_SHORTCUTS);
  const tooManyShortcuts = refusal(() =>
    buildManifest({ shortcuts: Array.from({ length: MAX_SHORTCUTS + 1 }, (_, n) => shortcut(n)) }),
  );
  expect(tooManyShortcuts.message).toContain('20 shortcuts');
  // Rows with nothing in them do not count towards the limit.
  const blanks = Array.from({ length: 200 }, () => ['', '', '', '']);
  expect(() => buildManifest({ icons: [...blanks, icon(1)] })).not.toThrow();

  // A manifest whose JSON would pass 262,144 bytes is refused: 50 icons of four 2,048 character cells.
  const bigCell = 'y'.repeat(MAX_FIELD_CHARACTERS);
  const bigRows = Array.from({ length: MAX_ICONS }, () => [bigCell, bigCell, bigCell, bigCell]);
  const big = refusal(() => buildManifest({ icons: bigRows }));
  expect(big.message).toContain('262,144');
  // The processing step refuses the same oversized lists.
  expect(() =>
    processManifest(
      { icons: Array.from({ length: MAX_ICONS + 1 }, (_, n) => ({ src: `i${n}.png` })) },
      MANIFEST_URL,
      PAGE_URL,
    ),
  ).toThrow(ManifestBuilderError);
  expect(() =>
    processManifest(
      { shortcuts: Array.from({ length: MAX_SHORTCUTS + 1 }, (_, n) => ({ name: 'x', url: `/s${n}` })) },
      MANIFEST_URL,
      PAGE_URL,
    ),
  ).toThrow(ManifestBuilderError);
});

it('install advice is a separate list of what browsers look for and is never part of the manifest', () => {
  const good = processManifest(
    buildManifest({
      name: 'Racer',
      startUrl: '/',
      display: 'standalone',
      icons: [
        ['icon-192.png', '192x192', 'image/png', ''],
        ['icon-512.png', '512x512', 'image/png', ''],
      ],
    }),
    'https://example.com/manifest.webmanifest',
    'https://example.com/',
  );
  expect(installAdvice(good.processed)).toEqual([]);
  // A scalable icon (any) covers every size.
  const scalable = processManifest(
    { name: 'Racer', display: 'fullscreen', icons: [{ src: 'icon.svg', sizes: 'any' }] },
    'https://example.com/manifest.webmanifest',
    'https://example.com/',
  );
  expect(installAdvice(scalable.processed)).toEqual([]);

  const bare = processManifest({}, 'http://example.com/manifest.webmanifest', 'http://example.com/');
  const advice = installAdvice(bare.processed);
  expect(advice.length).toBe(5);
  expect(advice.join('\n')).toContain('192');
  expect(advice.join('\n')).toContain('512');
  expect(advice.join('\n')).toContain('name');
  expect(advice.join('\n')).toContain('standalone');
  expect(advice.join('\n')).toContain('HTTPS');
  // Only what is missing is listed: the 192 pixel icon is there, the 512 pixel one is not.
  const half = processManifest(
    { name: 'Racer', display: 'minimal-ui', icons: [{ src: 'a.png', sizes: '192x192' }] },
    'https://example.com/manifest.webmanifest',
    'https://example.com/',
  );
  const halfAdvice = installAdvice(half.processed);
  expect(halfAdvice).toHaveLength(1);
  expect(halfAdvice[0]).toContain('512');
  // A local address is treated as secure by browsers, so it needs no HTTPS advice.
  const local = processManifest(
    { name: 'Racer', display: 'standalone', icons: [{ src: 'a.png', sizes: 'any' }] },
    'http://localhost:8080/manifest.webmanifest',
    'http://localhost:8080/',
  );
  expect(installAdvice(local.processed)).toEqual([]);
  // The advice is not in the manifest and never mentions a product.
  expect(JSON.stringify(buildManifest({ name: 'Racer' }))).not.toContain('192');
  expect(advice.join(' ')).not.toMatch(/chrome|firefox|safari|edge|google|apple|microsoft/i);
});

it('nothing is written to the console while building or processing', () => {
  const manifest = buildManifest({
    name: 'Racer',
    startUrl: 'https://other.example/',
    themeColor: 'nonsense',
    lang: 'e_',
    icons: [['a.png', 'bad', 'not a mime', 'fizzbuzz']],
    shortcuts: [['', '/x']],
  });
  processManifest(manifest, MANIFEST_URL, PAGE_URL);
  processManifest(manifest, 'nothing', 'nothing');
  manifestLinkTag('nothing', 'nothing');
  installAdvice(processManifest(manifest, MANIFEST_URL, PAGE_URL).processed);
  try {
    buildManifest({ name: 'x'.repeat(MAX_FIELD_CHARACTERS + 1) });
  } catch {
    // The refusal is expected; only the console is checked.
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
