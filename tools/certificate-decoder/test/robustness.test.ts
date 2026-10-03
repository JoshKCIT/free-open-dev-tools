import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DerError } from '../src/der';
import {
  CertificateError,
  MAX_ITEMS,
  MAX_PASTE_CHARS,
  MAX_TABLE_ROWS,
  UNREADABLE_MESSAGE,
  decodeInput,
} from '../src/index';
import { readCsr } from '../src/csr';
import { PemError } from '../src/pem';
import { readCertificate } from '../src/x509';
import {
  base64,
  buildCertificate,
  concat,
  context,
  extension,
  nul,
  oid,
  seq,
  seqOf,
  tlv,
  type Bytes,
} from './fixtures/der-build';
import { NOW_MS, certificateDer, certificatePem, pemText, requestDer } from './fixtures/helpers';

/**
 * Hostile input: a certificate is untrusted bytes. Whatever the paste holds, the answer is a result or one plain sentence,
 * never an unexpected exception, and the time and the output are bounded.
 */

// The package prints nothing, whatever it is given.
const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

/** A small seeded generator (mulberry32), so every run of the fuzz test makes the same mutations. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 14003;
const MUTATIONS = 20000;

function mutate(source: Bytes, random: () => number): Bytes {
  let bytes: Bytes = Uint8Array.from(source);
  const pick = (limit: number): number => Math.floor(random() * limit);
  const rounds = random() < 0.7 ? 1 : 2 + pick(4);
  for (let round = 0; round < rounds; round++) {
    const at = pick(bytes.length);
    switch (pick(10)) {
      case 0:
        bytes[at] = bytes[at]! ^ (1 << pick(8));
        break;
      case 1:
        bytes[at] = pick(256);
        break;
      case 2:
        bytes[at] = 0xff;
        break;
      case 3:
        bytes[at] = 0x00;
        break;
      case 4:
        bytes = bytes.subarray(0, Math.max(1, at));
        break;
      case 5:
        bytes = concat(bytes.subarray(0, at), bytes.subarray(Math.min(bytes.length, at + 1 + pick(20))));
        break;
      case 6: {
        const extra = Uint8Array.from({ length: 1 + pick(20) }, () => pick(256));
        bytes = concat(bytes.subarray(0, at), extra, bytes.subarray(at));
        break;
      }
      case 7: {
        const length = 1 + pick(40);
        bytes = concat(bytes.subarray(0, at + length), bytes.subarray(at, at + length), bytes.subarray(at + length));
        break;
      }
      case 8: {
        // A length octet made huge or short: the byte after a tag byte.
        bytes[at] = [0x80, 0x81, 0x82, 0x84, 0x85, 0xff, 0x7f][pick(7)]!;
        break;
      }
      default: {
        const other = pick(bytes.length);
        const keep = bytes[at]!;
        bytes[at] = bytes[other]!;
        bytes[other] = keep;
      }
    }
  }
  return bytes;
}

/** A DER element read into a tree, so a mutation can change its shape and still write correct lengths. */
interface Tree {
  tag: number;
  children?: Tree[];
  content?: Bytes;
}

/** Reads the elements of `bytes` with one-byte tags, down to a few levels. Returns undefined for anything it cannot read. */
function readTree(bytes: Bytes, depth = 0): Tree[] | undefined {
  const out: Tree[] = [];
  let at = 0;
  while (at < bytes.length) {
    const tag = bytes[at++]!;
    let length = bytes[at++];
    if (length === undefined) return undefined;
    if (length >= 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + (bytes[at++] ?? 0);
    }
    if (at + length > bytes.length) return undefined;
    const content = bytes.subarray(at, at + length);
    at += length;
    if ((tag & 0x20) !== 0 && depth < 8) {
      const children = readTree(content, depth + 1);
      out.push(children === undefined ? { tag, content } : { tag, children });
    } else {
      out.push({ tag, content });
    }
  }
  return out;
}

