/**
 * Attachment names. The expected names come from the rule in the page's limits text (paths, controls, direction marks,
 * reserved characters, device names, trailing dots, length, repeats), not from running the package. Invisible and
 * non-ASCII characters are built at run time so this file holds none of them.
 */
import { it, expect } from 'vitest';
import { analyzeMessage, safeAttachmentName, showBody } from '../src/index';
import { CRLF, build, multipart } from './helpers';

const BS = String.fromCharCode(92);
const clean = (raw: string, index = 1, taken: Set<string> = new Set()): string =>
  safeAttachmentName(raw, index, taken).name;

it('attachment names are cleaned of paths, controls, direction marks and device names, and repeats get a number', async () => {
  // Paths of both kinds: only the part after the last slash or backslash is kept.
  expect(clean('../../etc/passwd')).toBe('passwd');
  expect(clean(`C:${BS}Windows${BS}system32${BS}calc.exe`)).toBe('calc.exe');
  expect(clean(`dir/sub${BS}mixed.txt`)).toBe('mixed.txt');

  // A right-to-left override cannot make an executable look like a document: it becomes an underscore.
  const rlo = String.fromCodePoint(0x202e);
  expect(clean(`report.pdf${rlo}txt.exe`)).toBe('report.pdf_txt.exe');
  for (const point of [0x200b, 0x200e, 0x2066, 0xfeff, 0x00ad, 0x00a0, 0x2028]) {
    expect(clean(`a${String.fromCodePoint(point)}b.txt`), point.toString(16)).toBe('a_b.txt');
  }
  // Controls, including NUL, tab and DEL, and the reserved characters.
  expect(clean(`a${String.fromCharCode(0)}b.txt`)).toBe('a_b.txt');
  expect(clean(`a${String.fromCharCode(9)}b${String.fromCharCode(127)}c.txt`)).toBe('a_b_c.txt');
  expect(clean('a:b*c?.txt')).toBe('a_b_c_.txt');
  expect(clean('x"y<z>w|v')).toBe('x_y_z_w_v');

  // Windows device names, with or without an extension, in any letter case, get a leading underscore; similar names do not.
  expect(clean('con.txt')).toBe('_con.txt');
  expect(clean('aux')).toBe('_aux');
  expect(clean('COM1')).toBe('_COM1');
  expect(clean('Lpt9.tar.gz')).toBe('_Lpt9.tar.gz');
  expect(clean('nul')).toBe('_nul');
  expect(clean('console.txt')).toBe('console.txt');
  expect(clean('com10.txt')).toBe('com10.txt');
  // COM0 is reserved too (see the device name test below).
  expect(clean('com0')).toBe('_com0');

  // Trailing dots and spaces go, and a leading run of dots becomes one underscore; a name with nothing left is numbered.
  expect(clean('name.')).toBe('name');
  expect(clean('name. . ')).toBe('name');
  expect(clean('..hidden')).toBe('_hidden');
  expect(clean('.profile')).toBe('_profile');
  expect(clean('...', 3)).toBe('attachment-3');
  expect(clean('', 7)).toBe('attachment-7');
  expect(clean('   ', 2)).toBe('attachment-2');
  expect(clean('///', 4)).toBe('attachment-4');
  expect(clean('keep.dots.inside.txt')).toBe('keep.dots.inside.txt');

  // Length: 120 UTF-16 units, cut by code point, the extension kept.
  expect(clean('a'.repeat(300))).toHaveLength(120);
  const long = clean(`${'a'.repeat(300)}.txt`);
  expect(long).toHaveLength(120);
  expect(long.endsWith('.txt')).toBe(true);
  expect(clean('a'.repeat(120))).toBe('a'.repeat(120));
  const pair = String.fromCodePoint(0x1f600);
  const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const cutAtPair = clean(`${'a'.repeat(119)}${pair}xyz`);
  expect(cutAtPair).toBe('a'.repeat(119));
  expect(loneSurrogate.test(cutAtPair)).toBe(false);
  const keepsPair = clean(`${'a'.repeat(115)}${pair}bbbbbbbbbb`);
  expect(keepsPair).toHaveLength(120);
  expect(keepsPair.includes(pair)).toBe(true);
  expect(loneSurrogate.test(keepsPair)).toBe(false);
  // A lone surrogate in a name is replaced, never kept.
  expect(clean(`a${String.fromCharCode(0xd800)}b`)).toBe('a_b');
  // A very long extension is not kept as an extension: the whole name is cut.
  expect(clean(`a.${'x'.repeat(200)}`)).toHaveLength(120);

  // Repeats get a number before the extension, compared without regard to letter case, and the set is shared.
  const taken = new Set<string>();
  expect(clean('report.txt', 1, taken)).toBe('report.txt');
  expect(clean('report.txt', 2, taken)).toBe('report (2).txt');
  expect(clean('report.txt', 3, taken)).toBe('report (3).txt');
  expect(clean('REPORT.TXT', 4, taken)).toBe('REPORT (4).TXT');
  expect(clean('notes', 5, taken)).toBe('notes');
  expect(clean('notes', 6, taken)).toBe('notes (2)');
  // A number never pushes a name over 120 units.
  const full = 'b'.repeat(116) + '.txt';
  expect(clean(full, 7, taken)).toBe(full);
  const second = clean(full, 8, taken);
  expect(second).toHaveLength(120);
  expect(second.endsWith(' (2).txt')).toBe(true);
  expect(safeAttachmentName('x.txt', 1, new Set()).changed).toBe(false);
  expect(safeAttachmentName('../x.txt', 1, new Set()).changed).toBe(true);

  // Through a whole message: the raw name is kept as written beside the cleaned one, in part order, repeats numbered.
  const bytes = build(
    ['Content-Type: multipart/mixed; boundary=m'],
    multipart('m', [
      { headers: ['Content-Type: text/plain'], body: 'body' },
      {
        headers: [
          'Content-Type: application/octet-stream',
          `Content-Disposition: attachment; filename="..${BS}..${BS}evil.exe"`,
        ],
        body: 'one',
      },
      {
        headers: ['Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="report.txt"'],
        body: 'two',
      },
      {
        headers: ['Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="report.txt"'],
        body: 'three',
      },
      { headers: ['Content-Type: application/octet-stream', 'Content-Disposition: attachment'], body: 'no name' },
    ]),
  );
  const analysis = await analyzeMessage(bytes);
  expect(analysis.attachments.map((a) => a.name)).toEqual(['evil.exe', 'report.txt', 'report (2).txt', 'attachment-4']);
  expect(analysis.attachments.map((a) => a.rawName)).toEqual([
    `..${BS}..${BS}evil.exe`,
    'report.txt',
    'report.txt',
    '',
  ]);
  expect(analysis.attachments.map((a) => a.nameChanged)).toEqual([true, false, true, true]);
});

