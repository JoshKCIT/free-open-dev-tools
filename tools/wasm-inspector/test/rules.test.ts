import { expect, it } from 'vitest';
import { MAX_STRINGS, MAX_STRING_SCAN_BYTES, inspect } from '../src/index';
import { custom, moduleOf, name, section, uleb, vec } from './helpers';

/*
 * Rules that the specification states and the page relies on, each with a module built to show it: the locals declaration
 * at the start of a body, the counts that must agree between sections, printable text in data segments, the features a
 * module uses, constant expressions, and names that cannot hide. Offsets are worked out from the bytes built here.
 */

const TYPE_SECTION = section(1, vec([[0x60, 0x00, 0x00]]));
const text = (value: string): number[] => [...new TextEncoder().encode(value)];

function dataSection(...segments: number[][]): number[] {
  return section(11, vec(segments.map((bytes) => [0x01, ...uleb(bytes.length), ...bytes])));
}

it('a body whose locals add up to more than 4,294,967,295 or are cut short is a finding and the bodies around it are measured', () => {
  const body = (...locals: number[][]): number[] => {
    const content = [...vec(locals), 0x0b];
    return [...uleb(content.length), ...content];
  };
  // 0xffffffff locals of i32 is the most a function may declare; one more makes it too many.
  const max = [0xff, 0xff, 0xff, 0xff, 0x0f, 0x7f];
  const one = [0x01, 0x7f];
  const code = (...bodies: number[][]): number[] => section(10, vec(bodies));
  const functions = section(3, vec([[0x00], [0x00], [0x00]]));

  const good = inspect(moduleOf(TYPE_SECTION, functions, code(body(max), body(one), body())));
  expect(good.findings).toEqual([]);
  expect(good.functions.largest).toHaveLength(3);

  const tooMany = inspect(moduleOf(TYPE_SECTION, functions, code(body(max, one), body(one), body())));
  expect(tooMany.findings).toHaveLength(1);
  expect(tooMany.findings[0]?.message).toMatch(/too many locals/);
  // The finding names the offset of the count that went over: the second declaration of the first body.
  const first = 8 + TYPE_SECTION.length + functions.length;
  expect(tooMany.findings[0]?.offset).toBe(first + 11);
  expect(tooMany.functions.largest).toHaveLength(3);

  // A value type that does not exist, and a declaration cut short by the end of the body.
  const badType = inspect(moduleOf(TYPE_SECTION, section(3, vec([[0x00]])), code(body([0x01, 0x40]))));
  expect(badType.findings.some((f) => /malformed value type/.test(f.message))).toBe(true);
  const cut = inspect(moduleOf(TYPE_SECTION, section(3, vec([[0x00]])), code([0x01, 0x01])));
  expect(cut.findings.some((f) => /unexpected end|length out of bounds/.test(f.message))).toBe(true);
  // An empty body is not even a locals vector.
  const empty = inspect(moduleOf(TYPE_SECTION, section(3, vec([[0x00]])), code([0x00])));
  expect(empty.findings.some((f) => /unexpected end|length out of bounds/.test(f.message))).toBe(true);
});

it('sections that must agree in count are a finding when they do not', () => {
  const twoFunctions = section(3, vec([[0x00], [0x00]]));
  const oneBody = section(10, vec([[0x02, 0x00, 0x0b]]));
  const mismatch = inspect(moduleOf(TYPE_SECTION, twoFunctions, oneBody));
  expect(mismatch.findings).toHaveLength(1);
  expect(mismatch.findings[0]?.message).toMatch(/function and code section have inconsistent lengths/);
  expect(mismatch.findings[0]?.message).toMatch(/2 functions but the code section holds 1/);
  // Code without any function section, and a function section without any code.
  expect(inspect(moduleOf(TYPE_SECTION, oneBody)).findings).toHaveLength(1);
  expect(inspect(moduleOf(TYPE_SECTION, twoFunctions)).findings).toHaveLength(1);
  // Neither is fine, and so is an empty pair.
  expect(inspect(moduleOf(TYPE_SECTION)).findings).toEqual([]);
  expect(inspect(moduleOf(TYPE_SECTION, section(3, vec([])), section(10, vec([])))).findings).toEqual([]);

  // The data count must be the number of data segments, and a data count with no data section means none.
  const count = (n: number): number[] => section(12, uleb(n));
  expect(inspect(moduleOf(count(1), dataSection([0x61]))).findings).toEqual([]);
  const wrong = inspect(moduleOf(count(2), dataSection([0x61])));
  expect(wrong.findings).toHaveLength(1);
  expect(wrong.findings[0]?.message).toMatch(/data count and data section have inconsistent lengths/);
  expect(inspect(moduleOf(count(0))).findings).toEqual([]);
  expect(inspect(moduleOf(count(1))).findings).toHaveLength(1);
});

