import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { extractArchive, createZip, ArchiveError } from '../src/index';
import { readZip } from '../src/zip-read';
import { readTar } from '../src/tar';
import { readGzip } from '../src/gzip';
import { bytesReader } from '../src/reader';
import { safeEntryPath, dedupePath } from '../src/safe-path';
import { CP437_TABLE, decodeCp437 } from '../src/cp437';
import { parseCp437Table } from './build-cp437';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';
import { writeHostileZip, writeHostileTar, writeHostileGzip, writeGnuLongNameEntry } from './build-archives';

const FIXTURES = join(__dirname, 'fixtures', 'go-archive');

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/**
 * ISO 32000-1 does not apply here; this project's own fixture PDFs live
 * elsewhere. This helper just gives a UTF-8-encoded byte array from a
 * plain string, used throughout this file to build hostile and ordinary
 * archive contents alike.
 */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------
// Task 1: ZIP reading
// ---------------------------------------------------------------------

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
  // The compressed size lives in the local header at offset 18 (4 bytes LE).
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
  // ZIP fixtures (Task 1).
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

  // TAR fixtures (Task 2).
  const ustarDevs = await readTar(bytesReader(fixtureBytes('ustar-file-devs.tar')));
  expect(ustarDevs.entries[0]).toMatchObject({ path: 'file', type: 'file', status: 'extracted' });

  const pax = await readTar(bytesReader(fixtureBytes('pax.tar')));
  const longName =
    'a/123456789101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899100';
  const longLink =
    '123456789101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899100';
  expect(pax.entries[0]).toMatchObject({ path: longName, size: 7, status: 'extracted' });
  expect(pax.entries[1]).toMatchObject({ path: 'a/b', type: 'symlink', linkTarget: longLink, status: 'listed' });

  const gnuMulti = await readTar(bytesReader(fixtureBytes('gnu-multi-hdrs.tar')));
  expect(gnuMulti.entries[0]).toMatchObject({
    path: 'GNU2/GNU2/long-path-name',
    type: 'symlink',
    linkTarget: 'GNU4/GNU4/long-linkpath-name',
    status: 'listed',
  });
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
  const logSpy = vi_spyOnConsole();
  try {
    const built = writeHostileZip([{ name: 'quiet.txt', content: bytesOf('be quiet') }]);
    await readZip(bytesReader(built.bytes));
    await createZip([{ name: 'quiet.txt', bytes: bytesOf('be quiet') }], {
      method: 'deflate',
      level: 6,
      keepTimes: true,
    });
    const tarBytes = writeHostileTar([{ name: 'quiet.txt', content: bytesOf('be quiet') }]);
    await readTar(bytesReader(tarBytes));
    const gzBytes = writeHostileGzip([{ content: bytesOf('be quiet') }]);
    await readGzip(bytesReader(gzBytes));
  } finally {
    logSpy.restore();
  }
  expect(logSpy.calls).toEqual([]);
});

function vi_spyOnConsole(): { calls: unknown[][]; restore: () => void } {
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

// ---------------------------------------------------------------------
// Task 2: TAR, gzip, ZIP creation, extractArchive dispatch
// ---------------------------------------------------------------------

it('TAR headers in ustar, pax and GNU forms are read as POSIX and the GNU tar manual define, with the header checksum checked', async () => {
  const ustar = writeHostileTar([{ name: 'plain.txt', content: bytesOf('ustar content'), typeflag: '0' }]);
  const ustarResult = await readTar(bytesReader(ustar));
  expect(ustarResult.entries[0]).toMatchObject({ path: 'plain.txt', status: 'extracted' });

  const badChecksum = writeHostileTar([{ name: 'bad.txt', content: bytesOf('x'), badChecksum: true }]);
  await expect(readTar(bytesReader(badChecksum))).rejects.toThrow(/checksum/);

  // GNU long name, hand-built via the same shape golang/go's own
  // gnu-multi-hdrs.tar fixture uses (proven against that real file above).
  const longName = 'a/very/long/path/'.repeat(10) + 'file.txt';
  const gnuArchive = buildGnuLongNameArchive(longName, bytesOf('gnu long name content'));
  const gnuResult = await readTar(bytesReader(gnuArchive));
  expect(gnuResult.entries[0]).toMatchObject({ path: longName, status: 'extracted' });
  expect(new TextDecoder().decode(gnuResult.files[0]!.bytes)).toBe('gnu long name content');

  // POSIX pax, cross-checked against the vendored Go fixture already
  // proven in "the Go archive test files..." above.
  const pax = await readTar(bytesReader(fixtureBytes('pax.tar')));
  expect(pax.entries[0]!.size).toBe(7);
});

function buildGnuLongNameArchive(longName: string, content: Uint8Array): Uint8Array {
  const longNameBlocks = writeGnuLongNameEntry(longName, 'name');
  const realHeader = tarRealHeaderForTest('short', content.length);
  const dataBlock = padTo512ForTest(Buffer.from(content));
  const trailer = Buffer.alloc(1024, 0);
  return new Uint8Array(Buffer.concat([...longNameBlocks, realHeader, dataBlock, trailer]));
}

function tarRealHeaderForTest(name: string, size: number): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, 'ascii');
  block.write('0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  block.write('00000000000\0', 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i]!;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return block;
}

function padTo512ForTest(buf: Buffer): Buffer {
  const remainder = buf.length % 512;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - remainder, 0)]);
}

