import { expect, it } from 'vitest';
import {
  Asn1Error,
  INSIDE_BUDGET_BYTES,
  INSIDE_LABEL,
  MAX_FILE_BYTES,
  MAX_PASTE_CHARS,
  describeStructure,
  readInput,
  tryInside,
} from '../src/index';
import { PERSONNEL_HEX, PERSONNEL_STRINGS } from './fixtures/x690';
import { der, fromHex, problemsOf, readHex, toHex } from './helpers';

/*
 * The tracer: the personnel record of ITU-T X.690 (02/2021) annex A.3, pasted as hex and read as a tree. The expected
 * numbers are the ones the standard's figure gives (a header of 60 81 85, 133 content octets, 136 bytes in all) and the
 * strings it spells out, never the reader's own output. The second test puts a unique marker inside malformed input and
 * asserts that no message, finding or label repeats it.
 */

it('the X.690 annex A.3 personnel record reads as 133 content octets under 60 81 85', () => {
  expect(PERSONNEL_HEX.startsWith('608185')).toBe(true);
  const result = describeStructure({ data: PERSONNEL_HEX, format: 'hex' });
  expect(result.bytes).toBe(136);
  expect(result.form).toBe('hex');

  // 0x60 is class 01 (application), primitive/constructed bit set, tag number 0; 81 85 is the long form of 133.
  const root = result.nodes[0]!;
  expect(root).toMatchObject({
    offset: 0,
    depth: 0,
    cls: 'application',
    tag: 0,
    constructed: true,
    indefinite: false,
    headerLength: 3,
    length: 133,
    end: 136,
  });
  expect(result.nodes.filter((node) => node.depth === 0)).toHaveLength(1);

  // The strings the figure spells out, in document order. The dates are [APPLICATION 3] values and appear as their text.
  const strings = result.nodes.map((node) => node.value?.string).filter((text): text is string => text !== undefined);
  expect(strings).toEqual(PERSONNEL_STRINGS);

  // A well-formed record: nothing to report, and the tree holds one root with the same number of elements.
  expect(result.findings).toEqual([]);
  expect(result.tree).toHaveLength(1);
  expect(result.elements).toBe(result.nodes.length);
  expect(result.copyText.split('\n')).toHaveLength(result.nodes.length);
});

it('refusals and notes name offsets and never repeat input beyond the 64 byte preview', () => {
  const marker = 'ZQ-7c1d9e{MK}';
  const copies = [marker, marker.slice(0, 12), marker.slice(2, 9)];
  const texts: string[] = [];
  const keep = (what: string, ...messages: string[]): void => {
    for (const message of messages) {
      texts.push(message);
      // Every message is short: it names a place and a rule and never carries bytes of the input.
      expect(message.length, `${what}: ${message}`).toBeLessThan(400);
    }
  };

  // Text that is not the format it was read as: the sentence names a character position.
  const refusals: [string, string, 'hex' | 'base64' | 'auto' | 'pem'][] = [
    ['hex with a marker in a non-hex run', '3003 020105 ' + marker + ' 00', 'hex'],
    ['Base64 with a marker', 'MAMCAQU' + marker + 'AAAA', 'base64'],
    [
      'PEM with a marker in its body',
      '-----BEGIN CERTIFICATE-----\nMAMCAQU\n' + marker + '\n-----END CERTIFICATE-----\n',
      'pem',
    ],
    ['auto detection of the same marker text', '3003020105 ' + marker, 'auto'],
  ];
  for (const [what, text, format] of refusals) {
    let caught: unknown;
    try {
      describeStructure({ data: text, format });
    } catch (err) {
      caught = err;
    }
    // Auto detection may read marker text as Base64 of some bytes; then nothing is thrown and the checks below cover it.
    if (caught !== undefined) {
      expect(caught, what).toBeInstanceOf(Asn1Error);
      const message = (caught as Asn1Error).message;
      expect(message, what).toMatch(/position \d+|offset \d+/);
      keep(what, message);
    }
  }
  // The hex and Base64 cases must be refusals, not silent reads.
  expect(() => describeStructure({ data: '3003 020105 ' + marker, format: 'hex' })).toThrow(Asn1Error);
  expect(() => describeStructure({ data: 'MAMCAQU' + marker, format: 'base64' })).toThrow(Asn1Error);

  // Bytes whose structure cannot be followed: findings name an offset and say nothing of the bytes.
  const text = (value: string): number[] => [...value].map((ch) => ch.charCodeAt(0));
  const broken: [string, number[]][] = [
    ['a length that runs past the end', [0x30, 0x83, 0xff, 0xff, 0xff, ...text(marker.repeat(6))]],
    ['an indefinite length that is never closed', [0x30, 0x80, 0x04, 0x0d, ...text(marker)]],
    ['a length of the reserved octet FF', [0x04, 0xff, ...text(marker)]],
  ];
  for (const [what, bytes] of broken) {
    const result = describeStructure({ data: new Uint8Array(bytes) });
    expect(result.findings.length, what).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.message, what).toMatch(/offset \d+/);
      keep(what, finding.message);
    }
  }

  for (const text of texts) {
    for (const copy of copies) expect(text).not.toContain(copy);
  }
});

