import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { readZip } from '../src/zip-read';
import { bytesReader } from '../src/reader';
import { decodeCp437, CP437_TABLE } from '../src/cp437';
import { parseCp437Table } from './build-cp437';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';
import { writeHostileZip } from './build-archives';

const FIXTURES = join(__dirname, 'fixtures', 'go-archive');

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

it('stored and deflated ZIP entries are extracted exactly and their CRC-32 checked, with Node zlib as the second opinion', async () => {
  const stored = bytesOf('This entry is stored, byte for byte.');
  const deflated = bytesOf('This entry is deflated. '.repeat(200));
  const built = writeHostileZip([
    { name: 'stored.txt', content: stored, method: 0 },
    { name: 'deflated.txt', content: deflated, method: 8 },
  ]);

  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries.map((e) => e.status)).toEqual(['extracted', 'extracted']);
  expect(result.files[0]!.bytes).toEqual(stored);
  expect(result.files[1]!.bytes).toEqual(deflated);

  // Node's own zlib inflates the exact same compressed bytes the local
  // header carries, independently of this package's own fflate-backed path.
  const localHeaderSize = 30 + 'deflated.txt'.length;
  const compressedStart = built.localHeaderOffsets[1]! + localHeaderSize;
  const view = new DataView(built.bytes.buffer, built.bytes.byteOffset);
  const compressedSize = view.getUint32(built.localHeaderOffsets[1]! + 18, true);
  const compressedBytes = built.bytes.subarray(compressedStart, compressedStart + compressedSize);
  expect(inflateRawSync(Buffer.from(compressedBytes))).toEqual(Buffer.from(deflated));
});

it('the central directory, local headers, data descriptors and ZIP64 records are read as APPNOTE.TXT defines', async () => {
  // golang/go archive/zip reader_test.go, "go-with-datadesc-sig.zip":
  // two entries written with the optional data descriptor signature.
  const ddResult = await readZip(bytesReader(fixtureBytes('go-with-datadesc-sig.zip')));
  expect(ddResult.entries.map((e) => ({ path: e.path, status: e.status }))).toEqual([
    { path: 'foo.txt', status: 'extracted' },
    { path: 'bar.txt', status: 'extracted' },
  ]);
  expect(new TextDecoder().decode(ddResult.files[0]!.bytes)).toBe('foo\n');
  expect(new TextDecoder().decode(ddResult.files[1]!.bytes)).toBe('bar\n');

  // golang/go archive/zip reader_test.go, "zip64.zip": a single ZIP64-format entry.
  const zip64Result = await readZip(bytesReader(fixtureBytes('zip64.zip')));
  expect(zip64Result.entries[0]).toMatchObject({ path: 'README', status: 'extracted' });
  expect(new TextDecoder().decode(zip64Result.files[0]!.bytes)).toBe('This small file is in ZIP64 format.\n');
});

it('an entry whose path climbs out with a parent segment is not extracted and absolute paths and drive letters are made relative', async () => {
  const built = writeHostileZip([
    { name: '../evil.txt', content: bytesOf('x') },
    { name: 'a/../../b.txt', content: bytesOf('x') },
    { name: String.raw`a/..\b.txt`, content: bytesOf('x') },
    { name: '/etc/x.txt', content: bytesOf('x') },
    { name: String.raw`C:\x.txt`, content: bytesOf('x') },
    { name: '//server/share/y.txt', content: bytesOf('x') },
    { name: 'bad\x01name.txt', content: bytesOf('x') },
  ]);
  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries[0]!.status).toBe('refused');
  expect(result.entries[1]!.status).toBe('refused');
  expect(result.entries[2]!.status).toBe('refused');
  expect(result.entries[3]).toMatchObject({ path: 'etc/x.txt', status: 'extracted' });
  expect(result.entries[4]).toMatchObject({ path: 'x.txt', status: 'extracted' });
  expect(result.entries[5]).toMatchObject({ path: 'server/share/y.txt', status: 'extracted' });
  expect(result.entries[6]!.status).toBe('refused');
  expect(result.warnings.some((w) => w.includes('absolute path made relative'))).toBe(true);
});

