import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildManifest, manifestToJson } from '../src/index';

// Every character below is built from its code point at run time, so no editor or file tool can turn it into something else.
const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** DEL and the C1 controls, the Arabic letter mark, the two direction marks, the two separators, every embedding, override and isolate control, and the byte order mark. */
const POINTS: number[] = [];
for (let point = 0x7f; point <= 0x9f; point++) POINTS.push(point);
POINTS.push(0x61c, 0x200e, 0x200f, 0x2028, 0x2029);
for (let point = 0x202a; point <= 0x202e; point++) POINTS.push(point);
for (let point = 0x2066; point <= 0x2069; point++) POINTS.push(point);
POINTS.push(0xfeff);

const BS = String.fromCharCode(92);

/** A backslash, the letter u and four lower-case hex digits: how JSON spells a character by its code point. */
function jsonEscape(point: number): string {
  return BS + 'u' + point.toString(16).padStart(4, '0');
}

it('the manifest JSON shows direction controls, DEL and the C1 controls as JSON escapes and still parses to the same text', () => {
  expect(POINTS).toHaveLength(0x9f - 0x7f + 1 + 5 + 5 + 4 + 1);
  for (const point of POINTS) {
    const c = String.fromCodePoint(point);
    const manifest = buildManifest({
      name: `a${c}b`,
      startUrl: `/x${c}y`,
      scope: `/s${c}/`,
      lang: `en${c}`,
      icons: [[`i${c}.png`, '', '', '']],
      shortcuts: [[`n${c}`, `/u${c}`]],
    });
    const json = manifestToJson(manifest);
    expect(json.includes(c), `raw ${point.toString(16)} in the JSON`).toBe(false);
    expect(json, point.toString(16)).toContain(jsonEscape(point));
    // Still valid JSON that gives back exactly the text that was typed.
    expect(JSON.parse(json), point.toString(16)).toEqual(manifest);
  }
  // A right-to-left override typed into the start address is not raw in the copied text.
  const override = String.fromCodePoint(0x202e);
  const disguised = manifestToJson(buildManifest({ startUrl: `/app${override}txt.exe` }));
  expect(disguised).toContain(`"start_url": "/app${jsonEscape(0x202e)}txt.exe"`);
});

it('characters outside that list, and text that already holds a backslash, are written as JSON.stringify writes them', () => {
  const plain = [0xe9, 0x4e2d, 0x1f600, 0xa0, 0x200b, 0x2060, 0x20]
    .map((point) => String.fromCodePoint(point))
    .join('');
  const manifest = buildManifest({ name: `${plain}${BS}u202e${BS}n` });
  const json = manifestToJson(manifest);
  expect(json).toBe(JSON.stringify(manifest, null, 2));
  expect(JSON.parse(json)).toEqual(manifest);
  // The control characters JSON.stringify already escapes are unchanged, and a lone surrogate is still escaped by it.
  const lone = String.fromCharCode(0xd800);
  const escaped = manifestToJson({ name: `a${String.fromCharCode(1)}${lone}b` });
  expect(escaped).toBe(JSON.stringify({ name: `a${String.fromCharCode(1)}${lone}b` }, null, 2));
  expect(escaped.includes(lone)).toBe(false);
});
