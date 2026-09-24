import { describe, it, expect } from 'vitest';
import { SIGNATURES, sniffMediaType, looksLikePlainText, detectMediaType } from '../src/signatures';

function ascii(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0));
}

function bytesOf(...groups: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const g of groups) out.push(...(typeof g === 'string' ? ascii(g) : g));
  return new Uint8Array(out);
}

/** Pads a byte array up to `length` with zero bytes, for filler between a header and a later-offset pattern. */
function padded(length: number, ...groups: (number[] | string)[]): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  for (const g of groups) {
    const bytes = typeof g === 'string' ? ascii(g) : g;
    out.set(bytes, pos);
    pos += bytes.length;
  }
  return out;
}

describe('SIGNATURES table shape', () => {
  it('every entry has a media type, a label, a non-empty pattern, an offset and at least one extension', () => {
    expect(SIGNATURES.length).toBeGreaterThanOrEqual(30);
    for (const sig of SIGNATURES) {
      expect(sig.mediaType.length).toBeGreaterThan(0);
      expect(sig.label.length).toBeGreaterThan(0);
      expect(sig.pattern.length).toBeGreaterThan(0);
      expect(sig.offset).toBeGreaterThanOrEqual(0);
      expect(sig.extensions.length).toBeGreaterThan(0);
      if (sig.mask) expect(sig.mask.length).toBe(sig.pattern.length);
    }
  });

  it('no two entries share the same combination of pattern and offset', () => {
    const seen = new Set<string>();
    for (const sig of SIGNATURES) {
      const key = `${sig.offset}:${sig.pattern.join(',')}:${JSON.stringify(sig.mask ?? null)}`;
      expect(seen.has(key), `duplicate pattern+offset: ${sig.label}`).toBe(false);
      seen.add(key);
    }
  });
});

// The four `it(...)` calls below carry exact, verbatim titles that this
// plan's `<verify>` block reads out of the JSON test report by full name.
// They are deliberately top-level, not nested in a `describe`, so each
// one's reported "full name" is the title itself with no describe prefix.

