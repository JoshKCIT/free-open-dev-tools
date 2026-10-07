import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_CHARSTRING_STEPS, MAX_SUBR_DEPTH } from './limits';
import { emptyDrawing, type Contour, type GlyphDrawing, type Pt } from './outline';
import { tableBytes, type SfntFont } from './sfnt';
import { CFF_STANDARD_STRINGS } from './standard-names';
import type { GlyphSource } from './glyf';

/** The most numbers a charstring may hold on its stack (the CFF2 limit; Type 2 charstrings in CFF 1 allow 48). */
const MAX_STACK = 513;

export interface CffSource extends GlyphSource {
  /** The glyph's name from the charset, or '' when the font has none for it. */
  glyphName(gid: number): string;
  /** True for a CID-keyed font, whose charset holds character identifiers and not names. */
  cidKeyed: boolean;
}

/** One INDEX of the Compact Font Format: a count, an offset size, count + 1 offsets and the objects they delimit. */
class CffIndex {
  readonly count: number;
  readonly end: number;
  private readonly r: ByteReader;
  private readonly at: number;
  private readonly offSize: number;
  private readonly base: number;

  constructor(r: ByteReader, at: number) {
    this.r = r;
    this.at = at;
    this.count = r.u16(at);
    if (this.count === 0) {
      this.offSize = 0;
      this.base = 0;
      this.end = at + 2;
      return;
    }
    this.offSize = r.u8(at + 2);
    if (this.offSize < 1 || this.offSize > 4)
      throw new FontInspectorError('A CFF index uses an offset size the format does not allow.', undefined, at + 2);
    // Compare the count with the bytes that remain before any offset is used.
    if (!r.has(at + 3, (this.count + 1) * this.offSize)) {
      throw new FontInspectorError('A CFF index states more objects than it has room for.', undefined, at);
    }
    this.base = at + 3 + (this.count + 1) * this.offSize - 1;
    this.end = this.base + this.offset(this.count);
  }

  private offset(i: number): number {
    let v = 0;
    const p = this.at + 3 + i * this.offSize;
    for (let k = 0; k < this.offSize; k++) v = v * 256 + this.r.u8(p + k);
    return v;
  }

  /** The [start, end) byte range of object i, or null when the offsets are not usable. */
  item(i: number): [number, number] | null {
    if (i < 0 || i >= this.count) return null;
    const start = this.offset(i);
    const end = this.offset(i + 1);
    if (start < 1 || end < start || !this.r.has(this.base + start, end - start)) return null;
    return [this.base + start, this.base + end];
  }
}

/** A CFF DICT: operators with their operands. Two-byte operators (12 n) are stored as 1200 + n. */
function readDict(r: ByteReader, start: number, end: number): Map<number, number[]> {
  const dict = new Map<number, number[]>();
  let operands: number[] = [];
  let p = start;
  while (p < end) {
    const b = r.u8(p);
    if (b <= 21) {
      let op = b;
      p++;
      if (b === 12) {
        op = 1200 + r.u8(p);
        p++;
      }
      dict.set(op, operands);
      operands = [];
    } else if (b === 28) {
      operands.push(r.i16(p + 1));
      p += 3;
    } else if (b === 29) {
      operands.push(r.i32(p + 1));
      p += 5;
    } else if (b === 30) {
      // A real number in nibbles; its value is never needed here, only its length.
      p++;
      for (;;) {
        const byte = r.u8(p++);
        if ((byte & 0x0f) === 0x0f || byte >> 4 === 0x0f) break;
      }
      operands.push(0);
    } else if (b >= 32 && b <= 246) {
      operands.push(b - 139);
      p++;
    } else if (b >= 247 && b <= 250) {
      operands.push((b - 247) * 256 + r.u8(p + 1) + 108);
      p += 2;
    } else if (b >= 251 && b <= 254) {
      operands.push(-(b - 251) * 256 - r.u8(p + 1) - 108);
      p += 2;
    } else {
      p++;
    }
    if (operands.length > 48) operands = operands.slice(-48);
  }
  return dict;
}

