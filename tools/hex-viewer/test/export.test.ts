import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initSync, format as gofmt } from '@wasm-fmt/gofmt/web';
import xxdCases from './fixtures/xxd/cases.json';
import {
  EXPORT_LANGUAGES,
  MAX_EXPORT_BYTES,
  cleanIdentifier,
  exportCodeArray,
  exportRange,
  type ExportLanguage,
} from '../src/export';
import { HexViewerError } from '../src/index';

/*
 * Grounding (D-233, 19-01 S8).
 *
 * The C form is the output of `xxd -i`. The program's own source, the Vim repository file src/xxd/xxd.c at blob
 * 9b1ca6ea5555df413546e48126d75ab91e1c8393 (repository head 03e7afb02d952fc117579b141ef8baf503f0ff63 of 2026-10-05),
 * holds these rules, read from the GitHub contents API:
 *   line 971:        case HEX_CINCLUDE: cols = 12; break;
 *   lines 1079-1135: the array name is written as "unsigned char %s", with two underscores first when the first byte
 *                    of the name is a digit; each byte of the name that is not an ASCII letter or digit is written as an
 *                    underscore; each hex byte is "%s0x%02x" and the text before it is ", " inside a line, two spaces
 *                    before the first byte and ",\n  " at a line break; a line feed follows the last byte only when
 *                    there is a byte; then "};\n" and the length line "unsigned int %s_len = %d;\n".
 *
 * The literal below is what `xxd -i b13.bin` printed for the 13 bytes abcdefghijklm (Git for Windows xxd 2025-11-26
 * and Ubuntu 24.04 xxd 2023-10-25 agree), recorded on 2026-10-07 and kept with its recorder in test/fixtures/xxd.
 *
 * The other four languages are conventional forms and no program's output. Their checks, none of which shells out:
 *   JavaScript  the text is evaluated with node:vm and the bytes read back;
 *   Python      the text was run by Python 3.14.3 once (test/fixtures/langs/record.py) and the recording holds the text's
 *               SHA-256, the length and the SHA-256 of the bytes; the test regenerates the text and compares;
 *   Go          the gofmt engine (@wasm-fmt/gofmt 0.7.3, the Go standard library go/format compiled to WebAssembly)
 *               parses the text and must return it unchanged;
 *   Rust        no compiler was available, so only the grammar (The Rust Reference: const item, array expression,
 *               hexadecimal integer literal inferred as u8) was followed. The limits text says so.
 * Reserved words: Go 25 keywords (go.dev/ref/spec, "The following keywords are reserved"); Python 3.14.3 keyword.kwlist
 * (35); JavaScript ReservedWord plus the strict mode words and the names arguments and eval (ECMA-262 sections 13.1.1
 * and 13.2.1, tc39.es/ecma262, read 2026-10-07).
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const LANGUAGES: ExportLanguage[] = ['c', 'rust', 'go', 'python', 'javascript'];

/** Seeded bytes (mulberry32): the same generator and seeds as test/fixtures/langs/make-texts.mjs. */
function seededBytes(size: number): Uint8Array {
  let a = 1900 + size;
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 256);
  }
  return out;
}

const TEN_SIZES = [0, 1, 2, 11, 12, 13, 24, 25, 1000, 4096];
const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

function refusal(run: () => unknown): HexViewerError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    return err as HexViewerError;
  }
  throw new Error('expected a refusal');
}

// ---------------------------------------------------------------------------------------------------------------------
// The C form against xxd -i
// ---------------------------------------------------------------------------------------------------------------------

/** Reads the arguments that followed `xxd -i` in a recorded case. */
function xxdArguments(args: string): {
  name?: string;
  perLine: number;
  upper: boolean;
  capital: boolean;
  skip: number;
  length?: number;
} {
  const parts = args.split(' ').filter((part) => part !== '');
  const read: { name?: string; perLine: number; upper: boolean; capital: boolean; skip: number; length?: number } = {
    perLine: 12,
    upper: false,
    capital: false,
    skip: 0,
  };
  for (let i = 0; i < parts.length; i++) {
    const option = parts[i];
    if (option === '-u') read.upper = true;
    else if (option === '-C') read.capital = true;
    else if (option === '-c') read.perLine = Number(parts[++i]);
    else if (option === '-n') read.name = parts[++i]!;
    else if (option === '-s') read.skip = Number(parts[++i]);
    else if (option === '-l') read.length = Number(parts[++i]);
    else throw new Error(`unknown xxd option ${option}`);
  }
  return read;
}

