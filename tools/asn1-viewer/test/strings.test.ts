import { expect, it } from 'vitest';
import { describeBytes } from '../src/index';
import { der, fromHex, nodeAt, problemsOf } from './helpers';

/*
 * Constructed strings nested in constructed strings (X.690 clauses 8.7.3 and 8.23.6). The value of a constructed string is
 * every segment below it put end to end; the outermost string shows it, so the bytes are joined once however deep the
 * nesting goes. A file of 38 levels around one string is timed against one level around the same string (median of 5
 * samples, the median of three when the first reading is over); a ratio over 4 fails, and the limit is never raised.
 */

/** A primitive OCTET STRING of `size` printable bytes inside `levels` constructed OCTET STRINGs, with definite lengths. */
function nested(levels: number, size: number): Uint8Array {
  const lengthOctets = (length: number): number[] => {
    if (length < 128) return [length];
    const octets: number[] = [];
    for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) octets.unshift(rest % 256);
    return [0x80 | octets.length, ...octets];
  };
  const heads: number[][] = [];
  let length = 1 + lengthOctets(size).length + size;
  heads.push([0x04, ...lengthOctets(size)]);
  for (let i = 0; i < levels; i++) {
    const head = [0x24, ...lengthOctets(length)];
    heads.push(head);
    length += head.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (let i = heads.length - 1; i >= 0; i--) {
    out.set(heads[i]!, at);
    at += heads[i]!.length;
  }
  out.fill(0x61, at);
  return out;
}

function time(bytes: Uint8Array, reps: number): number {
  const start = performance.now();
  for (let i = 0; i < reps; i++) describeBytes(bytes);
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** How many times longer describing `deep` takes than describing `shallow`, each the median of 5 samples of at least 2 ms. */
function costRatio(deep: Uint8Array, shallow: Uint8Array): number {
  time(deep, 1);
  time(shallow, 1);
  const reps = Math.min(200, Math.max(1, Math.ceil(2 / Math.max(time(shallow, 1), 0.001))));
  const samples = (bytes: Uint8Array): number => {
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) timings.push(time(bytes, reps));
    return median(timings);
  };
  const a = samples(shallow);
  const b = samples(deep);
  return b / Math.max(a, 0.0005);
}

it('38 constructed strings nested around one string cost about what one level costs', () => {
  const size = 262_144;
  const deep = nested(38, size);
  const shallow = nested(1, size);
  // Both read completely, and the outermost string shows the whole value in both.
  for (const bytes of [deep, shallow]) {
    const result = describeBytes(bytes);
    expect(problemsOf(result)).toEqual([]);
    expect(result.nodes[0]!.value!.text).toContain(`(${size.toLocaleString('en-US')} bytes)`);
  }
  const limit = 4;
  let ratio = costRatio(deep, shallow);
  if (ratio > limit) ratio = [ratio, costRatio(deep, shallow), costRatio(deep, shallow)].sort((a, b) => a - b)[1]!;
  expect(ratio, `38 levels took ${ratio.toFixed(1)} times as long as one`).toBeLessThanOrEqual(limit);
}, 180_000);

it('the outermost constructed string shows the joined value and a string inside it points there', () => {
  // 24 0e [ 24 0a [ 04 03 "abc" 04 03 "def" ] 04 00 ]: the outer string holds an inner constructed string and an empty one.
  const inner = der(0x24, [...der(0x04, [0x61, 0x62, 0x63]), ...der(0x04, [0x64, 0x65, 0x66])]);
  const bytes = new Uint8Array(der(0x24, [...inner, 0x04, 0x00]));
  const result = describeBytes(bytes);
  expect(problemsOf(result)).toEqual([]);
  expect(nodeAt(result, 0).value!.text).toBe('616263646566 = "abcdef"');
  expect(nodeAt(result, 0).value!.string).toBe('abcdef');
  expect(nodeAt(result, 2).value!.text).toBe(
    'part of the constructed string that holds it, whose value is shown there',
  );
  expect(nodeAt(result, 2).value!.problems).toEqual([]);

  // A segment of the wrong kind inside the inner string is one problem, found by the outermost string, not one per level.
  const wrong = describeBytes(
    new Uint8Array(der(0x24, der(0x24, der(0x24, [...der(0x04, [0x61]), ...der(0x02, [0x01])])))),
  );
  expect(problemsOf(wrong).map((finding) => finding.message)).toEqual([
    'At offset 0: A segment of a constructed string is not an OCTET STRING (X.690 clauses 8.7.3.2 and 8.23.6).',
  ]);

  // A constructed BIT STRING inside one: the outer joins the bits once, with the unused bits of the last segment.
  const bits = describeBytes(fromHex('230a' + '2308' + '030200aa' + '030204f0'));
  expect(problemsOf(bits)).toEqual([]);
  expect(nodeAt(bits, 0).value!.text).toBe(nodeAt(describeBytes(fromHex('2308030200aa030204f0')), 0).value!.text);
  expect(nodeAt(bits, 2).value!.text).toBe('part of the constructed string that holds it, whose value is shown there');
});