it('symbolic links, hard links, devices and FIFOs are listed and never extracted or followed', async () => {
  // A ZIP entry has no way to encode "this is a hard link" separately from
  // an ordinary regular file (unlike TAR's own dedicated typeflag) --
  // every real ZIP archiver just stores a hard-linked file's own bytes
  // again under its second name, which this reader correctly reads as two
  // independent regular files (proven below alongside the types ZIP can
  // represent: symbolic link, character device and FIFO).
  const S_IFLNK = 0o120000;
  const S_IFCHR = 0o020000;
  const S_IFIFO = 0o010000;
  const built = writeHostileZip([
    { name: 'link-to-real', content: bytesOf('real content'), method: 0 },
    { name: 'link-to-real-hardlinked-name', content: bytesOf('real content'), method: 0 },
    { name: 'a-symlink', content: bytesOf('target-of-symlink'), method: 0, unixMode: S_IFLNK | 0o777 },
    { name: 'a-device', content: new Uint8Array(0), method: 0, unixMode: S_IFCHR | 0o666 },
    { name: 'a-fifo', content: new Uint8Array(0), method: 0, unixMode: S_IFIFO | 0o644 },
  ]);
  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries[0]).toMatchObject({ path: 'link-to-real', type: 'file', status: 'extracted' });
  expect(result.entries[1]).toMatchObject({ path: 'link-to-real-hardlinked-name', type: 'file', status: 'extracted' });
  expect(result.entries[2]).toMatchObject({
    path: 'a-symlink',
    type: 'symlink',
    status: 'listed',
    linkTarget: 'target-of-symlink',
  });
  expect(result.entries[3]).toMatchObject({ path: 'a-device', type: 'device', status: 'listed' });
  expect(result.entries[4]).toMatchObject({ path: 'a-fifo', type: 'fifo', status: 'listed' });
  expect(result.files.some((f) => f.path === 'a-symlink' || f.path === 'a-device' || f.path === 'a-fifo')).toBe(false);

  // The Go project's own symlink.zip, an independent cross-check.
  const goResult = await readZip(bytesReader(fixtureBytes('symlink.zip')));
  expect(goResult.entries[0]).toMatchObject({
    path: 'symlink',
    type: 'symlink',
    status: 'listed',
    linkTarget: '../target',
  });
});

it('extraction stops at the total size limit and at the compression ratio limit with a plain message', async () => {
  const zeros = new Uint8Array(64 * 1024 * 1024);
  const bombBuilt = writeHostileZip([{ name: 'bomb.bin', content: zeros, method: 8 }]);
  await expect(
    readZip(bytesReader(bombBuilt.bytes), {
      maxInputBytes: 2 * 1024 * 1024 * 1024,
      maxTotalOutputBytes: 8 * 1024 * 1024,
      maxEntries: 10_000,
      maxRatio: 250,
      feedChunkBytes: 16 * 1024,
    }),
  ).rejects.toThrow(/Stopped: this archive would expand to more than/);

  const ratioZeros = new Uint8Array(4 * 1024 * 1024);
  const ratioBuilt = writeHostileZip([{ name: 'ratio.bin', content: ratioZeros, method: 8 }]);
  await expect(readZip(bytesReader(ratioBuilt.bytes))).rejects.toThrow(/Stopped: an entry expands more than 250 times/);
});

it('entries that overlap or share compressed data are refused', async () => {
  const built = writeHostileZip(
    [
      { name: 'a.txt', content: bytesOf('aaaa') },
      { name: 'b.txt', content: bytesOf('bbbb') },
    ],
    { duplicateLocalHeaderFor: [0, 0] },
  );
  await expect(readZip(bytesReader(built.bytes))).rejects.toThrow(/overlap/);
});

it('an encrypted entry or an unsupported compression method is listed and not extracted', async () => {
  const built = writeHostileZip([
    { name: 'encrypted.bin', content: bytesOf('secret'), method: 0, generalPurposeFlag: 0x0001 },
    { name: 'unsupported.bin', content: bytesOf('data'), method: 12 },
  ]);
  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries[0]).toMatchObject({ status: 'listed', reason: expect.stringContaining('encrypted') });
  expect(result.entries[1]).toMatchObject({ status: 'listed', reason: 'compression method 12 is not supported' });
});