it('the C form equals the 121 recorded xxd -i outputs byte for byte', () => {
  expect(xxdCases.identical).toBe(true);
  expect(xxdCases.xxd).toHaveLength(2);
  expect(xxdCases.xxd.some((version) => version.includes('2025-11-26'))).toBe(true);
  expect(xxdCases.xxd.some((version) => version.includes('2023-10-25'))).toBe(true);
  expect(xxdCases.cases).toHaveLength(121);

  const sizes = new Set<number>();
  const optionSets = new Set<string>();
  for (const recorded of xxdCases.cases) {
    const all = new Uint8Array(Buffer.from(recorded.bytesBase64, 'base64'));
    sizes.add(all.length);
    optionSets.add(recorded.args);
    const used = xxdArguments(recorded.args);
    const { start, end } = exportRange(all.length, used.skip, used.length);
    const result = exportCodeArray(all.subarray(start, end), {
      language: 'c',
      name: used.name ?? recorded.file,
      perLine: used.perLine,
      upper: used.upper,
      capital: used.capital,
    });
    // A failure names the case, never the whole 25 KB text.
    expect(result.text === recorded.output, `${recorded.file} | ${recorded.args}`).toBe(true);
  }
  expect(sizes.size).toBe(11);
  expect(optionSets.size).toBe(11);

  // The recorded name table: the argument as typed (a file name or an -n value) and the variable xxd derived.
  expect(xxdCases.names.length).toBeGreaterThanOrEqual(15);
  for (const name of xxdCases.names) {
    expect(cleanIdentifier('c', name.arg), `${name.via} ${name.identifier}`).toBe(name.identifier);
  }
});

it('twelve bytes fill one C line and a thirteenth starts a second line, as xxd -i does', () => {
  const twelve = exportCodeArray(bytesOf('abcdefghijkl'), {
    language: 'c',
    name: 'b12.bin',
    perLine: 12,
    upper: false,
  });
  expect(twelve.text).toBe(
    [
      'unsigned char b12_bin[] = {',
      '  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c',
      '};',
      'unsigned int b12_bin_len = 12;',
      '',
    ].join('\n'),
  );

  const thirteen = exportCodeArray(bytesOf('abcdefghijklm'), {
    language: 'c',
    name: 'b13.bin',
    perLine: 12,
    upper: false,
  });
  expect(thirteen.text).toBe(
    [
      'unsigned char b13_bin[] = {',
      '  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c,',
      '  0x6d',
      '};',
      'unsigned int b13_bin_len = 13;',
      '',
    ].join('\n'),
  );
  expect(thirteen.identifier).toBe('b13_bin');
  expect(thirteen.extension).toBe('h');
  expect(thirteen.bytes).toBe(13);
});

it('every UTF-8 byte of a name that is not an ASCII letter or digit becomes an underscore and a leading digit gets two underscores first', () => {
  // Recorded names (xxd -i on a file of that name, and xxd -i -n): the accent is two bytes, each CJK character three.
  const acute = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) + '.bin';
  const cjk = String.fromCodePoint(0x65e5, 0x672c) + '.bin';
  expect(cleanIdentifier('c', acute)).toBe('caf___bin');
  expect(cleanIdentifier('c', cjk)).toBe('_______bin');
  expect(cleanIdentifier('c', '9lives-file.v2.bin')).toBe('__9lives_file_v2_bin');
  expect(cleanIdentifier('c', 'a b-c.d.bin')).toBe('a_b_c_d_bin');
  expect(cleanIdentifier('c', '_leading.bin')).toBe('_leading_bin');

  // The identifier a result reports is the cleaned name, and it is what the array is written with.
  const result = exportCodeArray(Uint8Array.of(1), { language: 'c', name: acute, perLine: 12, upper: false });
  expect(result.identifier).toBe('caf___bin');
  expect(result.text.startsWith('unsigned char caf___bin[] = {\n')).toBe(true);
});

