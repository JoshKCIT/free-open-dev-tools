import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { crc32, CRC_CATALOGUE, crcValue, makeCrc, checksumRows } from '../src/index';

/**
 * The CRC catalogue (https://reveng.sourceforge.io/crc-catalogue/, the 16 bit and 17 to 64 bit pages, "Last updated
 * 11 December 2024" for the 16 bit page, read 2026-10-03) lists, for every algorithm, its parameters, its other names
 * and its check value: the CRC of the nine ASCII bytes 123456789. The table below holds only the names, the check values
 * and the other names, typed from those pages. The parameters are in the source file, so a wrong polynomial, initial
 * value or reflection flag shows up here as a wrong check value.
 */
const CATALOGUE: [name: string, check: number, aliases: string[]][] = [
  ['CRC-16/ARC', 0xbb3d, ['ARC', 'CRC-16', 'CRC-16/LHA', 'CRC-IBM']],
  ['CRC-16/CDMA2000', 0x4c06, []],
  ['CRC-16/CMS', 0xaee7, []],
  ['CRC-16/DDS-110', 0x9ecf, []],
  ['CRC-16/DECT-R', 0x007e, ['R-CRC-16']],
  ['CRC-16/DECT-X', 0x007f, ['X-CRC-16']],
  ['CRC-16/DNP', 0xea82, []],
  ['CRC-16/EN-13757', 0xc2b7, []],
  ['CRC-16/GENIBUS', 0xd64e, ['CRC-16/DARC', 'CRC-16/EPC', 'CRC-16/EPC-C1G2', 'CRC-16/I-CODE']],
  ['CRC-16/GSM', 0xce3c, []],
  ['CRC-16/IBM-3740', 0x29b1, ['CRC-16/AUTOSAR', 'CRC-16/CCITT-FALSE']],
  ['CRC-16/IBM-SDLC', 0x906e, ['CRC-16/ISO-HDLC', 'CRC-16/ISO-IEC-14443-3-B', 'CRC-16/X-25', 'CRC-B', 'X-25']],
  ['CRC-16/ISO-IEC-14443-3-A', 0xbf05, ['CRC-A']],
  [
    'CRC-16/KERMIT',
    0x2189,
    ['CRC-16/BLUETOOTH', 'CRC-16/CCITT', 'CRC-16/CCITT-TRUE', 'CRC-16/V-41-LSB', 'CRC-CCITT', 'KERMIT'],
  ],
  ['CRC-16/LJ1200', 0xbdf4, []],
  ['CRC-16/M17', 0x772b, []],
  ['CRC-16/MAXIM-DOW', 0x44c2, ['CRC-16/MAXIM']],
  ['CRC-16/MCRF4XX', 0x6f91, []],
  ['CRC-16/MODBUS', 0x4b37, ['MODBUS']],
  ['CRC-16/NRSC-5', 0xa066, []],
  ['CRC-16/OPENSAFETY-A', 0x5d38, []],
  ['CRC-16/OPENSAFETY-B', 0x20fe, []],
  ['CRC-16/PROFIBUS', 0xa819, ['CRC-16/IEC-61158-2']],
  ['CRC-16/RIELLO', 0x63d0, []],
  ['CRC-16/SPI-FUJITSU', 0xe5cc, ['CRC-16/AUG-CCITT']],
  ['CRC-16/T10-DIF', 0xd0db, []],
  ['CRC-16/TELEDISK', 0x0fb3, []],
  ['CRC-16/TMS37157', 0x26b1, []],
  ['CRC-16/UMTS', 0xfee8, ['CRC-16/BUYPASS', 'CRC-16/VERIFONE']],
  ['CRC-16/USB', 0xb4c8, []],
  ['CRC-16/XMODEM', 0x31c3, ['CRC-16/ACORN', 'CRC-16/LTE', 'CRC-16/V-41-MSB', 'XMODEM', 'ZMODEM']],
  ['CRC-32/AIXM', 0x3010bf7f, ['CRC-32Q']],
  ['CRC-32/AUTOSAR', 0x1697d06a, []],
  ['CRC-32/BASE91-D', 0x87315576, ['CRC-32D']],
  ['CRC-32/BZIP2', 0xfc891918, ['CRC-32/AAL5', 'CRC-32/DECT-B', 'B-CRC-32']],
  ['CRC-32/CD-ROM-EDC', 0x6ec2edc4, []],
  ['CRC-32/CKSUM', 0x765e7680, ['CKSUM', 'CRC-32/POSIX']],
  ['CRC-32/ISCSI', 0xe3069283, ['CRC-32/BASE91-C', 'CRC-32/CASTAGNOLI', 'CRC-32/INTERLAKEN', 'CRC-32C', 'CRC-32/NVME']],
  ['CRC-32/ISO-HDLC', 0xcbf43926, ['CRC-32', 'CRC-32/ADCCP', 'CRC-32/V-42', 'CRC-32/XZ', 'PKZIP']],
  ['CRC-32/JAMCRC', 0x340bc6d9, ['JAMCRC']],
  ['CRC-32/MEF', 0xd2c22f51, []],
  ['CRC-32/MPEG-2', 0x0376e6e7, []],
  ['CRC-32/XFER', 0xbd0be338, ['XFER']],
];

const NINE = new TextEncoder().encode('123456789');