function writeTree(nodes: Tree[]): Bytes {
  return concat(
    ...nodes.map((node) => tlv(node.tag, node.children === undefined ? node.content! : writeTree(node.children))),
  );
}

function allNodes(nodes: Tree[], into: Tree[] = []): Tree[] {
  for (const node of nodes) {
    into.push(node);
    if (node.children !== undefined) allNodes(node.children, into);
  }
  return into;
}

const TAGS = [0x02, 0x04, 0x05, 0x06, 0x0c, 0x13, 0x17, 0x30, 0x31, 0xa0, 0xa3, 0x80, 0x82, 0x86, 0x87];

/** Changes the shape of a certificate and writes it again with correct lengths: the input is valid DER with a wrong shape. */
function mutateTree(source: Bytes, random: () => number): Bytes {
  const roots = readTree(source)!;
  const pick = (limit: number): number => Math.floor(random() * limit);
  const rounds = random() < 0.7 ? 1 : 2 + pick(3);
  for (let round = 0; round < rounds; round++) {
    const nodes = allNodes(roots);
    const node = nodes[pick(nodes.length)]!;
    const kids = node.children;
    switch (pick(8)) {
      case 0:
        if (kids !== undefined && kids.length > 0) kids.splice(pick(kids.length), 1);
        break;
      case 1:
        if (kids !== undefined && kids.length > 0) {
          const at = pick(kids.length);
          kids.splice(at, 0, structuredClone(kids[at]!));
        }
        break;
      case 2:
        if (kids !== undefined && kids.length > 1) {
          const a = pick(kids.length);
          const b = pick(kids.length);
          const keep = kids[a]!;
          kids[a] = kids[b]!;
          kids[b] = keep;
        }
        break;
      case 3:
        node.tag = TAGS[pick(TAGS.length)]!;
        break;
      case 4:
        if (kids === undefined) node.content = Uint8Array.from({ length: pick(20) }, () => pick(256));
        break;
      case 5: {
        const copy: Tree = { ...node };
        for (const key of Object.keys(node)) delete (node as unknown as Record<string, unknown>)[key];
        node.tag = 0x30;
        node.children = [copy];
        break;
      }
      case 6: {
        const donor = nodes[pick(nodes.length)]!;
        if (donor !== node && !allNodes([donor]).includes(node)) {
          const copy = structuredClone(donor);
          node.tag = copy.tag;
          delete node.children;
          delete node.content;
          if (copy.children !== undefined) node.children = copy.children;
          else node.content = copy.content!;
        }
        break;
      }
      default:
        if (kids !== undefined)
          kids.splice(pick(kids.length + 1), 0, { tag: TAGS[pick(TAGS.length)]!, content: new Uint8Array(pick(4)) });
    }
  }
  return writeTree(roots);
}

it('20000 fixed-seed mutations of real certificates give only plain messages', () => {
  const bases = ['leaf', 'int', 'root', 'ec256', 'ed25519', 'pss', 'canary', 'weak'].map(certificateDer);
  const random = mulberry32(SEED);
  let read = 0;
  let refused = 0;
  const messages = new Set<string>();
  for (let index = 0; index < MUTATIONS; index++) {
    // Half of the mutations change bytes (so lengths go wrong), half change the shape and keep every length right.
    const base = bases[index % bases.length]!;
    const bytes = index % 2 === 0 ? mutate(base, random) : mutateTree(base, random);
    // The reader itself may only throw its own DerError: anything else is a defect, and the net below must never catch it.
    try {
      readCertificate(bytes, NOW_MS);
      read++;
    } catch (err) {
      if (!(err instanceof DerError)) {
        throw new Error(`mutation ${index} (seed ${SEED}) threw ${(err as Error).name}: ${(err as Error).message}`);
      }
      refused++;
    }
    // Through the entry point as PEM, the answer is a result or a sentence, and never the net's sentence.
    try {
      decodeInput(pemText('CERTIFICATE', base64(bytes)), { nowMs: NOW_MS });
    } catch (err) {
      const message = (err as Error).message;
      const plain = err instanceof CertificateError || err instanceof DerError || err instanceof PemError;
      if (!plain || message === UNREADABLE_MESSAGE || message.includes('\n') || message.length > 300) {
        throw new Error(`mutation ${index} (seed ${SEED}) gave ${(err as Error).name}: ${message}`);
      }
      messages.add(message.replace(/\d+/g, 'N'));
    }
  }
  // Some mutations leave a certificate that still reads (a changed digit in a name) and most do not.
  expect(read).toBeGreaterThan(100);
  expect(refused).toBeGreaterThan(1000);
  expect(messages.size).toBeGreaterThan(5);
}, 60_000);