it('a cleaned name never ends in a space or a dot after it is cut, and every Windows device name is renamed', () => {
  // A cut that lands on a space or a dot: Windows drops a trailing space or dot, so the name is trimmed again after it.
  expect(clean(`${'b'.repeat(119)} ${'c'.repeat(180)}`)).toBe('b'.repeat(119));
  expect(clean(`${'b'.repeat(118)}. ${'c'.repeat(180)}`)).toBe('b'.repeat(118));
  // With an extension the base is trimmed before it, and with a number the base is trimmed before the number.
  expect(clean(`${'b'.repeat(115)} ${'c'.repeat(100)}.pdf`)).toBe(`${'b'.repeat(115)}.pdf`);
  const taken = new Set<string>();
  const repeated = `${'b'.repeat(115)} cccc`;
  expect(clean(repeated, 1, taken)).toBe(repeated);
  expect(clean(repeated, 2, taken)).toBe(`${'b'.repeat(115)} (2)`);
  // A base that is all spaces once cut keeps one underscore, so the name is never empty or only an extension.
  expect(clean(`${' '.repeat(130)}x`)).toBe('_');
  for (const raw of [`${'b'.repeat(119)} ${'c'.repeat(180)}`, `${' '.repeat(100)}.${'d'.repeat(40)}`]) {
    const name = clean(raw);
    expect(name.endsWith(' ') || name.endsWith('.'), JSON.stringify(name)).toBe(false);
    expect(name.length).toBeLessThanOrEqual(120);
  }

  // Microsoft's list of reserved names: CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9, the superscript digits one, two
  // and three after COM and LPT, and the console names CONIN$ and CONOUT$, with or without an extension, in any case.
  const superscripts = [0xb9, 0xb2, 0xb3].map((point) => String.fromCodePoint(point));
  const reserved = [
    'COM0',
    'lpt0.txt',
    ...superscripts.map((s) => `COM${s}`),
    ...superscripts.map((s) => `lpt${s}.log`),
    'CONIN$',
    'conout$.txt',
  ];
  for (const raw of reserved) expect(clean(raw), raw).toBe(`_${raw}`);
  // Names that only look like them are kept: a fourth superscript digit, a two-digit number, CONIN without the sign.
  for (const raw of [`COM${String.fromCodePoint(0x2074)}`, 'com10.txt', 'conin.txt', 'conout', 'lpt00']) {
    expect(clean(raw), raw).toBe(raw);
  }
});