/*
 * The rules of ITU-T X.690 the reader applies, each written from the clause it comes from. An element is written out as
 * bytes by hand here, so the expectation never comes from the reader.
 */

it('indefinite lengths read to their end-of-contents and a missing end-of-contents is refused in plain words', () => {
  // Clause 8.1.3.6: the length octet 80, contents, then the end-of-contents octets 00 00 (clause 8.1.5).
  const plain = readHex('30800201050000');
  expect(
    plain.nodes.map((node) => [node.offset, node.depth, node.indefinite, node.length, node.end, node.eoc]),
  ).toEqual([
    [0, 0, true, 3, 7, false],
    [2, 1, false, 1, 5, false],
    [5, 1, false, 0, 7, true],
  ]);
  expect(plain.findings.filter((finding) => finding.kind === 'problem')).toEqual([]);

  // Indefinite inside indefinite inside definite: 30 0b [ 30 80 [ 24 80 [ 04 01 41 ] 00 00 ] 00 00 ].
  const nested = readHex('300b3080248004014100000000');
  expect(nested.nodes.map((node) => [node.offset, node.depth, node.eoc, node.end])).toEqual([
    [0, 0, false, 13],
    [2, 1, false, 13],
    [4, 2, false, 11],
    [6, 3, false, 9],
    [9, 3, true, 11],
    [11, 2, true, 13],
  ]);
  expect(nested.findings.filter((finding) => finding.kind === 'problem')).toEqual([]);

  // Data that ends before the end-of-contents octets: one finding, at the offset where the data ended, in plain words.
  // (The indefinite length itself also gets a note, because DER does not allow it; only the problems are counted here.)
  const missing = readHex('3080020105');
  expect(problemsOf(missing)).toHaveLength(1);
  expect(problemsOf(missing)[0]).toMatchObject({ offset: 5, kind: 'problem' });
  expect(problemsOf(missing)[0]!.message).toMatch(/end-of-contents octets \(00 00\) are missing/);
  expect(problemsOf(missing)[0]!.message).toContain('offset 0');
  expect(missing.nodes[0]!.missingEoc).toBe(true);
  expect(missing.cut.stopped).toBeNull();

  // Two containers left open give one finding each, innermost first.
  const both = readHex('30803080');
  expect(problemsOf(both).map((finding) => finding.offset)).toEqual([4, 4]);

  // An indefinite length on an element that is not constructed (clause 8.1.3.6): the length octet is named, reading stops.
  const primitive = readHex('04800102');
  expect(problemsOf(primitive)).toHaveLength(1);
  expect(problemsOf(primitive)[0]).toMatchObject({ offset: 1, kind: 'problem' });
  expect(problemsOf(primitive)[0]!.message).toContain('not constructed');
  expect(primitive.cut.stopped).toMatchObject({ offset: 1 });

  // Tag 0 outside an indefinite container is not end-of-contents octets.
  const stray = readHex('30020000');
  expect(stray.findings.some((finding) => finding.kind === 'problem' && finding.offset === 2)).toBe(true);
});