it('each independently transcribed magic-byte fixture is detected as its expected media type', () => {
  const fixtures: { label: string; bytes: Uint8Array; expected: string; source: string }[] = [
    {
      label: 'PNG',
      // W3C PNG spec, "5 PNG file signature": 89 50 4E 47 0D 0A 1A 0A
      bytes: bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]),
      expected: 'image/png',
      source: 'https://www.w3.org/TR/png/#5PNG-file-signature',
    },
    {
      label: 'JPEG (JFIF)',
      // Wikipedia, List of file signatures: FF D8 FF E0 00 10 4A 46 49 46 00 01
      bytes: bytesOf([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF', [0x00, 0x01]),
      expected: 'image/jpeg',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'GIF89a',
      // GIF89a spec: the literal six-byte header "GIF89a"
      bytes: bytesOf('GIF89a', [0x01, 0x00, 0x01, 0x00]),
      expected: 'image/gif',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'BMP',
      // "BM" (0x42 0x4D) then a made-up little-endian file size and reserved fields
      bytes: bytesOf('BM', [0x36, 0x00, 0x00, 0x00]),
      expected: 'image/bmp',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'Windows ICO',
      // 00 00 01 00 (reserved=0, type=1/icon), then image count = 1
      bytes: bytesOf([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
      expected: 'image/x-icon',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'WOFF font',
      // "wOFF" (0x77 0x4F 0x46 0x46)
      bytes: bytesOf('wOFF', [0x00, 0x01, 0x00, 0x00]),
      expected: 'font/woff',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'OpenType font',
      // "OTTO" (0x4F 0x54 0x54 0x4F)
      bytes: bytesOf('OTTO', [0x00, 0x01]),
      expected: 'font/otf',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'MP3 with an ID3v2 tag',
      // "ID3" (0x49 0x44 0x33), tag version, flags, size
      bytes: bytesOf('ID3', [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]),
      expected: 'audio/mpeg',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'WAV audio',
      // RIFF (0x52 0x49 0x46 0x46) + 4-byte size + "WAVE" at offset 8
      bytes: bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'WAVE'),
      expected: 'audio/wav',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'WebP image',
      // RIFF + 4-byte size + "WEBP" at offset 8
      bytes: bytesOf('RIFF', [0x1a, 0x00, 0x00, 0x00], 'WEBP'),
      expected: 'image/webp',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'WebM / Matroska container',
      // EBML root element id, RFC 8794 section 17.1: 0x1A45DFA3
      bytes: bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
      expected: 'video/webm',
      source: 'https://www.rfc-editor.org/rfc/rfc8794 section 17.1',
    },
    {
      label: 'PDF document',
      // "%PDF-" then a version, e.g. "1.7"
      bytes: bytesOf('%PDF-1.7'),
      expected: 'application/pdf',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'ZIP archive (plain, not a known ZIP-based document format)',
      // PK\x03\x04 local file header signature
      bytes: bytesOf([0x50, 0x4b, 0x03, 0x04], [0x14, 0x00, 0x00, 0x00]),
      expected: 'application/zip',
      source: 'https://en.wikipedia.org/wiki/List_of_file_signatures',
    },
    {
      label: 'gzip archive',
      // 1F 8B, RFC 1952 section 2.3.1
      bytes: bytesOf([0x1f, 0x8b, 0x08, 0x00]),
      expected: 'application/gzip',
      source: 'https://www.rfc-editor.org/rfc/rfc1952 section 2.3.1',
    },
  ];

  for (const fixture of fixtures) {
    const result = sniffMediaType(fixture.bytes);
    expect(result?.mediaType, `${fixture.label} (${fixture.source})`).toBe(fixture.expected);
  }
});

it('a generic container is resolved by its inner signature rather than reported as the container', () => {
  // A plain ZIP archive with no further structure: the generic entry answers.
  const plainZip = bytesOf([0x50, 0x4b, 0x03, 0x04], [0, 0, 0, 0]);
  const plainResult = sniffMediaType(plainZip);
  expect(plainResult?.mediaType).toBe('application/zip');
  expect(plainResult?.generic).toBe(true);

  // An EPUB: ZIP local file header at offset 0, "mimetype" at offset 30,
  // "application/epub+zip" at offset 38 -- W3C EPUB 3.3's own magic-number
  // entry (fetched while this file was written). The generic ZIP entry also
  // matches at offset 0, but the EPUB entry's 29-byte pattern is longer, so
  // it wins and is not reported as generic.
  const epub = padded(30 + 'mimetypeapplication/epub+zip'.length, [0x50, 0x4b, 0x03, 0x04]);
  // bytes 4-29 are ordinary ZIP header fields (version, flags, method,
  // time, date, crc, sizes, name length, extra length) this test does not
  // need to be realistic about, because no signature entry reads them.
  epub.set(ascii('mimetypeapplication/epub+zip'), 30);
  const epubResult = sniffMediaType(epub);
  expect(epubResult?.mediaType).toBe('application/epub+zip');
  expect(epubResult?.generic).toBe(false);
});

it('a byte array shorter than the longest signature is handled without reading past its end', () => {
  // The first five bytes of the eight-byte PNG signature: too short to
  // match PNG, and too short for anything else in the table that needs
  // more than five bytes. Must not throw and must not falsely match.
  const tooShort = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
  expect(() => sniffMediaType(tooShort)).not.toThrow();
  expect(sniffMediaType(tooShort)).toBeUndefined();
});

it('an unrecognised byte array falls back to the supplied browser type and says so', () => {
  const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const decision = detectMediaType(junk, 'application/x-custom-thing');
  expect(decision.mediaType).toBe('application/x-custom-thing');
  expect(decision.source).toBe('browser-reported');
});

describe('sniffMediaType: generic containers and equal-length precedence', () => {
  it('an equal-length masked match loses to a same-length fully-fixed match (the ftyp brand case)', () => {
    // ISO-BMFF "ftyp" box: bytes 4-7 literal "ftyp", bytes 8-11 the brand.
    const isomBytes = bytesOf([0, 0, 0, 0], 'ftyp', 'isom');
    const isomResult = sniffMediaType(isomBytes);
    expect(isomResult?.mediaType).toBe('video/mp4');
    expect(isomResult?.generic).toBe(false);
    expect(isomResult?.label).toContain('isom');

    // A brand this table has no specific entry for: only the masked,
    // generic entry matches.
    const unknownBrand = bytesOf([0, 0, 0, 0], 'ftyp', 'M4A ');
    const unknownResult = sniffMediaType(unknownBrand);
    expect(unknownResult?.mediaType).toBe('video/mp4');
    expect(unknownResult?.generic).toBe(true);
  });
});

describe('sniffMediaType: bounds and offsets', () => {
  it('returns nothing for an empty array', () => {
    expect(sniffMediaType(new Uint8Array(0))).toBeUndefined();
  });

  it('a pattern at a non-zero offset matches only when it is actually at that offset', () => {
    // "WEBP" at offset 8, as WebP requires.
    const atRightOffset = bytesOf('RIFF', [0, 0, 0, 0], 'WEBP');
    expect(sniffMediaType(atRightOffset)?.mediaType).toBe('image/webp');

    // The same "WEBP" bytes, shifted one byte later -- must not match.
    const atWrongOffset = bytesOf('RIFF', [0, 0, 0, 0, 0], 'WEBP');
    expect(sniffMediaType(atWrongOffset)?.mediaType).not.toBe('image/webp');
  });

  it('a byte array matching no pattern returns nothing, so the caller can fall back', () => {
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    expect(sniffMediaType(junk)).toBeUndefined();
  });
});

describe('looksLikePlainText: the separate text heuristic', () => {
  it('reports ordinary readable text as plain text, with no signature entry for it', () => {
    expect(SIGNATURES.some((s) => s.label.toLowerCase().includes('plain text'))).toBe(false);
    const text = new TextEncoder().encode('Hello, world! This is ordinary text with a newline.\n');
    expect(looksLikePlainText(text)).toBe(true);
    // And it is not mistaken for a byte-pattern match either.
    expect(sniffMediaType(text)).toBeUndefined();
  });

  it('a byte array containing a null byte is not reported as plain text', () => {
    const withNull = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6f]); // "He\0lo"
    expect(looksLikePlainText(withNull)).toBe(false);
  });

  it('an empty array is not reported as plain text', () => {
    expect(looksLikePlainText(new Uint8Array(0))).toBe(false);
  });
});