it('upper case turns the prefix and the digits upper case as xxd -u does', () => {
  // Recorded: xxd -u -i writes 0X00 and upper-case digits, for example 0XFF, 0X00, 0X7F.
  const bytes = Uint8Array.of(0xff, 0x00, 0x7f, 0xab);
  const c = exportCodeArray(bytes, { language: 'c', name: 'u.bin', perLine: 12, upper: true });
  expect(c.text).toBe('unsigned char u_bin[] = {\n  0XFF, 0X00, 0X7F, 0XAB\n};\nunsigned int u_bin_len = 4;\n');

  // The other languages upper-case the digits only and keep the lower-case 0x prefix, which every one of them requires.
  const other = (language: ExportLanguage) =>
    exportCodeArray(bytes, { language, name: 'u.bin', perLine: 12, upper: true }).text;
  expect(other('rust')).toBe('pub const U_BIN: [u8; 4] = [\n    0xFF, 0x00, 0x7F, 0xAB,\n];\n');
  expect(other('go')).toBe('var u_bin = []byte{\n\t0xFF, 0x00, 0x7F, 0xAB,\n}\n');
  expect(other('python')).toBe('u_bin = bytes([\n    0xFF, 0x00, 0x7F, 0xAB,\n])\n');
  expect(other('javascript')).toBe('const u_bin = new Uint8Array([\n  0xFF, 0x00, 0x7F, 0xAB,\n]);\n');
});

// ---------------------------------------------------------------------------------------------------------------------
// Empty selections, columns, ranges and limits
// ---------------------------------------------------------------------------------------------------------------------

it('an empty selection writes an empty array with length 0 in every language', () => {
  const expected: Record<ExportLanguage, string> = {
    c: 'unsigned char empty_bin[] = {\n};\nunsigned int empty_bin_len = 0;\n',
    rust: 'pub const EMPTY_BIN: [u8; 0] = [];\n',
    go: 'var empty_bin = []byte{}\n',
    python: 'empty_bin = bytes([])\n',
    javascript: 'const empty_bin = new Uint8Array([]);\n',
  };
  for (const language of LANGUAGES) {
    const result = exportCodeArray(new Uint8Array(0), { language, name: 'empty.bin', perLine: 12, upper: false });
    expect(result.text, language).toBe(expected[language]);
    expect(result.bytes).toBe(0);
    expect(result.lines).toBe(0);
  }
  // An empty file, a Length of 0 and a start at or past the end all select nothing.
  expect(exportRange(0, 0)).toEqual({ start: 0, end: 0 });
  expect(exportRange(12, 0, 0)).toEqual({ start: 0, end: 0 });
  expect(exportRange(12, 12)).toEqual({ start: 12, end: 12 });
  expect(exportRange(12, 100)).toEqual({ start: 12, end: 12 });
});