it('valid BER that is not DER gets a note naming the X.690 clause, never an error', () => {
  const ascii = (text: string): string => toHex(new Uint8Array([...text].map((ch) => ch.charCodeAt(0))));
  const cases: [string, string, string][] = [
    ['an indefinite length', '30800000', 'clause 10.1'],
    ['a length with more octets than it needs', '04810141', 'clause 10.1'],
    ['an INTEGER with a padding octet', '02020005', 'clause 8.3.2'],
    ['an INTEGER with a padding octet of ff', '0202ff80', 'clause 8.3.2'],
    ['a BOOLEAN TRUE that is not ff', '010101', 'clause 11.1'],
    ['a BIT STRING whose unused bits are not zero', '0302040f', 'clause 11.2.1'],
    ['a constructed OCTET STRING', '2403040141', 'clause 10.2'],
    ['a constructed VisibleString', '3a0304014a', 'clause 10.2'],
    ['a SET OF that is not in ascending order', '3106020102020101', 'clause 11.6'],
    ['a UTCTime without seconds', '170b' + ascii('2610030437Z'), 'clause 11.8'],
    ['a UTCTime with an offset instead of Z', '1711' + ascii('261003043759+0530'), 'clause 11.8'],
    ['a GeneralizedTime with a trailing zero in its fraction', '1812' + ascii('20261003043759.50Z'), 'clause 11.7'],
    ['a GeneralizedTime without Z', '180e' + ascii('20261003043759'), 'clause 11.7'],
    ['a second top-level element', '05000500', 'clause 8.1.1.1'],
  ];
  for (const [what, hex, clause] of cases) {
    const result = readHex(hex);
    expect(result.findings.length, what).toBeGreaterThan(0);
    // Valid BER is a note: not one finding is a problem.
    expect(
      result.findings.filter((finding) => finding.kind === 'problem'),
      what,
    ).toEqual([]);
    expect(
      result.findings.some((finding) => finding.kind === 'note' && finding.message.includes(clause)),
      `${what}: a note names ${clause}`,
    ).toBe(true);
    expect(result.derClean, what).toBe(false);
  }

  // Ascending order is fine, and so is a SET with different tags in tag order (clause 10.3).
  expect(readHex('3106020101020102').findings).toEqual([]);
  expect(readHex('310702010204020041').findings).toEqual([]);
  expect(
    readHex('310704020041020102').findings.filter((finding) => finding.message.includes('clause 10.3')),
  ).toHaveLength(1);
  // DER written as DER has nothing to note: a UTCTime with seconds and Z, a BOOLEAN ff, a minimal INTEGER.
  const clean = readHex('3015' + '170d' + ascii('261003043759Z') + '0101ff' + '020105');
  expect(clean.findings).toEqual([]);
  expect(clean.derClean).toBe(true);
});