it('an attachment is named from filename star, then filename, then name, with the others listed', async () => {
  const attachment = (disposition: string, type: string) =>
    build(
      ['Content-Type: multipart/mixed; boundary=m'],
      multipart('m', [
        { headers: ['Content-Type: text/plain'], body: 'body' },
        {
          headers: [`Content-Type: ${type}`, ...(disposition === '' ? [] : [`Content-Disposition: ${disposition}`])],
          body: 'data',
        },
      ]),
    );
  const first = async (disposition: string, type: string) =>
    (await analyzeMessage(attachment(disposition, type))).attachments[0];

  // filename* wins over filename and name.
  const all = await first(
    `attachment; filename="plain.txt"; filename*=utf-8''caf%C3%A9.txt`,
    'text/plain; name="named.txt"',
  );
  expect(all?.name).toBe(`caf${String.fromCodePoint(0xe9)}.txt`);
  expect(all?.otherNames).toEqual(['plain.txt', 'named.txt']);
  // filename wins over name.
  const plain = await first('attachment; filename="plain.txt"', 'text/plain; name="named.txt"');
  expect(plain?.name).toBe('plain.txt');
  expect(plain?.otherNames).toEqual(['named.txt']);
  // name alone names an inline part too: a part with a name is an attachment even without a disposition.
  const named = await first('', 'application/pdf; name="only-name.pdf"');
  expect(named?.name).toBe('only-name.pdf');
  expect(named?.declaredType).toBe('application/pdf');
  // RFC 2047 words in a plain name are decoded as a courtesy.
  const word = await first('attachment; filename="=?UTF-8?B?Y2Fmw6kudHh0?="', 'text/plain');
  expect(word?.name).toBe(`caf${String.fromCodePoint(0xe9)}.txt`);
  // The declared type never decides anything: an HTML part with a name is a file to save, not a body.
  const html = await analyzeMessage(attachment('attachment; filename="page.html"', 'text/html'));
  expect(html.attachments[0]?.declaredType).toBe('text/html');
  expect(html.htmlBody).toBeNull();
  // A continued name joins before it is cleaned.
  const split = await first(`attachment; filename*0*=utf-8''a%2F; filename*1*=b.txt`, 'text/plain');
  expect(split?.rawName).toBe('a/b.txt');
  expect(split?.name).toBe('b.txt');
});

it('a body shown as text has its hidden and direction characters escaped and its line ends made one', () => {
  const rlo = String.fromCodePoint(0x202e);
  const shown = showBody(
    `line one${CRLF}line two\rline three\n\ttabbed ${rlo}evil${String.fromCharCode(0)}end ${String.fromCodePoint(0x1f600)}`,
  );
  expect(shown).toBe(
    `line one\nline two\nline three\n\ttabbed ${BS}u{202E}evil${BS}u{0}end ${String.fromCodePoint(0x1f600)}`,
  );
  expect(showBody('plain ASCII only')).toBe('plain ASCII only');
});