it('printable runs of 6 or more bytes in data segments are listed up to 200 within an 8 MiB scan', () => {
  // Runs shorter than 6 are not text; 6 is; a byte that is not printable ends a run; a run never crosses a segment.
  const small = inspect(
    moduleOf(
      dataSection(
        text('abcde'),
        text('abcdef'),
        [...text('first-run'), 0x00, ...text('second-run'), 0x0a, ...text('x')],
        text('tail'),
        text('ab'),
        text('cdefg'),
      ),
    ),
  );
  expect(small.strings.items.map((s) => s.text)).toEqual(['abcdef', 'first-run', 'second-run']);
  expect(small.strings.total).toBe(3);
  expect(small.strings.truncated).toBe(false);
  expect(small.strings.items[0]).toMatchObject({ segment: 1, length: 6 });

  // More than 200: 200 are listed and the rest are counted.
  const many = inspect(moduleOf(dataSection(...Array.from({ length: 300 }, (_, i) => text(`string number ${i}`)))));
  expect(many.strings.items).toHaveLength(MAX_STRINGS);
  expect(many.strings.total).toBe(300);
  expect(many.strings.items[199]?.text).toBe('string number 199');

  // A long run is shown cut at 200 characters, with its true length kept.
  const long = inspect(moduleOf(dataSection(new Array<number>(5000).fill(0x61))));
  expect(long.strings.items[0]?.length).toBe(5000);
  expect(long.strings.items[0]?.text).toHaveLength(201);
  expect(long.strings.items[0]?.text.endsWith('…')).toBe(true);

  // Only 8 MiB of data segments are looked at: text after that is not found, and the report says it stopped. The module is
  // built in a typed array, because three blocks of 5 MiB are too large to build as lists of numbers.
  const blockSize = 5 * 1024 * 1024;
  const block = (word: string): Uint8Array => {
    const bytes = new Uint8Array(blockSize);
    bytes.set(text(word), 100);
    return bytes;
  };
  const blocks = [block('inside-one'), block('inside-two'), block('past-the-end')];
  const header = [11, ...uleb(1 + blocks.length * (1 + uleb(blockSize).length + blockSize)), blocks.length];
  const sectionHead = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...header]);
  const big = new Uint8Array(sectionHead.length + blocks.length * (1 + uleb(blockSize).length + blockSize));
  big.set(sectionHead, 0);
  let at = sectionHead.length;
  for (const one of blocks) {
    big.set([0x01, ...uleb(blockSize)], at);
    at += 1 + uleb(blockSize).length;
    big.set(one, at);
    at += blockSize;
  }
  const budget = inspect(big);
  expect(budget.findings).toEqual([]);
  expect(budget.strings.items.map((s) => s.text)).toEqual(['inside-one', 'inside-two']);
  expect(budget.strings.truncated).toBe(true);
  expect(budget.strings.scanned).toBe(MAX_STRING_SCAN_BYTES);
});

it('the features a module uses are worked out from its sections and function bodies are not decoded', () => {
  const features = (...sections: number[][]): string[] => inspect(moduleOf(...sections)).features;
  expect(features(TYPE_SECTION)).toEqual([]);
  expect(features(section(1, vec([[0x60, 0x01, 0x7b, 0x00]])))).toEqual(['SIMD (v128 values)']);
  expect(features(section(6, vec([[0x7b, 0x00, 0xfd, 0x0c, ...new Array<number>(16).fill(0), 0x0b]])))).toEqual([
    'SIMD (v128 values)',
  ]);
  // An externref table, a second table, and a table with an initialiser are reference types.
  expect(features(section(4, vec([[0x6f, 0x00, 0x01]])))).toEqual(['reference types']);
  expect(
    features(
      section(
        4,
        vec([
          [0x70, 0x00, 0x01],
          [0x70, 0x00, 0x01],
        ]),
      ),
    ),
  ).toEqual(['reference types']);
  expect(features(section(4, vec([[0x40, 0x00, 0x70, 0x00, 0x01, 0xd0, 0x70, 0x0b]])))).toEqual(['reference types']);
  // One funcref table is nothing special.
  expect(features(section(4, vec([[0x70, 0x00, 0x01]])))).toEqual([]);
  // A struct type, and a subtype of another type.
  expect(features(section(1, vec([[0x5f, 0x00]])))).toEqual(['garbage collection types']);
  expect(features(section(1, vec([[0x50, 0x00, 0x60, 0x00, 0x00]])))).toEqual(['garbage collection types']);
  expect(features(section(1, vec([[0x60, 0x00, 0x01, 0x63, 0x00]])))).toEqual(['garbage collection types']);
  // Tags, 64-bit limits, a second memory, the shared flag and the extended constant instructions.
  expect(features(TYPE_SECTION, section(13, vec([[0x00, 0x00]])))).toEqual(['exception handling (tags)']);
  expect(features(section(5, vec([[0x04, 0x01]])))).toEqual(['64-bit memory or table limits']);
  expect(
    features(
      section(
        5,
        vec([
          [0x00, 0x01],
          [0x00, 0x01],
        ]),
      ),
    ),
  ).toEqual(['multiple memories']);
  expect(features(section(5, vec([[0x03, 0x01, 0x02]])))).toEqual(['shared memory (threads proposal)']);
  expect(features(section(6, vec([[0x7f, 0x00, 0x41, 0x01, 0x41, 0x02, 0x6a, 0x0b]])))).toEqual(['extended constants']);
  // Listed in a fixed order whatever the order the sections come in.
  expect(
    features(
      section(
        5,
        vec([
          [0x04, 0x01],
          [0x07, 0x01, 0x02],
        ]),
      ),
      section(13, vec([[0x00, 0x00]])),
    ),
  ).toEqual([
    'exception handling (tags)',
    '64-bit memory or table limits',
    'multiple memories',
    'shared memory (threads proposal)',
  ]);
  // A function body is measured and never decoded: a body full of vector instructions shows no feature.
  const body = [0x00, 0xfd, 0x0c, ...new Array<number>(16).fill(0), 0x0b];
  expect(
    features(TYPE_SECTION, section(3, vec([[0x00]])), section(10, vec([[...uleb(body.length), ...body]]))),
  ).toEqual([]);
});

