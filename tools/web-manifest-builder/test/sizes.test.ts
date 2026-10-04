import { it, expect } from 'vitest';
import { parseIconPurpose, parseIconSizes, parseMimeEssence, processManifest } from '../src/index';

// Expected values come from Image Resource section 6 (processing an image resource from JSON), the HTML Standard's
// rules for the sizes attribute of link rel=icon (split on ASCII whitespace; any; exactly one x or X; no leading zero;
// ASCII digits only), the Web Application Manifest draft's rules for the purpose of an image (the icon purposes list
// monochrome, maskable and any; unknown keywords dropped; no known keyword means the icon is ignored; any when there is
// no purpose) and the MIME Sniffing Standard's parsing of a MIME type.

const MANIFEST_URL = 'https://example.com/manifest.webmanifest';
const PAGE_URL = 'https://example.com/';

it('icon sizes and purposes follow the W3C image resource rules and invalid ones are reported', () => {
  expect(parseIconSizes('48x48 96x96')).toEqual({ sizes: ['48x48', '96x96'], invalid: [] });
  expect(parseIconSizes('any')).toEqual({ sizes: ['any'], invalid: [] });
  // The draft's example 3: an icon file that holds several raster icons.
  expect(parseIconSizes('72x72 96x96 128x128 256x256')).toEqual({
    sizes: ['72x72', '96x96', '128x128', '256x256'],
    invalid: [],
  });
  // The x may be upper case and is shown in lower case; any is read in either case.
  expect(parseIconSizes('48X48 ANY')).toEqual({ sizes: ['48x48', 'any'], invalid: [] });
  // A leading zero, more than one x, a missing side, signs, units and non-ASCII digits do not represent a size.
  expect(parseIconSizes('048x048')).toEqual({ sizes: [], invalid: ['048x048'] });
  expect(parseIconSizes('10x10x10')).toEqual({ sizes: [], invalid: ['10x10x10'] });
  expect(parseIconSizes('0x0')).toEqual({ sizes: [], invalid: ['0x0'] });
  for (const bad of ['48x', 'x48', '4a8x48', '-48x48', '+48x48', '48x48px', '48', 'x', 'fizz']) {
    expect(parseIconSizes(bad), bad).toEqual({ sizes: [], invalid: [bad] });
  }
  // Spaces split the keywords, so each part of "48 x 48" is judged alone.
  expect(parseIconSizes('48 x 48')).toEqual({ sizes: [], invalid: ['48', 'x', '48'] });
  expect(parseIconSizes('48x48 foo 96x96')).toEqual({ sizes: ['48x48', '96x96'], invalid: ['foo'] });
  // Arabic-Indic digits are not ASCII digits.
  const arabicDigits = String.fromCodePoint(0x661, 0x662) + 'x' + String.fromCodePoint(0x661, 0x662);
  expect(parseIconSizes(arabicDigits)).toEqual({ sizes: [], invalid: [arabicDigits] });
  // Split on ASCII whitespace: tabs, line feeds, form feeds, carriage returns and spaces; the empty string has nothing.
  expect(parseIconSizes('  48x48\t96x96\n192x192\f512x512\r ')).toEqual({
    sizes: ['48x48', '96x96', '192x192', '512x512'],
    invalid: [],
  });
  expect(parseIconSizes('')).toEqual({ sizes: [], invalid: [] });
  expect(parseIconSizes('   ')).toEqual({ sizes: [], invalid: [] });

  // Purposes: monochrome, maskable and any are known; any other keyword is dropped; no known keyword ignores the icon.
  expect(parseIconPurpose('maskable any')).toEqual({ kept: ['maskable', 'any'], dropped: [], ignoredIcon: false });
  expect(parseIconPurpose('monochrome fizzbuzz')).toEqual({
    kept: ['monochrome'],
    dropped: ['fizzbuzz'],
    ignoredIcon: false,
  });
  expect(parseIconPurpose('fizzbuzz')).toEqual({ kept: [], dropped: ['fizzbuzz'], ignoredIcon: true });
  expect(parseIconPurpose('any')).toEqual({ kept: ['any'], dropped: [], ignoredIcon: false });
  // The draft returns a set: a repeated keyword is kept once.
  expect(parseIconPurpose('any any maskable')).toEqual({ kept: ['any', 'maskable'], dropped: [], ignoredIcon: false });
  expect(parseIconPurpose('  maskable\tmonochrome\n')).toEqual({
    kept: ['maskable', 'monochrome'],
    dropped: [],
    ignoredIcon: false,
  });
  // Keywords are compared exactly, so an upper case one is unknown; an empty purpose holds no keyword.
  expect(parseIconPurpose('MASKABLE')).toEqual({ kept: [], dropped: ['MASKABLE'], ignoredIcon: true });
  expect(parseIconPurpose('')).toEqual({ kept: [], dropped: [], ignoredIcon: true });
  // Names such as __proto__ and constructor are keywords like any other.
  expect(parseIconPurpose('__proto__ constructor toString')).toEqual({
    kept: [],
    dropped: ['__proto__', 'constructor', 'toString'],
    ignoredIcon: true,
  });

  // The same rules inside a manifest, with a finding for each thing that was left out.
  const result = processManifest(
    {
      icons: [
        { src: 'a.png', sizes: '48x48 96x96', type: 'image/png', purpose: 'maskable any' },
        { src: 'b.png', sizes: 'any' },
        { src: 'c.png', sizes: '048x048' },
        { src: 'd.png', purpose: 'fizzbuzz' },
        { src: 'e.png', purpose: 'monochrome fizzbuzz' },
        { notsrc: 1 },
        { src: 'f.png', sizes: '10x10x10' },
        'not an object',
        { src: 'g.png', sizes: 5, type: 5, purpose: 5 },
      ],
    },
    MANIFEST_URL,
    PAGE_URL,
  );
  expect(result.processed.icons.map((icon) => [icon.src.split('/').pop(), icon.sizes, icon.purposes])).toEqual([
    ['a.png', ['48x48', '96x96'], ['maskable', 'any']],
    ['b.png', ['any'], ['any']],
    ['c.png', [], ['any']],
    ['e.png', [], ['monochrome']],
    ['f.png', [], ['any']],
    ['g.png', [], ['any']],
  ]);
  const messages = result.findings.filter((finding) => finding.member === 'icons');
  const ignored = messages.filter((finding) => finding.severity === 'ignored');
  // Icon 4 (purpose), icon 6 (no src) and icon 8 (not an object) are left out entirely.
  for (const position of [4, 6, 8]) {
    expect(
      ignored.some((finding) => finding.message.startsWith(`Icon ${position}`)),
      `icon ${position}`,
    ).toBe(true);
  }
  expect(ignored).toHaveLength(3);
  // Icons 3 and 7 are kept, with a warning that no size could be read; icon 5 has a warning for its dropped keyword.
  const warned = messages.filter((finding) => finding.severity === 'warning');
  // Icon 3 (048x048) and icon 7 (10x10x10) have no size at all; icon 5 has a purpose keyword that is not known.
  const messageOf = (position: number) =>
    warned.find((finding) => finding.message.startsWith('Icon ' + position + ' '))?.message ?? '';
  expect(messageOf(3)).toContain('no usable size');
  expect(messageOf(7)).toContain('no usable size');
  expect(messageOf(5)).toContain('purpose keyword');
  for (const position of [3, 5, 7]) {
    expect(
      warned.some((finding) => finding.message.startsWith(`Icon ${position}`)),
      `icon ${position}`,
    ).toBe(true);
  }
  // Findings name the position and never the text.
  for (const finding of messages) {
    expect(finding.message).not.toContain('fizzbuzz');
    expect(finding.message).not.toContain('048x048');
  }
  // No icon at all: a finding says so.
  expect(
    processManifest({}, MANIFEST_URL, PAGE_URL).findings.filter(
      (finding) => finding.member === 'icons' && finding.severity === 'warning',
    ),
  ).toHaveLength(1);
  expect(
    processManifest({ icons: [] }, MANIFEST_URL, PAGE_URL).findings.filter(
      (finding) => finding.member === 'icons' && finding.severity === 'warning',
    ),
  ).toHaveLength(1);
  // An icon address is resolved against the manifest address and never fetched.
  const resolved = processManifest(
    { icons: [{ src: '../up.png' }, { src: 'https://cdn.example/x.png' }] },
    'https://example.com/a/b/manifest.webmanifest',
    PAGE_URL,
  );
  expect(resolved.processed.icons.map((icon) => icon.src)).toEqual([
    'https://example.com/a/up.png',
    'https://cdn.example/x.png',
  ]);
  // A value that is not a list is ignored with a finding.
  const notList = processManifest({ icons: 'a.png' }, MANIFEST_URL, PAGE_URL);
  expect(notList.processed.icons).toEqual([]);
  expect(notList.findings.filter((finding) => finding.member === 'icons').map((finding) => finding.severity)).toContain(
    'ignored',
  );
});