it('pastes over 1048576 characters and more than 100 certificates are refused before parsing', () => {
  expect(MAX_PASTE_CHARS).toBe(1048576);
  expect(MAX_ITEMS).toBe(100);
  const refusal = (text: string): CertificateError => {
    try {
      decodeInput(text, { nowMs: NOW_MS });
    } catch (err) {
      expect(err).toBeInstanceOf(CertificateError);
      return err as CertificateError;
    }
    throw new Error('expected a refusal');
  };

  // Exactly the limit is read; one more is refused, and the refusal comes before the BEGIN scan would have complained.
  const padded = certificatePem('ec256') + '\n'.repeat(MAX_PASTE_CHARS - certificatePem('ec256').length);
  expect(padded).toHaveLength(MAX_PASTE_CHARS);
  expect(decodeInput(padded, { nowMs: NOW_MS }).items).toHaveLength(1);
  const bare = '-----' + 'BEGIN ' + 'CERTIFICATE-----\n';
  const tooLong = bare + ' '.repeat(MAX_PASTE_CHARS + 1 - bare.length);
  expect(tooLong).toHaveLength(MAX_PASTE_CHARS + 1);
  expect(refusal(tooLong).message).toBe(
    'This paste is 1,048,577 characters. The limit is 1,048,576 because larger pastes are not certificates.',
  );
  expect(refusal(' '.repeat(MAX_PASTE_CHARS + 1)).message).toMatch(/^This paste is 1,048,577 characters\./);

  // One hundred certificates are read, a hundred and one are refused before any is parsed: the last block of the second
  // paste is not a certificate, and the count sentence comes first.
  const one = certificatePem('leaf');
  expect(decodeInput(one.repeat(100), { nowMs: NOW_MS }).items).toHaveLength(100);
  const notDer = pemText('CERTIFICATE', 'AAAA');
  expect(refusal(one.repeat(100) + notDer).message).toBe(
    'This paste holds 101 certificates or requests. The limit is 100.',
  );
  expect(refusal(one.repeat(99) + notDer).message).toMatch(/^Certificate 100 of 100 could not be read: /);
  expect(refusal(one.repeat(500)).message).toBe('This paste holds 500 certificates or requests. The limit is 100.');
});

it('500 certificates decode within the time limit', () => {
  const names = ['leaf', 'int', 'root', 'ec256', 'ed25519', 'ec521', 'pss', 'canary', 'weak'];
  // The limit is 100 certificates in one paste, so 500 certificates are five pastes; only the decoding is timed.
  const pastes = [0, 1, 2, 3, 4].map((offset) =>
    Array.from({ length: 100 }, (_unused, i) => certificatePem(names[(i + offset) % names.length]!)).join('\n'),
  );
  const started = performance.now();
  const results = pastes.map((paste) => decodeInput(paste, { nowMs: NOW_MS }));
  const elapsed = performance.now() - started;
  expect(results.reduce((total, result) => total + result.items.length, 0)).toBe(500);
  expect(elapsed).toBeLessThan(5000);
}, 60_000);