describe('detectMediaType: the three-tier precedence with the browser-reported type', () => {
  it('reports unknown when neither a signature nor a browser type is available', () => {
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const decision = detectMediaType(junk, '');
    expect(decision.mediaType).toBe('application/octet-stream');
    expect(decision.source).toBe('unknown');
  });

  it('a specific signature wins even when the browser reported a disagreeing type', () => {
    const png = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]);
    const decision = detectMediaType(png, 'application/octet-stream');
    expect(decision.mediaType).toBe('image/png');
    expect(decision.source).toBe('signature');
  });

  it('a generic ZIP sniff loses to a specific browser-reported type', () => {
    const plainZip = bytesOf([0x50, 0x4b, 0x03, 0x04], [0, 0, 0, 0]);
    const decision = detectMediaType(plainZip, 'application/vnd.oasis.opendocument.text');
    expect(decision.mediaType).toBe('application/vnd.oasis.opendocument.text');
    expect(decision.source).toBe('browser-reported');
  });

  it('a generic ZIP sniff is used when the browser reported nothing at all', () => {
    const plainZip = bytesOf([0x50, 0x4b, 0x03, 0x04], [0, 0, 0, 0]);
    const decision = detectMediaType(plainZip, '');
    expect(decision.mediaType).toBe('application/zip');
    expect(decision.source).toBe('generic-signature');
  });
});