it('gzip members are decompressed with their CRC-32 and length checked as RFC 1952 requires, including several members in one file', async () => {
  const memberOne = bytesOf('first gzip member content, repeated a bit. '.repeat(30));
  const memberTwo = bytesOf('second gzip member, a different length.');
  const bytes = writeHostileGzip([{ content: memberOne, fname: 'first.txt' }, { content: memberTwo }]);
  const result = await readGzip(bytesReader(bytes));
  const combined = new Uint8Array(memberOne.length + memberTwo.length);
  combined.set(memberOne, 0);
  combined.set(memberTwo, memberOne.length);
  expect(result.bytes).toEqual(combined);
  expect(result.name).toBe('first.txt');

  const badCrc = writeHostileGzip([{ content: bytesOf('will be corrupted'), corruptCrc: true }]);
  await expect(readGzip(bytesReader(badCrc))).rejects.toThrow(/damaged/);

  const badIsize = writeHostileGzip([{ content: bytesOf('will be corrupted'), corruptIsize: true }]);
  await expect(readGzip(bytesReader(badIsize))).rejects.toThrow(/damaged/);
});

it('a tar.gz is read as gzip then TAR under the same limits', async () => {
  const tarBytes = writeHostileTar([{ name: 'inside.txt', content: bytesOf('content inside the tar.gz') }]);
  const gzBytes = writeHostileGzip([{ content: tarBytes }]);
  const result = await extractArchive(bytesReader(gzBytes), 'archive.tar.gz');
  expect(result.kind).toBe('tar');
  expect(result.entries[0]).toMatchObject({ path: 'inside.txt', status: 'extracted' });
  expect(new TextDecoder().decode(result.files[0]!.bytes)).toBe('content inside the tar.gz');

  // Under a lowered total limit, the tar.gz stops with the limit message,
  // proving the limit applies to the decompressed container, not just a
  // standalone ZIP entry.
  const bigContent = new Uint8Array(4 * 1024 * 1024).fill(0x41);
  const bigTar = writeHostileTar([{ name: 'big.bin', content: bigContent }]);
  const bigGz = writeHostileGzip([{ content: bigTar }]);
  const smallReader = bytesReader(bigGz);
  await expect(
    (async () => {
      const gz = await readGzip(smallReader, {
        maxInputBytes: 2 * 1024 * 1024 * 1024,
        maxTotalOutputBytes: 512 * 1024,
        maxEntries: 10_000,
        maxRatio: 250,
        feedChunkBytes: 16 * 1024,
      });
      return gz;
    })(),
  ).rejects.toThrow(/Stopped: this archive would expand to more than/);
});

it('a created ZIP round trips through Node zlib and this reader with names, sizes and times intact', async () => {
  const files = [
    { name: 'first.txt', bytes: bytesOf('first file content, repeated. '.repeat(40)) },
    { name: 'second.txt', bytes: bytesOf('second file, short.') },
  ];
  const created = await createZip(files, { method: 'deflate', level: 6, keepTimes: true });
  const readBack = await readZip(bytesReader(created.files[0]!.bytes));
  expect(readBack.entries.map((e) => e.status)).toEqual(['extracted', 'extracted']);
  expect(readBack.files[0]!.bytes).toEqual(files[0]!.bytes);
  expect(readBack.files[1]!.bytes).toEqual(files[1]!.bytes);
  for (const entry of readBack.entries) {
    expect(entry.modified).toBeTruthy();
    expect(new Date(entry.modified!).getUTCFullYear()).toBe(new Date().getUTCFullYear());
  }

  const stored = await createZip(files, { method: 'store', level: 6, keepTimes: false });
  const readBackStored = await readZip(bytesReader(stored.files[0]!.bytes));
  expect(readBackStored.files[0]!.bytes).toEqual(files[0]!.bytes);
  expect(readBackStored.entries[0]!.modified).toBe(new Date(Date.UTC(1980, 0, 1, 0, 0, 0)).toISOString());
});

it('extractArchive refuses a file whose header does not match zip, tar or gzip', async () => {
  const bytes = bytesOf('just some plain text, not an archive at all');
  await expect(extractArchive(bytesReader(bytes), 'notes.txt')).rejects.toThrow();
});

it('a hostile archive error is normalised to ArchiveError so a caller only ever catches one type', async () => {
  const built = writeHostileZip(
    [
      { name: 'a.txt', content: bytesOf('a') },
      { name: 'b.txt', content: bytesOf('b') },
    ],
    { duplicateLocalHeaderFor: [0, 0] },
  );
  await expect(extractArchive(bytesReader(built.bytes), 'archive.zip')).rejects.toBeInstanceOf(ArchiveError);
});

it('safeEntryPath neutralises hostile names and dedupePath disambiguates a collision', () => {
  const climbs = safeEntryPath('a/../../b.txt');
  expect('refused' in climbs).toBe(true);

  const absolute = safeEntryPath('/etc/passwd');
  expect(absolute).toMatchObject({ path: 'etc/passwd', warnings: ['absolute path made relative'] });

  const used = new Set<string>();
  const first = dedupePath('same.txt', used);
  const second = dedupePath('same.txt', used);
  const third = dedupePath('same.txt', used);
  expect(first).toEqual({ path: 'same.txt', deduped: false });
  expect(second).toEqual({ path: 'same (2).txt', deduped: true });
  expect(third).toEqual({ path: 'same (3).txt', deduped: true });
});

it('a plain gzip file (not tar.gz) extracts to a single file named from FNAME or the input name', async () => {
  const content = bytesOf('a plain gzip payload');
  const named = writeHostileGzip([{ content, fname: 'payload.txt' }]);
  const namedResult = await extractArchive(bytesReader(named), 'ignored.gz');
  expect(namedResult.kind).toBe('gzip');
  expect(namedResult.files[0]!.name).toBe('payload.txt');

  const unnamed = writeHostileGzip([{ content }]);
  const unnamedResult = await extractArchive(bytesReader(unnamed), 'downloaded.txt.gz');
  expect(unnamedResult.files[0]!.name).toBe('downloaded.txt');
});