/** A small seeded generator, so the random inputs are the same on every run (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
});
afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('all 43 CRC catalogue entries give their check value over 123456789', () => {
  expect(CATALOGUE).toHaveLength(43);
  expect(CATALOGUE.filter(([name]) => name.startsWith('CRC-16/'))).toHaveLength(31);
  expect(CATALOGUE.filter(([name]) => name.startsWith('CRC-32/'))).toHaveLength(12);
  // The source file holds exactly these names, in this order.
  expect(CRC_CATALOGUE.map((entry) => entry.name)).toEqual(CATALOGUE.map(([name]) => name));
  for (const [name, check] of CATALOGUE) {
    const entry = CRC_CATALOGUE.find((e) => e.name === name);
    expect(entry, name).toBeDefined();
    expect(entry!.check, `${name} check value in the source file`).toBe(check);
    expect(crcValue(NINE, entry!), name).toBe(check);
    expect(makeCrc(entry!)(NINE), `${name} through makeCrc`).toBe(check);
  }
  // Three of the best known, written out by hand.
  expect(
    crcValue(
      NINE,
      CRC_CATALOGUE.find((e) => e.name === 'CRC-32/ISCSI')!,
    ),
  ).toBe(0xe3069283);
  expect(
    crcValue(
      NINE,
      CRC_CATALOGUE.find((e) => e.name === 'CRC-16/ARC')!,
    ),
  ).toBe(0xbb3d);
  expect(
    crcValue(
      NINE,
      CRC_CATALOGUE.find((e) => e.name === 'CRC-16/IBM-3740')!,
    ),
  ).toBe(0x29b1);
});

it('CRC-32 ISO-HDLC equals the existing crc32 export and empty input gives each initial value', () => {
  const iso = CRC_CATALOGUE.find((e) => e.name === 'CRC-32/ISO-HDLC')!;
  const next = seeded(20261003);
  for (let n = 0; n < 500; n++) {
    const bytes = new Uint8Array(Math.floor(next() * 300));
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
    expect(crcValue(bytes, iso)).toBe(crc32(bytes));
  }
  // With nothing to read, the register still holds its initial value, so the result is that value (reversed when the
  // output is reflected) with the final exclusive-or applied. The catalogue gives the initial value in the order the
  // algorithm is written, so an entry that reflects its output starts from the bit-reversed value.
  const reverse = (v: number, width: number) => {
    let r = 0;
    for (let i = 0; i < width; i++) if ((v >>> i) & 1) r |= 1 << (width - 1 - i);
    return r >>> 0;
  };
  const empty = new Uint8Array(0);
  for (const entry of CRC_CATALOGUE) {
    const mask = entry.width === 32 ? 0xffffffff : 0xffff;
    const start = entry.refout ? reverse(entry.init, entry.width) : entry.init;
    expect(crcValue(empty, entry), entry.name).toBe(((start ^ entry.xorout) & mask) >>> 0);
  }
  expect(crcValue(empty, iso)).toBe(0);
  expect(
    crcValue(
      empty,
      CRC_CATALOGUE.find((e) => e.name === 'CRC-16/ARC')!,
    ),
  ).toBe(0);
  // CRC-A starts from 0xc6c6 as written, which is 0x6363 reversed.
  expect(
    crcValue(
      empty,
      CRC_CATALOGUE.find((e) => e.name === 'CRC-16/ISO-IEC-14443-3-A')!,
    ),
  ).toBe(0x6363);
});

it('RFC 3720 Appendix B.4 CRC-32C examples reproduce', () => {
  const castagnoli = CRC_CATALOGUE.find((e) => e.name === 'CRC-32/ISCSI')!;
  const hexBytes = (text: string) => Uint8Array.from(text.replace(/ /g, '').match(/../g)!, (h) => parseInt(h, 16));
  // The RFC prints each CRC as four bytes in transmission order, lowest byte first.
  const examples: [bytes: Uint8Array, value: number, printed: string][] = [
    [new Uint8Array(32), 0x8a9136aa, 'aa 36 91 8a'],
    [new Uint8Array(32).fill(0xff), 0x62a8ab43, '43 ab a8 62'],
    [Uint8Array.from({ length: 32 }, (_, i) => i), 0x46dd794e, '4e 79 dd 46'],
    [Uint8Array.from({ length: 32 }, (_, i) => 31 - i), 0x113fdb5c, '5c db 3f 11'],
    [
      hexBytes(
        '01c00000 00000000 00000000 00000000 14000000 00000400 00000014 00000018 28000000 00000000 02000000 00000000',
      ),
      0xd9963a56,
      '56 3a 96 d9',
    ],
  ];
  for (const [bytes, value, printed] of examples) {
    const got = crcValue(bytes, castagnoli);
    expect(got).toBe(value);
    const transmitted = [got & 255, (got >>> 8) & 255, (got >>> 16) & 255, (got >>> 24) & 255]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    expect(transmitted).toBe(printed);
  }
  expect(examples[4]![0]).toHaveLength(48);
});

it('each checksum row carries its catalogue name and aliases', () => {
  const rows = checksumRows(NINE);
  // The catalogue rows come first, in catalogue order; a later row may follow them.
  expect(rows.length).toBeGreaterThanOrEqual(43);
  CATALOGUE.forEach(([name, check, aliases], i) => {
    const row = rows[i]!;
    expect(row.name).toBe(name);
    expect(row.aliases).toEqual(aliases);
    expect(row.value).toBe(check);
    expect(row.width).toBe(name.startsWith('CRC-16/') ? 16 : 32);
  });
  const ibm3740 = rows.find((r) => r.name === 'CRC-16/IBM-3740')!;
  expect(ibm3740.aliases).toContain('CRC-16/CCITT-FALSE');
  const castagnoli = rows.find((r) => r.name === 'CRC-32/ISCSI')!;
  expect(castagnoli.aliases).toContain('CRC-32C');
  // An alias is never a row of its own.
  const names = new Set(rows.map((r) => r.name));
  expect(names.has('CRC-32C')).toBe(false);
});