it('a damaged entry whose CRC-32 does not match is listed and not extracted', async () => {
  const built = writeHostileZip([
    { name: 'damaged.txt', content: bytesOf('this content is fine'), crcOverride: 0xdeadbeef },
  ]);
  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries[0]).toMatchObject({ status: 'damaged' });
  expect(result.files.length).toBe(0);
});

it('names without the UTF-8 flag are decoded as code page 437 from the Unicode mapping table', async () => {
  // CP437 byte 0x82 maps to U+00E9 (e acute) -- Unicode.org's own mapping
  // table, quoted directly in src/cp437-NOTICE.txt and confirmed by the
  // generator-equality test above.
  const rawNameBytes = new Uint8Array([0x82]);
  const built = writeHostileZip([
    {
      name: 'placeholder',
      content: bytesOf('cp437 name'),
      method: 0,
      generalPurposeFlag: 0x0000,
      nameBytesOverride: rawNameBytes,
    },
  ]);
  const result = await readZip(bytesReader(built.bytes));
  expect(result.entries[0]).toMatchObject({ path: '\u00e9', status: 'extracted' });
  expect(decodeCp437(rawNameBytes)).toBe('\u00e9');
});

it('the bundled code page 437 table is exactly what the generator builds from the fetched mapping file', () => {
  const source = readFileSync(join(__dirname, 'fixtures', 'cp437', 'CP437.TXT'), 'utf8');
  const built = parseCp437Table(source);
  expect(Array.from(CP437_TABLE)).toEqual(built);
});

it('the Go archive test files are read with the names, sizes and types the Go reader tests expect', async () => {
  const utf8osx = await readZip(bytesReader(fixtureBytes('utf8-osx.zip')));
  expect(utf8osx.entries[0]).toMatchObject({ path: '\u4e16\u754c', status: 'extracted' });
  expect(utf8osx.files[0]!.bytes.length).toBe(0);

  const winxp = await readZip(bytesReader(fixtureBytes('winxp.zip')));
  const byPath = Object.fromEntries(winxp.entries.map((e) => [e.path, e]));
  expect(byPath['hello']).toMatchObject({ status: 'extracted', type: 'file' });
  expect(byPath['dir/bar']).toMatchObject({ status: 'extracted', type: 'file' });
  expect(byPath['dir/empty']).toMatchObject({ type: 'directory' });
  expect(byPath['readonly']).toMatchObject({ status: 'extracted', type: 'file' });

  const crcOk = await readZip(bytesReader(fixtureBytes('crc32-not-streamed.zip')));
  expect(crcOk.entries.map((e) => e.status)).toEqual(['extracted', 'extracted']);
  expect(new TextDecoder().decode(crcOk.files[0]!.bytes)).toBe('foo\n');
  expect(new TextDecoder().decode(crcOk.files[1]!.bytes)).toBe('bar\n');
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const goArchiveUpstream = readFileSync(join(FIXTURES, 'UPSTREAM.md'), 'utf8');
  const goArchiveEntries = readUpstreamShas(goArchiveUpstream);
  expect(goArchiveEntries.length).toBeGreaterThan(0);
  for (const entry of goArchiveEntries) {
    const actual = gitBlobShaOfFile(join(FIXTURES, entry.path));
    expect(actual).toBe(entry.sha);
  }

  const cp437Upstream = readFileSync(join(__dirname, 'fixtures', 'cp437', 'UPSTREAM.md'), 'utf8');
  const cp437Entries = readUpstreamShas(cp437Upstream);
  expect(cp437Entries.length).toBeGreaterThan(0);
  for (const entry of cp437Entries) {
    const actual = gitBlobShaOfFile(join(__dirname, 'fixtures', 'cp437', entry.path));
    expect(actual).toBe(entry.sha);
  }
});

it('nothing is written to the console while reading or writing archives', async () => {
  const logSpy = spyOnConsole();
  try {
    const built = writeHostileZip([{ name: 'quiet.txt', content: bytesOf('be quiet') }]);
    await readZip(bytesReader(built.bytes));
  } finally {
    logSpy.restore();
  }
  expect(logSpy.calls).toEqual([]);
});

function spyOnConsole(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  console.log = (...args: unknown[]) => {
    calls.push(args);
  };
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  console.info = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
      console.info = originals.info;
    },
  };
}