it('a length past the end, the reserved FF length octet, more than 8 length octets and more than 5 tag octets are refused naming the offset', () => {
  const cases: [string, string, number, RegExp][] = [
    ['a length past the end', '3083ffffff00', 0, /claims 16777215 bytes but only 1 remain/],
    ['a length past the end inside a container', '3004040a0102', 2, /claims 10 bytes but only 2 remain/],
    ['the reserved length octet FF', '04ff0102', 1, /reserved octet FF/],
    ['nine length octets', '04890100000000000000000102', 1, /more than 8 length octets/],
    ['six tag octets', '1f8080808080010500', 0, /more than 5 octets/],
    ['data that ends inside a tag number', '1f81', 0, /ends inside the tag number/],
    ['data that ends where a length should start', '04', 1, /where the length of the element at offset 0 should start/],
    ['data that ends inside a length', '0482', 1, /ends inside the length/],
  ];
  for (const [what, hex, offset, pattern] of cases) {
    const result = readHex(hex);
    expect(result.findings, what).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.offset, what).toBe(offset);
    expect(finding.kind, what).toBe('problem');
    expect(finding.message, what).toMatch(pattern);
    expect(finding.message, what).toContain(`offset ${offset}`);
    expect(result.cut.stopped, what).not.toBeNull();
  }
  // Eight length octets are accepted as far as the length goes: 2 to the 64 minus 1 is far past the end, and is a claim.
  const eight = readHex('0488ffffffffffffffff01');
  expect(eight.findings[0]!.message).toContain('claims 18446744073709551615 bytes');
  // Five tag octets are fine: 1f ff ff ff ff 7f is tag 34359738367.
  const five = readHex('1fffffffff7f00');
  expect(five.findings).toEqual([]);
  expect(five.nodes[0]).toMatchObject({ tag: 34359738367, headerLength: 7 });
});

it('a paste over 5 MiB and a file over 10 MiB are refused before any reading', () => {
  // A stand-in for the bytes that fails the test when anything but its length is looked at.
  const untouchable = (length: number): Uint8Array =>
    new Proxy(new Uint8Array(0), {
      get(target, key) {
        if (key === 'length') return length;
        throw new Error(`the bytes were read (${String(key)})`);
      },
    });
  let caught: unknown;
  try {
    describeStructure({ data: untouchable(MAX_FILE_BYTES + 1) });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Asn1Error);
  expect((caught as Asn1Error).part).toBe('file');
  expect((caught as Asn1Error).message).toContain('10 MiB');

  // The paste is refused by its length alone.
  const paste = 'a'.repeat(MAX_PASTE_CHARS + 1);
  expect(() => readInput(paste)).toThrow(/5 MiB/);
  try {
    readInput(paste);
  } catch (err) {
    expect((err as Asn1Error).part).toBe('input');
    expect((err as Asn1Error).message).not.toContain('aaaa');
  }

  // Exactly at each limit is read. A file of zero bytes is read (as reserved tag 0 elements) and a paste of hex zeros too.
  const atFile = describeStructure({ data: new Uint8Array(MAX_FILE_BYTES), tryInside: false });
  expect(atFile.bytes).toBe(MAX_FILE_BYTES);
  const atPaste = describeStructure({ data: '0'.repeat(MAX_PASTE_CHARS), format: 'hex', tryInside: false });
  expect(atPaste.bytes).toBe(MAX_PASTE_CHARS / 2);
});

