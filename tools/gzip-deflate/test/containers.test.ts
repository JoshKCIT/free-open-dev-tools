import { it, expect, describe } from 'vitest';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { detectContainer, decompressBytes, crc32, adler32 } from '../src/index';

function bytesFromNumbers(nums: number[]): Uint8Array {
  return Uint8Array.from(nums);
}

interface BuildOpts {
  mtime: number;
  xfl: number;
  os: number;
  extra?: Uint8Array;
  name?: string;
  comment?: string;
  withFhcrc: boolean;
  body: Uint8Array;
}

/** Builds one hand-crafted gzip member with every optional field, so container.ts's header reader can be checked against a fixture with known values. */
function buildGzipMember(opts: BuildOpts): Uint8Array {
  let flg = 0;
  if (opts.extra) flg |= 0x04;
  if (opts.name !== undefined) flg |= 0x08;
  if (opts.comment !== undefined) flg |= 0x10;
  if (opts.withFhcrc) flg |= 0x02;
  const header: number[] = [
    0x1f,
    0x8b,
    8,
    flg,
    opts.mtime & 0xff,
    (opts.mtime >> 8) & 0xff,
    (opts.mtime >> 16) & 0xff,
    (opts.mtime >>> 24) & 0xff,
    opts.xfl,
    opts.os,
  ];
  if (opts.extra) {
    header.push(opts.extra.length & 0xff, (opts.extra.length >> 8) & 0xff, ...Array.from(opts.extra));
  }
  if (opts.name !== undefined) {
    for (let i = 0; i < opts.name.length; i++) header.push(opts.name.charCodeAt(i));
    header.push(0);
  }
  if (opts.comment !== undefined) {
    for (let i = 0; i < opts.comment.length; i++) header.push(opts.comment.charCodeAt(i));
    header.push(0);
  }
  let headerBytes = bytesFromNumbers(header);
  if (opts.withFhcrc) {
    const fhcrc = crc32(headerBytes) & 0xffff;
    headerBytes = bytesFromNumbers([...header, fhcrc & 0xff, (fhcrc >> 8) & 0xff]);
  }
  const deflated = deflateRawSync(Buffer.from(opts.body));
  const bodyCrc = crc32(opts.body);
  const isize = opts.body.length >>> 0;
  const trailer = bytesFromNumbers([
    bodyCrc & 0xff,
    (bodyCrc >> 8) & 0xff,
    (bodyCrc >> 16) & 0xff,
    (bodyCrc >>> 24) & 0xff,
    isize & 0xff,
    (isize >> 8) & 0xff,
    (isize >> 16) & 0xff,
    (isize >>> 24) & 0xff,
  ]);
  const out = new Uint8Array(headerBytes.length + deflated.length + trailer.length);
  out.set(headerBytes, 0);
  out.set(deflated, headerBytes.length);
  out.set(trailer, headerBytes.length + deflated.length);
  return out;
}

describe('detectContainer', () => {
  it('detects gzip from the 1F 8B 08 signature', () => {
    const member = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('x') });
    expect(detectContainer(member)).toBe('gzip');
  });

  it('detects zlib from 78 01 / 78 9C / 78 DA', () => {
    for (const level of [0, 6, 9]) {
      const z = deflateSync(Buffer.from('x'), { level });
      expect(detectContainer(new Uint8Array(z))).toBe('zlib');
    }
  });

  it('falls back to raw for anything else', () => {
    expect(detectContainer(deflateRawSync(Buffer.from('x')))).toBe('raw');
  });
});