it('constant expressions are decoded for the forms the specification allows and any other instruction ends that section', () => {
  const globalInit = (...expr: number[]): { init: string | undefined; findings: string[]; count: number } => {
    const report = inspect(moduleOf(section(6, vec([[0x7f, 0x00, ...expr]]))));
    return {
      init: report.globals.rows[0]?.init,
      findings: report.findings.map((f) => f.message),
      count: report.globals.count,
    };
  };
  expect(globalInit(0x41, 0x2a, 0x0b).init).toBe('i32.const 42');
  expect(globalInit(0x41, 0x7f, 0x0b).init).toBe('i32.const -1');
  expect(globalInit(0x42, 0x80, 0x01, 0x0b).init).toBe('i64.const 128');
  expect(globalInit(0x43, 0x00, 0x00, 0xc0, 0x3f, 0x0b).init).toBe('f32.const 1.5');
  expect(globalInit(0x44, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f, 0x0b).init).toBe('f64.const 1.5');
  expect(globalInit(0x23, 0x00, 0x0b).init).toBe('global.get 0');
  expect(globalInit(0xd0, 0x70, 0x0b).init).toBe('ref.null func');
  expect(globalInit(0xd0, 0x03, 0x0b).init).toBe('ref.null 3');
  expect(globalInit(0xd2, 0x05, 0x0b).init).toBe('ref.func 5');
  expect(globalInit(0x23, 0x00, 0x41, 0x08, 0x6a, 0x0b).init).toBe('global.get 0 i32.const 8 i32.add');
  expect(globalInit(0xfb, 0x1c, 0x0b).init).toBe('ref.i31');
  expect(globalInit(0xfb, 0x08, 0x02, 0x03, 0x0b).init).toBe('array.new_fixed 2 3');
  // A long expression keeps its first instructions and counts the rest.
  const long = globalInit(0x41, 0x01, ...new Array<number>(100).fill(0x6a), 0x0b).init ?? '';
  expect(long.startsWith('i32.const 1 i32.add')).toBe(true);
  expect(long.endsWith('and 77 more')).toBe(true);
  // An instruction that is not constant: a finding at its offset, and the global is not listed.
  const bad = globalInit(0x20, 0x00, 0x0b);
  expect(bad.count).toBe(0);
  expect(bad.findings).toHaveLength(1);
  expect(bad.findings[0]).toMatch(/instruction this page does not decode/);
  expect(bad.findings[0]).toContain(`offset ${8 + 2 + 1 + 2}`);
});

it('a name cannot hide: the same rules apply to import, export, custom and name section names', () => {
  const marker = String.fromCodePoint(0x202e);
  const odd = `a${marker}b`;
  const report = inspect(
    moduleOf(
      section(2, vec([[...name(odd), ...name('f'), 0x03, 0x7f, 0x00]])),
      section(7, vec([[...name(odd), 0x00, 0x00]])),
      custom(odd, [1]),
    ),
  );
  // The reader reports the characters as they are; the page shows them through the escape routine.
  expect(report.imports.rows[0]?.module).toBe(odd);
  expect(report.exports.rows[0]?.name).toBe(odd);
  expect(report.customs.rows[0]?.name).toBe(odd);
  // Names are UTF-8 by their byte length, so a name cut in the middle of a character is refused at the name.
  const cutName = inspect(moduleOf(section(7, vec([[0x02, 0xe2, 0x82, 0x00, 0x00]]))));
  expect(cutName.findings.some((f) => /malformed UTF-8 encoding/.test(f.message))).toBe(true);
});