it('OCTET STRING and BIT STRING contents are shown as ASN.1 only when they read completely', () => {
  const withInside = (hex: string) => describeStructure({ data: hex, format: 'hex', tryInside: true });

  // A complete SEQUENCE inside an OCTET STRING: a guess, one level below the string, with absolute offsets.
  const octet = withInside('04053003020105');
  const inside = octet.nodes[0]!.inside!;
  expect(inside.map((node) => [node.offset, node.depth, node.tag])).toEqual([
    [2, 2, 16],
    [4, 3, 2],
  ]);
  expect(octet.tree[0]!.children![0]!.label).toBe(INSIDE_LABEL);
  expect(octet.tree[0]!.children![0]!.children![0]!.label).toContain('SEQUENCE');
  expect(octet.elements).toBe(3);

  // A BIT STRING with no unused bits holds the same; one with unused bits does not.
  expect(withInside('0306003003020105').nodes[0]!.inside).toHaveLength(2);
  expect(withInside('0306013003020105').nodes[0]!.inside).toBeUndefined();

  // Contents that stop short, leave a byte over, are text, are empty or are one byte are not shown, and neither are contents
  // that read to the end but with a finding on the way (an indefinite length never closed, a tag in the long form for 2).
  for (const hex of [
    '040430030201',
    '04063003020105ff',
    '040568656c6c6f',
    '0400',
    '040105',
    '04053080020105',
    '04031f0200',
  ]) {
    expect(withInside(hex).nodes[0]!.inside, hex).toBeUndefined();
  }

  // Inside a guess, another guess: an OCTET STRING in an OCTET STRING in an OCTET STRING.
  const deep = withInside('040704053003020105');
  expect(deep.nodes[0]!.inside![0]!.inside).toHaveLength(2);
  expect(deep.elements).toBe(4);

  // With the option off nothing is tried.
  expect(
    describeStructure({ data: '04053003020105', format: 'hex', tryInside: false }).nodes[0]!.inside,
  ).toBeUndefined();

  // The budget counts the bytes tried: 5 bytes of contents do not fit in 3, and do fit in 5, leaving none.
  const bytes = fromHex('04053003020105');
  const node = readHex('04053003020105').nodes[0]!;
  expect(tryInside(bytes, node, { left: 3 })).toBeNull();
  const budget = { left: 5 };
  expect(tryInside(bytes, node, budget)).toHaveLength(2);
  expect(budget.left).toBe(0);
  expect(INSIDE_BUDGET_BYTES).toBe(33_554_432);

  // Forty nested OCTET STRINGs and more: the guesses stop at the 40 levels and nothing throws.
  let chain = [0x05, 0x00];
  for (let i = 0; i < 45; i++) chain = der(0x04, chain);
  const nest = describeStructure({ data: new Uint8Array(chain), tryInside: true });
  expect(nest.deepest).toBeLessThanOrEqual(40);
});

