/** Small builders for the bytes of modules, so a test can state a module section by section. */

export const HEADER: readonly number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** An unsigned LEB128 number in its shortest form. */
export function uleb(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return out;
}

/** A name: its byte length and its UTF-8 bytes. */
export function name(text: string): number[] {
  const raw = new TextEncoder().encode(text);
  return [...uleb(raw.length), ...raw];
}

/** A vector: the number of items and the items. */
export function vec(items: readonly (readonly number[])[]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

/** A section: its id, the size of its content and the content. */
export function section(id: number, ...content: (readonly number[])[]): number[] {
  const body = content.flat();
  return [id, ...uleb(body.length), ...body];
}

/** A custom section with a name and a payload. */
export function custom(sectionName: string, ...payload: (readonly number[])[]): number[] {
  return section(0, name(sectionName), ...payload);
}

/** The bytes of a module: the header and the sections, in the order given. */
export function moduleOf(...sections: (readonly number[])[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([...HEADER, ...sections.flat()]);
}

/** The bytes of a hex string (spaces and line breaks allowed). */
export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('not hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A small seeded generator (mulberry32), so every run of a test sees the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The text of a latin1 string as bytes: each character is one byte. */
export function bytesOfLatin1(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** The empty function type `() -> ()` as a type section: one type, no parameters, no results. */
export const TYPE_SECTION_EMPTY_FUNC: readonly number[] = section(1, vec([[0x60, 0x00, 0x00]]));