it('icon types are read as MIME types and an icon with a type that is not one is ignored', () => {
  // MIME Sniffing: type "/" subtype, both non-empty strings of HTTP token code points; the essence is lower case and
  // leaves out any parameters.
  expect(parseMimeEssence('image/png')).toBe('image/png');
  expect(parseMimeEssence('IMAGE/PNG')).toBe('image/png');
  expect(parseMimeEssence('image/svg+xml')).toBe('image/svg+xml');
  expect(parseMimeEssence('image/vnd.microsoft.icon')).toBe('image/vnd.microsoft.icon');
  expect(parseMimeEssence(' image/png ; charset=utf-8')).toBe('image/png');
  expect(parseMimeEssence('text/plain')).toBe('text/plain');
  for (const bad of [
    'not a mime',
    'image',
    'image/',
    '/png',
    'image/png/x',
    'image /png',
    '',
    ' ',
    'im(age/png',
    'a/b c',
  ]) {
    expect(parseMimeEssence(bad), JSON.stringify(bad)).toBeNull();
  }
  // Inside a manifest: the essence is kept; a type that is not a MIME type ignores the icon (Image Resource section 6).
  const result = processManifest(
    {
      icons: [
        { src: 'a.png', type: 'IMAGE/PNG; q=1' },
        { src: 'b.png', type: 'not a mime' },
        { src: 'c.png', type: '' },
      ],
    },
    MANIFEST_URL,
    PAGE_URL,
  );
  expect(result.processed.icons.map((icon) => [icon.src.split('/').pop(), icon.type])).toEqual([
    ['a.png', 'image/png'],
    ['c.png', ''],
  ]);
  expect(
    result.findings.filter((finding) => finding.member === 'icons' && finding.severity === 'ignored'),
  ).toHaveLength(1);
});