describe('RFC 1952 gzip header', () => {
  it('reads FEXTRA, FNAME (ISO 8859-1 byte E9 as é), FCOMMENT and a correct FHCRC', () => {
    const member = buildGzipMember({
      mtime: 1_700_000_000,
      xfl: 2,
      os: 3,
      extra: bytesFromNumbers([1, 2, 3]),
      name: 'café.txt',
      comment: 'a comment',
      withFhcrc: true,
      body: new TextEncoder().encode('hello world'),
    });
    const result = decompressBytes(member);
    expect(result.container).toBe('gzip');
    expect(result.members).toHaveLength(1);
    const m = result.members[0]!;
    expect(m.mtime).toBe(1_700_000_000);
    expect(m.xfl).toBe(2);
    expect(m.os).toBe(3);
    expect(m.osName).toBe('Unix');
    expect(m.name).toBe('café.txt');
    expect(m.comment).toBe('a comment');
    expect(m.extra).toEqual(bytesFromNumbers([1, 2, 3]));
    expect(m.headerCrc).toBe(true);
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello world');
  });

  it('a wrong FHCRC is kind checksum', () => {
    const member = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: true, body: new TextEncoder().encode('x') });
    // Corrupt the FHCRC bytes (right after the fixed 10-byte header, since no other optional fields are present).
    member[10] = member[10]! ^ 0xff;
    try {
      decompressBytes(member);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('checksum');
    }
  });

  it('a reserved FLG bit set is kind container', () => {
    const member = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('x') });
    member[3] = member[3]! | 0x20;
    try {
      decompressBytes(member);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('container');
    }
  });

  it('CM other than 8 is kind container', () => {
    const member = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('x') });
    member[2] = 7;
    // Auto-detection no longer recognises this as gzip once CM != 8 (the 1F 8B 08 signature check itself
    // fails), so the container is forced here to exercise parseGzipHeader's own CM check directly.
    try {
      decompressBytes(member, { container: 'gzip' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('container');
    }
  });

  it('a flipped CRC-32 byte is kind checksum', () => {
    const member = buildGzipMember({
      mtime: 0,
      xfl: 0,
      os: 3,
      withFhcrc: false,
      body: new TextEncoder().encode('hello'),
    });
    member[member.length - 8] = member[member.length - 8]! ^ 0xff;
    try {
      decompressBytes(member);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('checksum');
    }
  });

  it('a wrong ISIZE is kind checksum', () => {
    const member = buildGzipMember({
      mtime: 0,
      xfl: 0,
      os: 3,
      withFhcrc: false,
      body: new TextEncoder().encode('hello'),
    });
    member[member.length - 1] = member[member.length - 1]! ^ 0xff;
    try {
      decompressBytes(member);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('checksum');
    }
  });

  it('a header, body or trailer cut short is kind truncated', () => {
    const member = buildGzipMember({
      mtime: 0,
      xfl: 0,
      os: 3,
      withFhcrc: false,
      body: new TextEncoder().encode('hello'),
    });
    try {
      decompressBytes(member.slice(0, member.length - 3));
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('truncated');
    }
  });

  it('concatenated members decode to the concatenation', () => {
    const m1 = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('hello ') });
    const m2 = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('world') });
    const both = new Uint8Array(m1.length + m2.length);
    both.set(m1, 0);
    both.set(m2, m1.length);
    const result = decompressBytes(both);
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello world');
    expect(result.members).toHaveLength(2);
  });

  it('bytes after the last member give a warning and are reported in trailingBytes', () => {
    const member = buildGzipMember({ mtime: 0, xfl: 0, os: 3, withFhcrc: false, body: new TextEncoder().encode('x') });
    const withGarbage = new Uint8Array(member.length + 3);
    withGarbage.set(member, 0);
    withGarbage.set([1, 2, 3], member.length);
    const result = decompressBytes(withGarbage);
    expect(result.trailingBytes).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('RFC 1950 zlib header', () => {
  it('78 9D fails its own FCHECK (forced zlib gives kind container)', () => {
    const bad = bytesFromNumbers([0x78, 0x9d, ...Array.from(deflateRawSync(Buffer.from('x')))]);
    try {
      decompressBytes(bad, { container: 'zlib' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('container');
    }
  });

  it('78 BB (FDICT set) gives kind container naming the preset dictionary', () => {
    const bad = bytesFromNumbers([0x78, 0xbb, ...Array.from(deflateRawSync(Buffer.from('x')))]);
    try {
      decompressBytes(bad, { container: 'zlib' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('container');
      expect((e as Error).message).toMatch(/preset dictionary/);
    }
  });

  it('CINFO 8 is refused', () => {
    const bad = bytesFromNumbers([0x88, 0x1a, ...Array.from(deflateRawSync(Buffer.from('x')))]);
    try {
      decompressBytes(bad, { container: 'zlib' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('container');
    }
  });

  it('Adler-32 of empty input is 1 (RFC 1950 section 8.2)', () => {
    expect(adler32(new Uint8Array(0))).toBe(1);
  });

  it('a flipped Adler-32 byte is kind checksum', () => {
    const z = deflateSync(Buffer.from('hello'), { level: 6 });
    const bytes = new Uint8Array(z);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    try {
      decompressBytes(bytes, { container: 'zlib' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('checksum');
    }
  });

  it('round trips through zlib and reports the level hint', () => {
    const z = deflateSync(Buffer.from('hello world'), { level: 9 });
    const result = decompressBytes(new Uint8Array(z));
    expect(result.container).toBe('zlib');
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello world');
    expect(result.zlibHeader?.levelHint).toBe('maximum');
  });
});