const bias = (count: number): number => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768);

/** Raised inside the interpreter to stop a glyph at a cap; caught at the top of `draw`. */
class Stop extends Error {}

/**
 * Opens the CFF table (Compact Font Format 1) for drawing. Type 2 charstrings are run by an interpreter that draws lines and
 * cubic curves, follows local and global subroutines to depth 10, and stops a glyph after 200,000 operations; whatever it
 * drew is kept and the drawing is flagged. Variable CFF2 outlines are not read.
 */
export function openCff(bytes: Uint8Array, font: SfntFont, numGlyphs: number): CffSource | null {
  const data = tableBytes(bytes, font.tables.get('CFF '));
  if (!data || data.length < 4) return null;
  const r = new ByteReader(data);
  if (r.u8(0) !== 1) return null;
  const headerSize = r.u8(2);

  let strings: CffIndex;
  let globalSubrs: CffIndex;
  let charStrings: CffIndex;
  let top: Map<number, number[]>;
  try {
    const names = new CffIndex(r, headerSize);
    const tops = new CffIndex(r, names.end);
    strings = new CffIndex(r, tops.end);
    globalSubrs = new CffIndex(r, strings.end);
    const topRange = tops.item(0);
    if (!topRange) return null;
    top = readDict(r, topRange[0], topRange[1]);
    const csOffset = top.get(17)?.[0];
    if (csOffset === undefined) return null;
    charStrings = new CffIndex(r, csOffset);
  } catch (err) {
    if (err instanceof FontInspectorError) return null;
    throw err;
  }

  // Private DICTs: one for a name-keyed font, one per font DICT for a CID-keyed font.
  const cidKeyed = top.has(1230);
  interface PrivateInfo {
    subrs: CffIndex | null;
    defaultWidth: number;
    nominalWidth: number;
  }
  const readPrivate = (dict: Map<number, number[]>): PrivateInfo => {
    const info: PrivateInfo = { subrs: null, defaultWidth: 0, nominalWidth: 0 };
    const spec = dict.get(18);
    if (!spec || spec.length < 2) return info;
    const size = spec[0]!;
    const offset = spec[1]!;
    if (!r.has(offset, size)) return info;
    const priv = readDict(r, offset, offset + size);
    info.defaultWidth = priv.get(20)?.[0] ?? 0;
    info.nominalWidth = priv.get(21)?.[0] ?? 0;
    const subrsAt = priv.get(19)?.[0];
    if (subrsAt !== undefined) {
      try {
        info.subrs = new CffIndex(r, offset + subrsAt);
      } catch (err) {
        if (!(err instanceof FontInspectorError)) throw err;
      }
    }
    return info;
  };
  const privates: PrivateInfo[] = [];
  let fdSelect: ((gid: number) => number) | null = null;
  try {
    if (cidKeyed) {
      const fdArrayAt = top.get(1236)?.[0];
      if (fdArrayAt !== undefined) {
        const fds = new CffIndex(r, fdArrayAt);
        for (let i = 0; i < Math.min(fds.count, 256); i++) {
          const range = fds.item(i);
          privates.push(
            range ? readPrivate(readDict(r, range[0], range[1])) : { subrs: null, defaultWidth: 0, nominalWidth: 0 },
          );
        }
      }
      const selectAt = top.get(1237)?.[0];
      if (selectAt !== undefined) {
        const format = r.u8(selectAt);
        if (format === 0) {
          fdSelect = (gid) => (gid < numGlyphs && r.has(selectAt + 1 + gid, 1) ? r.u8(selectAt + 1 + gid) : 0);
        } else if (format === 3) {
          const ranges = r.u16(selectAt + 1);
          const room = Math.min(ranges, Math.floor((data.length - selectAt - 5) / 3));
          fdSelect = (gid) => {
            // Binary search over the ranges: each is [first glyph, font DICT], and the next range's first glyph ends it.
            let lo = 0;
            let hi = room - 1;
            let found = 0;
            while (lo <= hi) {
              const m = (lo + hi) >> 1;
              const first = r.u16(selectAt + 3 + 3 * m);
              if (first <= gid) {
                found = r.u8(selectAt + 3 + 3 * m + 2);
                lo = m + 1;
              } else {
                hi = m - 1;
              }
            }
            return found;
          };
        }
      }
    } else {
      privates.push(readPrivate(top));
    }
  } catch (err) {
    if (!(err instanceof FontInspectorError)) throw err;
  }
  const privateFor = (gid: number): PrivateInfo => {
    if (!cidKeyed) return privates[0] ?? { subrs: null, defaultWidth: 0, nominalWidth: 0 };
    const fd = fdSelect ? fdSelect(gid) : 0;
    return privates[fd] ?? privates[0] ?? { subrs: null, defaultWidth: 0, nominalWidth: 0 };
  };

  // Charset: the string identifier (or character identifier) of each glyph.
  const sids = new Uint16Array(numGlyphs);
  const charsetAt = top.get(15)?.[0] ?? 0;
  try {
    if (charsetAt === 0) {
      for (let g = 0; g < numGlyphs; g++) sids[g] = g <= 228 ? g : 0;
    } else if (charsetAt > 2 && r.has(charsetAt, 1)) {
      const format = r.u8(charsetAt);
      let p = charsetAt + 1;
      let g = 1;
      if (format === 0) {
        for (; g < numGlyphs && r.has(p, 2); g++, p += 2) sids[g] = r.u16(p);
      } else if (format === 1 || format === 2) {
        const step = format === 1 ? 3 : 4;
        while (g < numGlyphs && r.has(p, step)) {
          const first = r.u16(p);
          const left = format === 1 ? r.u8(p + 2) : r.u16(p + 2);
          for (let k = 0; k <= left && g < numGlyphs; k++, g++) sids[g] = (first + k) & 0xffff;
          p += step;
        }
      }
    }
  } catch (err) {
    if (!(err instanceof FontInspectorError)) throw err;
  }

  const stringAt = (sid: number): string => {
    if (sid < CFF_STANDARD_STRINGS.length) return CFF_STANDARD_STRINGS[sid] ?? '';
    const range = strings.item(sid - CFF_STANDARD_STRINGS.length);
    if (!range) return '';
    const length = Math.min(range[1] - range[0], 64);
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(r.u8(range[0] + i));
    return out;
  };

  function run(gid: number, state: { contours: Contour[]; truncated: boolean; segments: number }): void {
    const range = charStrings.item(gid);
    if (!range) throw new FontInspectorError('A glyph lies outside the CFF table.');
    const info = privateFor(gid);
    let stack: number[] = [];
    let x = 0;
    let y = 0;
    let stems = 0;
    let widthSeen = false;
    let steps = 0;
    let current: Contour | null = null;
    let start: Pt = [0, 0];
    const close = (): void => {
      if (current && current.length > 0) {
        if (x !== start[0] || y !== start[1]) current.push(['L', [x, y], [start[0], start[1]]]);
        state.contours.push(current);
      }
      current = null;
    };
    const ensure = (): Contour => {
      if (!current) {
        current = [];
        start = [x, y];
      }
      return current;
    };
    const moveTo = (dx: number, dy: number): void => {
      close();
      x += dx;
      y += dy;
      start = [x, y];
      current = [];
    };
    const lineTo = (dx: number, dy: number): void => {
      const contour = ensure();
      const from: Pt = [x, y];
      x += dx;
      y += dy;
      contour.push(['L', from, [x, y]]);
      state.segments++;
    };
    const curveTo = (a: number, b: number, c: number, d: number, e: number, f: number): void => {
      const contour = ensure();
      const p0: Pt = [x, y];
      const p1: Pt = [x + a, y + b];
      const p2: Pt = [p1[0] + c, p1[1] + d];
      x = p2[0] + e;
      y = p2[1] + f;
      contour.push(['C', p0, p1, p2, [x, y]]);
      state.segments++;
    };
    // The first stack-clearing operator may carry the glyph's width as an extra first number.
    const takeWidth = (expected: number | null): void => {
      if (widthSeen) return;
      widthSeen = true;
      if (expected === null ? stack.length % 2 === 1 : stack.length > expected) stack.shift();
    };
    const at = (i: number): number => stack[i] ?? 0;

    const exec = (from: number, to: number, depth: number): boolean => {
      let p = from;
      while (p < to) {
        if (++steps > MAX_CHARSTRING_STEPS) {
          state.truncated = true;
          throw new Stop();
        }
        const v = r.u8(p++);
        if (v >= 32 || v === 28) {
          if (stack.length >= MAX_STACK) {
            state.truncated = true;
            throw new Stop();
          }
          if (v === 28) {
            stack.push(r.i16(p));
            p += 2;
          } else if (v <= 246) {
            stack.push(v - 139);
          } else if (v <= 250) {
            stack.push((v - 247) * 256 + r.u8(p++) + 108);
          } else if (v <= 254) {
            stack.push(-(v - 251) * 256 - r.u8(p++) - 108);
          } else {
            stack.push(r.i32(p) / 65536);
            p += 4;
          }
          continue;
        }
        switch (v) {
          case 1:
          case 3:
          case 18:
          case 23:
            takeWidth(null);
            stems += stack.length >> 1;
            stack = [];
            break;
          case 19:
          case 20:
            takeWidth(null);
            stems += stack.length >> 1;
            stack = [];
            p += (stems + 7) >> 3;
            break;
          case 21:
            takeWidth(2);
            moveTo(at(0), at(1));
            stack = [];
            break;
          case 22:
            takeWidth(1);
            moveTo(at(0), 0);
            stack = [];
            break;
          case 4:
            takeWidth(1);
            moveTo(0, at(0));
            stack = [];
            break;
          case 5:
            for (let i = 0; i + 1 < stack.length; i += 2) lineTo(stack[i]!, stack[i + 1]!);
            stack = [];
            break;
          case 6:
          case 7: {
            let horizontal = v === 6;
            for (const delta of stack) {
              if (horizontal) lineTo(delta, 0);
              else lineTo(0, delta);
              horizontal = !horizontal;
            }
            stack = [];
            break;
          }
          case 8:
            for (let i = 0; i + 5 < stack.length; i += 6)
              curveTo(at(i), at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5));
            stack = [];
            break;
          case 24: {
            let i = 0;
            for (; i + 7 < stack.length; i += 6) curveTo(at(i), at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5));
            lineTo(at(i), at(i + 1));
            stack = [];
            break;
          }
          case 25: {
            let i = 0;
            for (; i + 7 < stack.length; i += 2) lineTo(at(i), at(i + 1));
            curveTo(at(i), at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5));
            stack = [];
            break;
          }
          case 26: {
            let i = 0;
            let dx1 = 0;
            if (stack.length % 2 === 1) dx1 = at(i++);
            for (; i + 3 < stack.length; i += 4) {
              curveTo(dx1, at(i), at(i + 1), at(i + 2), 0, at(i + 3));
              dx1 = 0;
            }
            stack = [];
            break;
          }
          case 27: {
            let i = 0;
            let dy1 = 0;
            if (stack.length % 2 === 1) dy1 = at(i++);
            for (; i + 3 < stack.length; i += 4) {
              curveTo(at(i), dy1, at(i + 1), at(i + 2), at(i + 3), 0);
              dy1 = 0;
            }
            stack = [];
            break;
          }
          case 30:
          case 31: {
            let horizontal = v === 31;
            let i = 0;
            while (i + 3 < stack.length) {
              const last = stack.length - i === 5 ? at(i + 4) : 0;
              if (horizontal) curveTo(at(i), 0, at(i + 1), at(i + 2), last, at(i + 3));
              else curveTo(0, at(i), at(i + 1), at(i + 2), at(i + 3), last);
              horizontal = !horizontal;
              i += 4;
            }
            stack = [];
            break;
          }
          case 10:
          case 29: {
            const index = v === 10 ? info.subrs : globalSubrs;
            const operand = stack.pop();
            if (depth >= MAX_SUBR_DEPTH) {
              state.truncated = true;
              throw new Stop();
            }
            if (index && operand !== undefined) {
              const target = index.item(operand + bias(index.count));
              if (target && exec(target[0], target[1], depth + 1)) return true;
            }
            break;
          }
          case 11:
            return false;
          case 14:
            takeWidth(0 + (stack.length === 1 || stack.length === 5 ? 0 : stack.length));
            close();
            return true;
          case 12: {
            const op = r.u8(p++);
            if (op === 35) {
              curveTo(at(0), at(1), at(2), at(3), at(4), at(5));
              curveTo(at(6), at(7), at(8), at(9), at(10), at(11));
            } else if (op === 34) {
              curveTo(at(0), 0, at(1), at(2), at(3), 0);
              curveTo(at(4), 0, at(5), -at(2), at(6), 0);
            } else if (op === 36) {
              curveTo(at(0), at(1), at(2), at(3), at(4), 0);
              curveTo(at(5), 0, at(6), at(7), at(8), -(at(1) + at(3) + at(7)));
            } else if (op === 37) {
              const dx = at(0) + at(2) + at(4) + at(6) + at(8);
              const dy = at(1) + at(3) + at(5) + at(7) + at(9);
              curveTo(at(0), at(1), at(2), at(3), at(4), at(5));
              if (Math.abs(dx) > Math.abs(dy)) curveTo(at(6), at(7), at(8), at(9), at(10), -dy);
              else curveTo(at(6), at(7), at(8), at(9), -dx, at(10));
            } else if (op === 18) {
              stack.pop();
              break;
            } else if (op === 10 && stack.length >= 2) {
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(a + b);
              break;
            } else if (op === 11 && stack.length >= 2) {
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(a - b);
              break;
            } else if (op === 12 && stack.length >= 2) {
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(b === 0 ? 0 : a / b);
              break;
            } else if (op === 14 && stack.length >= 1) {
              stack.push(-stack.pop()!);
              break;
            } else if (op === 24 && stack.length >= 2) {
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(a * b);
              break;
            } else if (op === 9 && stack.length >= 1) {
              stack.push(Math.abs(stack.pop()!));
              break;
            } else if (op === 27 && stack.length >= 1) {
              stack.push(stack[stack.length - 1]!);
              break;
            } else if (op === 28 && stack.length >= 2) {
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(b, a);
              break;
            } else {
              stack = [];
              break;
            }
            stack = [];
            break;
          }
          default:
            stack = [];
        }
      }
      return false;
    };

    try {
      exec(range[0], range[1], 0);
    } finally {
      close();
    }
  }

  return {
    count: numGlyphs,
    cidKeyed,
    glyphName(gid: number): string {
      if (gid < 0 || gid >= numGlyphs) return '';
      if (cidKeyed) return gid === 0 ? '.notdef' : `cid${sids[gid]}`;
      return stringAt(sids[gid]!);
    },
    draw(gid: number): GlyphDrawing {
      if (!Number.isInteger(gid) || gid < 0 || gid >= numGlyphs) return emptyDrawing();
      const state = { contours: [] as Contour[], truncated: false, segments: 0 };
      try {
        run(gid, state);
      } catch (err) {
        if (err instanceof Stop) {
          return { contours: state.contours, truncated: true, unreadable: false, points: state.segments };
        }
        if (err instanceof FontInspectorError) {
          return {
            contours: state.contours,
            truncated: state.truncated,
            unreadable: state.contours.length === 0,
            points: state.segments,
          };
        }
        throw err;
      }
      return { contours: state.contours, truncated: state.truncated, unreadable: false, points: state.segments };
    },
  };
}