it('PEM with several blocks, Base64, Base64url and hex with spaces or colons give the same bytes', () => {
  const body = der(0x30, [...der(0x04, [0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff, 0xfa]), ...der(0x02, [5])]);
  const other = der(0x30, [...der(0x02, [1]), ...der(0x02, [2])]);
  const bytes = new Uint8Array(body);
  const wrap = (label: string, data: number[]): string => {
    const text = Buffer.from(data).toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += 64) lines.push(text.slice(i, i + 64));
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
  };

  const forms: [string, string, 'auto' | 'pem' | 'base64' | 'hex', string][] = [
    ['PEM', 'Some text before.\n' + wrap('TEST DATA', body) + 'and after\n', 'auto', 'PEM'],
    ['PEM with CRLF line ends', wrap('TEST DATA', body).replace(/\n/g, '\r\n'), 'auto', 'PEM'],
    ['Base64', Buffer.from(bytes).toString('base64'), 'auto', 'Base64'],
    [
      'Base64 in broken lines',
      Buffer.from(bytes)
        .toString('base64')
        .replace(/(.{8})/g, '$1\n'),
      'auto',
      'Base64',
    ],
    ['Base64 without padding', Buffer.from(bytes).toString('base64').replace(/=+$/, ''), 'auto', 'Base64'],
    ['Base64url', Buffer.from(bytes).toString('base64url'), 'auto', 'Base64url'],
    ['hex', toHex(bytes), 'auto', 'hex'],
    ['hex in capitals', toHex(bytes).toUpperCase(), 'auto', 'hex'],
    ['hex with spaces', toHex(bytes).replace(/(..)/g, '$1 ').trim(), 'auto', 'hex'],
    ['hex with colons', toHex(bytes).replace(/(..)/g, '$1:').slice(0, -1), 'auto', 'hex'],
    ['hex in lines', toHex(bytes).replace(/(.{8})/g, '$1\n'), 'auto', 'hex'],
    ['hex chosen by hand', toHex(bytes), 'hex', 'hex'],
    ['Base64 chosen by hand', Buffer.from(bytes).toString('base64'), 'base64', 'Base64'],
    ['PEM chosen by hand', wrap('X', body), 'pem', 'PEM'],
  ];
  for (const [what, text, format, form] of forms) {
    const read = readInput(text, format);
    expect(toHex(read.bytes), what).toBe(toHex(bytes));
    expect(read.form, what).toBe(form);
  }

  // Two blocks are joined in order; text around and between them is ignored; the labels are listed.
  const two = readInput('first\n' + wrap('ONE', body) + 'between\n' + wrap('TWO', other) + 'last', 'auto');
  expect(toHex(two.bytes)).toBe(toHex(new Uint8Array([...body, ...other])));
  expect(two.labels).toEqual(['ONE', 'TWO']);

  // The same bytes opened as a file: text is read as text, anything else is the structure itself.
  expect(readInput(new TextEncoder().encode(toHex(bytes))).form).toBe('hex');
  expect(readInput(new TextEncoder().encode(wrap('X', body))).form).toBe('PEM');
  expect(readInput(bytes).form).toBe('the bytes of the file');
  expect(toHex(readInput(bytes).bytes)).toBe(toHex(bytes));

  // Auto prefers PEM, then hex when the text is only an even number of hex digits; digits alone need Base64 chosen.
  expect(readInput('deadbeef\n' + wrap('X', body)).form).toBe('PEM');
  expect(readInput('1234').form).toBe('hex');
  expect(toHex(readInput('1234', 'base64').bytes)).toBe('d76df8');
  expect(readInput('123').form).toBe('Base64');

  // Text that is not the chosen form is refused naming a position, and the sentences repeat nothing.
  const refused: [string, 'auto' | 'pem' | 'base64' | 'hex', RegExp][] = [
    ['30 03 02 01 0g', 'hex', /position 13/],
    ['3003020', 'hex', /odd number of digits/],
    ['MAMCAQU!', 'base64', /position 7/],
    ['-----BEGIN TEST-----\nMAMCAQU=\n', 'auto', /no END line/],
    ['no block here', 'pem', /No PEM block/],
    ['   \n ', 'auto', /nothing to read/],
  ];
  for (const [text, format, pattern] of refused) {
    let caught: unknown;
    try {
      readInput(text, format);
    } catch (err) {
      caught = err;
    }
    expect(caught, text).toBeInstanceOf(Asn1Error);
    expect((caught as Asn1Error).message, text).toMatch(pattern);
  }
});

it('a file that is not text is read as its bytes whatever input form is chosen, and only a text file follows the choice', () => {
  // The help beside the input form says so: a file that is not text is read as the bytes of the structure.
  const bytes = Uint8Array.from([0x30, 0x05, 0x02, 0x01, 0x01, 0x05, 0x00]);
  for (const format of ['auto', 'pem', 'base64', 'hex'] as const) {
    const read = readInput(bytes, format);
    expect(read.form, format).toBe('the bytes of the file');
    expect(toHex(read.bytes), format).toBe('30050201010500');
  }

  // A text file follows the choice: the same hex text read as hex, as Base64, and refused as PEM.
  const hexFile = new TextEncoder().encode('30050201010500');
  expect(toHex(readInput(hexFile, 'hex').bytes)).toBe('30050201010500');
  expect(readInput(hexFile, 'base64').form).toBe('Base64');
  expect(() => readInput(hexFile, 'pem')).toThrow(/No PEM block/);

  // A text file that starts with a UTF-8 byte order mark is still text, under every choice that fits it.
  const pem = `-----BEGIN X-----\n${Buffer.from(bytes).toString('base64')}\n-----END X-----\n`;
  const withMark = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(pem)]);
  for (const format of ['auto', 'pem'] as const) {
    const read = readInput(withMark, format);
    expect(read.form, format).toBe('PEM');
    expect(toHex(read.bytes), format).toBe('30050201010500');
  }
});