it('500 KiB of BEGIN lines without an END is refused in linear time', () => {
  const line = '-----' + 'BEGIN ' + 'CERTIFICATE-----\n';
  const text = line.repeat(Math.ceil((500 * 1024) / line.length));
  expect(text.length).toBeGreaterThan(500 * 1024);
  let error: unknown;
  const started = performance.now();
  try {
    decodeInput(text, { nowMs: NOW_MS });
  } catch (err) {
    error = err;
  }
  const elapsed = performance.now() - started;
  expect(error).toBeInstanceOf(CertificateError);
  expect((error as CertificateError).line).toBe(1);
  expect((error as Error).message).toBe('The BEGIN line has no END line after it.');
  expect(elapsed).toBeLessThan(500);

  // Other shapes of the same size: no armour at all, a run of one Base64 or hex character, a run of dashes.
  for (const hostile of ['A'.repeat(1_000_000), '0'.repeat(1_000_000), '-'.repeat(1_000_000), '= '.repeat(400_000)]) {
    const begun = performance.now();
    expect(() => decodeInput(hostile, { nowMs: NOW_MS })).toThrow(CertificateError);
    expect(performance.now() - begun).toBeLessThan(1000);
  }
}, 60_000);

it('hostile DER shapes are refused with plain sentences and bounded work', () => {
  const asPaste = (bytes: Bytes): string => base64(bytes);
  const refusal = (bytes: Bytes): string => {
    try {
      decodeInput(pemText('CERTIFICATE', asPaste(bytes)), { nowMs: NOW_MS });
    } catch (err) {
      expect(err).toBeInstanceOf(CertificateError);
      return (err as Error).message;
    }
    throw new Error('expected a refusal');
  };
  // A hundred thousand bytes that all look like the start of a sequence.
  expect(refusal(new Uint8Array(100_000).fill(0x30))).toMatch(/could not be read/);
  // Thirty levels of nesting: refused at 24.
  let nested: Bytes = nul();
  for (let level = 0; level < 30; level++) nested = seq(nested);
  expect(refusal(nested)).toMatch(/nested too deeply/);
  // A length that claims four gigabytes of data that are not there, and one written in the indefinite form.
  expect(refusal(Uint8Array.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff, 0x00]))).toMatch(/runs past the end|too large/);
  expect(refusal(Uint8Array.from([0x30, 0x80, 0x00, 0x00]))).toMatch(/indefinite/);
  // More elements than the reader will count.
  const flat = seqOf(Array.from({ length: 200_001 }, () => nul()));
  expect(flat.length).toBeLessThan(MAX_PASTE_CHARS * 0.75);
  const started = performance.now();
  expect(refusal(flat)).toMatch(/Too many elements/);
  expect(performance.now() - started).toBeLessThan(5000);
  // A name, a time and a key that are the wrong kind of element.
  expect(refusal(seq(seq(), seq(), seq()))).toMatch(/could not be read/);
  expect(refusal(seq(nul(), nul(), nul()))).toMatch(/could not be read/);
});