it('one to 256 bytes per line are accepted and 0, 257 and a fraction are refused naming the field', () => {
  const bytes = seededBytes(300);
  for (const language of LANGUAGES) {
    for (const perLine of [1, 2, 12, 16, 255, 256]) {
      const result = exportCodeArray(bytes, { language, name: 'a.bin', perLine, upper: false });
      expect(result.lines, `${language} ${perLine}`).toBe(Math.ceil(300 / perLine));
    }
    for (const bad of [0, 257, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = refusal(() => exportCodeArray(bytes, { language, name: 'a.bin', perLine: bad, upper: false }));
      expect(error.field).toBe('Bytes per line');
      expect(error.message).toContain('Bytes per line');
      expect(error.message).toContain('1 to 256');
    }
  }
  // With the default 12 per line, 12 bytes make one body line with no trailing comma in C, and a 13th byte makes a
  // second line holding only that byte (the line break rule is the same for every language).
  const rows = (n: number, language: ExportLanguage): string[] =>
    exportCodeArray(seededBytes(n), { language, name: 'a.bin', perLine: 12, upper: false })
      .text.split('\n')
      .filter((line) => /0x[0-9a-f]{2}/.test(line));
  expect(rows(12, 'c')).toHaveLength(1);
  expect(rows(12, 'c')[0]!.endsWith(',')).toBe(false);
  expect(rows(13, 'c')).toHaveLength(2);
  expect(rows(13, 'c')[1]!.match(/0x/g)).toHaveLength(1);
  for (const language of LANGUAGES) {
    expect(rows(12, language), language).toHaveLength(1);
    expect(rows(13, language), language).toHaveLength(2);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The other four languages, checked with an engine each
// ---------------------------------------------------------------------------------------------------------------------

it('the JavaScript array evaluates to the same bytes for ten sizes', () => {
  for (const size of TEN_SIZES) {
    const bytes = seededBytes(size);
    const { text, identifier } = exportCodeArray(bytes, {
      language: 'javascript',
      name: 'my data.bin',
      perLine: 12,
      upper: size % 2 === 1,
    });
    expect(identifier).toBe('my_data_bin');
    // The text is a const declaration; the value of the next statement is the array it made.
    const value = vm.runInNewContext(`${text}\nmy_data_bin;`) as Uint8Array;
    expect(value.length).toBe(size);
    expect(Buffer.from(value).equals(Buffer.from(bytes))).toBe(true);
  }
});

it('the Python array matches the recorded length and SHA-256 for ten sizes', () => {
  // python.json is written by test/fixtures/langs/record.py after Python 3.14.3 ran each text from make-texts.mjs.
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/langs/python.json', import.meta.url), 'utf8')) as {
    recordedAt: string;
    python: string;
    cases: { size: number; textSha256: string; length: number; bytesSha256: string }[];
  };
  expect(recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(recorded.python).toMatch(/^3\./);
  expect(recorded.cases.map((c) => c.size)).toEqual(TEN_SIZES);
  for (const entry of recorded.cases) {
    const bytes = seededBytes(entry.size);
    const { text } = exportCodeArray(bytes, { language: 'python', name: 'my data.bin', perLine: 12, upper: false });
    // The recording is of this very text, and Python read back the same number and the same bytes.
    expect(sha256(text), `text of ${entry.size} bytes`).toBe(entry.textSha256);
    expect(entry.length).toBe(entry.size);
    expect(entry.bytesSha256).toBe(sha256(bytes));
  }
});

it('the Go array is unchanged by the gofmt engine for ten sizes', () => {
  const require = createRequire(import.meta.url);
  initSync(readFileSync(require.resolve('@wasm-fmt/gofmt/wasm')));
  for (const size of TEN_SIZES) {
    const { text } = exportCodeArray(seededBytes(size), {
      language: 'go',
      name: 'my data.bin',
      perLine: 12,
      upper: false,
    });
    const source = `package main\n\n${text}`;
    // gofmt parses the file (a syntax error throws) and prints it back; an unchanged text is already in gofmt style.
    expect(gofmt(source), `${size} bytes`).toBe(source);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------------

// Go: the 25 keywords of go.dev/ref/spec.
const GO_KEYWORDS =
  'break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var'.split(
    ' ',
  );
// Python 3.14.3: keyword.kwlist, 35 words. The soft keywords _, case, match and type stay legal names.
const PYTHON_KEYWORDS =
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  );
// JavaScript: ReservedWord (ECMA-262 12.7.2), the strict mode words (13.1.1) and the two names a strict binding refuses.
const JS_RESERVED =
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield'.split(
    ' ',
  );
const JS_STRICT = 'implements interface let package private protected public static yield arguments eval'.split(' ');

it('Rust, Go, Python and JavaScript names are cleaned, a reserved word gets a trailing underscore and an empty name becomes data', () => {
  expect(GO_KEYWORDS).toHaveLength(25);
  expect(PYTHON_KEYWORDS).toHaveLength(35);
  for (const word of GO_KEYWORDS) expect(cleanIdentifier('go', word), word).toBe(`${word}_`);
  for (const word of PYTHON_KEYWORDS) expect(cleanIdentifier('python', word), word).toBe(`${word}_`);
  for (const word of [...JS_RESERVED, ...JS_STRICT]) expect(cleanIdentifier('javascript', word), word).toBe(`${word}_`);
  // Words that are legal names stay as typed.
  for (const word of ['match', 'case', 'type', '_', 'print']) {
    expect(cleanIdentifier('python', word)).toBe(word);
  }
  expect(cleanIdentifier('javascript', 'async')).toBe('async');
  expect(cleanIdentifier('go', 'string')).toBe('string');
  expect(cleanIdentifier('go', 'Func')).toBe('Func');

  // Every non-alphanumeric byte of the UTF-8 name is an underscore, and a leading digit gets one underscore first.
  const acute = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) + '.bin';
  for (const language of ['go', 'python', 'javascript'] as const) {
    expect(cleanIdentifier(language, 'my data.bin')).toBe('my_data_bin');
    expect(cleanIdentifier(language, acute)).toBe('caf___bin');
    expect(cleanIdentifier(language, '9lives-file.v2.bin')).toBe('_9lives_file_v2_bin');
    expect(cleanIdentifier(language, 'a--b')).toBe('a__b');
  }
  // Rust constants are upper case, and a leading digit gets one underscore.
  expect(cleanIdentifier('rust', 'my data.bin')).toBe('MY_DATA_BIN');
  expect(cleanIdentifier('rust', acute)).toBe('CAF___BIN');
  expect(cleanIdentifier('rust', '9lives.bin')).toBe('_9LIVES_BIN');
  expect(cleanIdentifier('rust', 'x.TAR.GZ')).toBe('X_TAR_GZ');

  // A name with nothing usable becomes data (a Rust constant DATA, and in Go the blank name is not a variable).
  for (const language of ['c', 'go', 'python', 'javascript'] as const) {
    expect(cleanIdentifier(language, ''), language).toBe('data');
  }
  expect(cleanIdentifier('rust', '')).toBe('DATA');
  expect(cleanIdentifier('go', '.')).toBe('data');
  expect(cleanIdentifier('rust', '.')).toBe('DATA');

  // The result reports the cleaned name for the language it was asked for, and the extension of the saved file.
  const extensions: Record<ExportLanguage, string> = { c: 'h', rust: 'rs', go: 'go', python: 'py', javascript: 'js' };
  for (const language of LANGUAGES) {
    const result = exportCodeArray(Uint8Array.of(1), { language, name: 'class', perLine: 12, upper: false });
    expect(result.extension).toBe(extensions[language]);
    expect(result.identifier).toBe(cleanIdentifier(language, 'class'));
  }
  expect(EXPORT_LANGUAGES.map((info) => info.id)).toEqual(LANGUAGES);
  expect(EXPORT_LANGUAGES[0]!.label).toBe('C or C++ (xxd -i form)');
});

it('a name over 200 characters is refused naming the field and never repeated', () => {
  const marker = 'SECRET-MARKER-ab12';
  const tooLong = marker + 'q'.repeat(300);
  for (const language of LANGUAGES) {
    const error = refusal(() => cleanIdentifier(language, tooLong));
    expect(error.field).toBe('Variable name');
    expect(error.message).toContain('Variable name');
    expect(error.message).toContain('200');
    expect(error.message).not.toContain('SECRET');
    expect(error.message).not.toContain('qqqq');
    const viaExport = refusal(() =>
      exportCodeArray(Uint8Array.of(1), { language, name: tooLong, perLine: 12, upper: false }),
    );
    expect(viaExport.message).not.toContain('SECRET');
  }
  // 200 characters are accepted, and the limit counts characters, not bytes (200 accented letters are 400 bytes).
  expect(cleanIdentifier('c', 'a'.repeat(200))).toBe('a'.repeat(200));
  expect(cleanIdentifier('c', String.fromCodePoint(0xe9).repeat(200))).toBe('_'.repeat(400));
  expect(() => cleanIdentifier('c', 'a'.repeat(201))).toThrow(HexViewerError);

  // Refusals about numbers and the size name their field and show no typed text.
  for (const run of [
    () => exportRange(10, -1),
    () => exportRange(10, 1.5),
    () => exportRange(10, 2147483648),
    () => exportRange(10, 0, -3),
    () => exportRange(10, 0, 0.5),
  ]) {
    const error = refusal(run);
    expect(['Export from byte', 'Length']).toContain(error.field);
    expect(error.message).toContain(error.field!);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Properties over every language, limits and repeatability
// ---------------------------------------------------------------------------------------------------------------------

it('every language keeps the bytes in file order, one line per group, line feeds only and no trailing spaces', () => {
  for (const language of LANGUAGES) {
    for (let size = 0; size <= 300; size++) {
      const bytes = seededBytes(size);
      const perLine = [12, 1, 7, 16, 256][size % 5]!;
      const { text, lines } = exportCodeArray(bytes, { language, name: 'seed.bin', perLine, upper: size % 3 === 0 });
      const label = `${language} ${size} bytes, ${perLine} per line`;
      expect(text.endsWith('\n'), label).toBe(true);
      expect(text.includes('\r'), label).toBe(false);
      expect(/[ \t]\n/.test(text), label).toBe(false);
      const rows = text.split('\n').filter((line) => /0[xX][0-9a-fA-F]{2}/.test(line));
      expect(rows.length, label).toBe(Math.ceil(size / perLine));
      expect(lines, label).toBe(rows.length);
      const back: number[] = [];
      rows.forEach((row, index) => {
        const found = [...row.matchAll(/0[xX]([0-9a-fA-F]{2})/g)].map((m) => parseInt(m[1]!, 16));
        // A full group everywhere except the last row, which holds what is left.
        expect(found.length, `${label} row ${index}`).toBe(index < rows.length - 1 ? perLine : size - perLine * index);
        back.push(...found);
      });
      expect(back, label).toEqual([...bytes]);
    }
  }
});

it('an export over 4 MiB is refused naming the limit and a start past the end gives an empty array', () => {
  expect(MAX_EXPORT_BYTES).toBe(4 * 1024 * 1024);
  const five = 5 * 1024 * 1024;
  // Over the limit, whether the end is open or a Length is too long; the file's size alone is not the question.
  for (const run of [
    () => exportRange(five, 0),
    () => exportRange(five, 0, MAX_EXPORT_BYTES + 1),
    () => exportRange(MAX_EXPORT_BYTES + 1, 0),
    () =>
      exportCodeArray(new Uint8Array(MAX_EXPORT_BYTES + 1), { language: 'c', name: 'big', perLine: 12, upper: false }),
  ]) {
    const error = refusal(run);
    expect(error.field).toBe('Export');
    expect(error.message).toContain('4 MiB');
  }
  // Exactly 4 MiB is accepted, from any start that leaves 4 MiB or less.
  expect(exportRange(MAX_EXPORT_BYTES, 0)).toEqual({ start: 0, end: MAX_EXPORT_BYTES });
  expect(exportRange(five, 0, MAX_EXPORT_BYTES)).toEqual({ start: 0, end: MAX_EXPORT_BYTES });
  expect(exportRange(five, 1024 * 1024)).toEqual({ start: 1024 * 1024, end: five });
  const whole = exportCodeArray(new Uint8Array(MAX_EXPORT_BYTES), {
    language: 'c',
    name: 'big',
    perLine: 256,
    upper: false,
  });
  expect(whole.bytes).toBe(MAX_EXPORT_BYTES);
  expect(whole.lines).toBe(MAX_EXPORT_BYTES / 256);

  // The window: Length absent means to the end, a Length past the end is cut, 0 is empty, and a start at or past the end is empty.
  expect(exportRange(12, 3)).toEqual({ start: 3, end: 12 });
  expect(exportRange(12, 3, 7)).toEqual({ start: 3, end: 10 });
  expect(exportRange(12, 3, 100)).toEqual({ start: 3, end: 12 });
  expect(exportRange(12, 5, 0)).toEqual({ start: 5, end: 5 });
  expect(exportRange(12, 12, 4)).toEqual({ start: 12, end: 12 });
  expect(exportRange(12, 2147483647, 2147483647)).toEqual({ start: 12, end: 12 });
});

it('exporting the same bytes twice gives the same text', () => {
  // Bytes appear in file order starting at the chosen byte, and nothing in the text depends on the call.
  const bytes = seededBytes(1000);
  const window = exportRange(bytes.length, 100, 500);
  for (const language of LANGUAGES) {
    const options = { language, name: 'twice.bin', perLine: 16, upper: false };
    const first = exportCodeArray(bytes.subarray(window.start, window.end), options);
    const second = exportCodeArray(Uint8Array.from(bytes.subarray(window.start, window.end)), options);
    expect(second.text, language).toBe(first.text);
    expect(second.identifier).toBe(first.identifier);
    // The first byte written is the byte at the start of the window.
    const firstHex = bytes[100]!.toString(16).padStart(2, '0');
    expect(first.text, language).toContain(`0x${firstHex}`);
    expect(first.bytes).toBe(500);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The package says nothing
// ---------------------------------------------------------------------------------------------------------------------

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

it('the export module prints nothing to the console, even when it refuses', () => {
  for (const language of LANGUAGES) {
    exportCodeArray(seededBytes(30), { language, name: 'quiet.bin', perLine: 8, upper: true });
    expect(() => exportCodeArray(seededBytes(3), { language, name: 'q', perLine: 0, upper: false })).toThrow(
      HexViewerError,
    );
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