it('long extensions and many alternative names are capped with a note of what was left out', () => {
  const dns = (i: number): Bytes => context(2, Uint8Array.from(Buffer.from(`host${i}.example.test`)), false);
  const names = (count: number): Bytes => seqOf(Array.from({ length: count }, (_unused, i) => dns(i)));
  const withNames = (count: number): Bytes =>
    buildCertificate({ extensions: [extension('2.5.29.17', false, names(count))] });
  const pem = (der: Bytes): string => pemText('CERTIFICATE', base64(der));

  // Exactly the cap is shown whole; beyond it the rows stop and the note says how many were left out.
  const exact = decodeInput(pem(withNames(MAX_TABLE_ROWS)), { nowMs: NOW_MS }).items[0]!;
  expect(MAX_TABLE_ROWS).toBe(5000);
  expect(exact.sans).toHaveLength(5000);
  expect(exact.warnings.filter((warning) => warning.includes('not shown'))).toEqual([]);
  const over = decodeInput(pem(withNames(6000)), { nowMs: NOW_MS }).items[0]!;
  expect(over.sans).toHaveLength(5000);
  expect(over.sans[4999]!.value).toBe('host4999.example.test');
  expect(over.warnings).toContain(
    '1,000 of 6,000 subject alternative names are not shown, because a table shows at most 5,000 rows across the page.',
  );
  // The rows are counted across the whole paste: two certificates of 3,000 names each share the 5,000.
  const two = decodeInput(pem(withNames(3000)) + pem(withNames(3000)), { nowMs: NOW_MS });
  expect(two.items.map((item) => item.sans.length)).toEqual([3000, 2000]);
  expect(two.items[0]!.warnings.filter((warning) => warning.includes('not shown'))).toEqual([]);
  expect(two.items[1]!.warnings).toContain(
    '1,000 of 3,000 subject alternative names are not shown, because a table shows at most 5,000 rows across the page.',
  );

  // Extensions are rows too.
  const many = buildCertificate({
    extensions: Array.from({ length: 5200 }, (_unused, i) => extension(`1.3.6.1.4.1.99999.${i}`, false, [1])),
  });
  const rows = decodeInput(pem(many), { nowMs: NOW_MS }).items[0]!;
  expect(rows.extensions).toHaveLength(5000);
  expect(rows.warnings).toContain(
    '200 of 5,200 extensions are not shown, because a table shows at most 5,000 rows across the page.',
  );

  // One extension whose bytes are long shows 256 bytes of hex and says how many it left out.
  const long = buildCertificate({
    extensions: [extension('1.3.6.1.4.1.99999.1', false, new Uint8Array(1000).fill(0xab))],
  });
  const longRow = decodeInput(pem(long), { nowMs: NOW_MS }).items[0]!.extensions[0]!;
  expect(longRow.value).toEqual([`${'ab'.repeat(256)} and 744 more bytes`]);
  // One extension that decodes into very many lines is cut at 200 lines, with a last line that says so.
  const policies = seq(...Array.from({ length: 1000 }, (_unused, i) => seq(oid(`1.3.6.1.4.1.99999.${i}`))));
  const policyRow = decodeInput(pem(buildCertificate({ extensions: [extension('2.5.29.32', false, policies)] })), {
    nowMs: NOW_MS,
  }).items[0]!.extensions[0]!;
  expect(policyRow.value).toHaveLength(201);
  expect(policyRow.value[0]).toBe('Policy: 1.3.6.1.4.1.99999.0');
  expect(policyRow.value[200]).toBe('and 800 more lines are not shown.');
});

it('8000 fixed-seed mutations of real requests give only plain messages', () => {
  const bases = ['rsa', 'ec', 'ed', 'pw'].map(requestDer);
  const random = mulberry32(SEED + 1);
  let read = 0;
  let refused = 0;
  for (let index = 0; index < 8000; index++) {
    const base = bases[index % bases.length]!;
    const bytes = index % 2 === 0 ? mutate(base, random) : mutateTree(base, random);
    try {
      readCsr(bytes);
      read++;
    } catch (err) {
      if (!(err instanceof DerError)) {
        throw new Error(
          `request mutation ${index} (seed ${SEED + 1}) threw ${(err as Error).name}: ${(err as Error).message}`,
        );
      }
      refused++;
    }
    // Through the entry point, as PEM and as the bytes of a file: a result or a plain sentence, never the net's sentence.
    for (const input of [pemText('CERTIFICATE REQUEST', base64(bytes)), bytes]) {
      try {
        decodeInput(input, { nowMs: NOW_MS });
      } catch (err) {
        const message = (err as Error).message;
        const plain = err instanceof CertificateError || err instanceof DerError || err instanceof PemError;
        if (!plain || message === UNREADABLE_MESSAGE || message.includes('\n') || message.length > 300) {
          throw new Error(`request mutation ${index} (seed ${SEED + 1}) gave ${(err as Error).name}: ${message}`);
        }
      }
    }
  }
  expect(read).toBeGreaterThan(50);
  expect(refused).toBeGreaterThan(500);
}, 60_000);
