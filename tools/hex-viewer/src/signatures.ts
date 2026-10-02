/**
 * The signature table: for each file format, the bytes a file of that format begins (or, for a few, ends) with, and the
 * address of the specification that states them. A signature is a hint, never a check of the whole file.
 *
 * `offset` counts bytes from the start of the file; with `fromEnd` it counts back from the end, so offset 0 means the
 * last bytes of the file. A signature matches when every one of its parts matches.
 */
export interface SignaturePart {
  readonly offset: number;
  readonly bytes: readonly number[];
  readonly fromEnd?: boolean;
}

export interface Signature {
  readonly name: string;
  readonly parts: readonly SignaturePart[];
  readonly spec: string;
}

export const SIGNATURES: readonly Signature[] = [
  {
    // W3C PNG (Third Edition), 5.2 PNG signature: "The first eight bytes of a PNG datastream always contain the
    // following hexadecimal values: 89 50 4E 47 0D 0A 1A 0A".
    name: 'PNG image',
    parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    spec: 'https://www.w3.org/TR/png-3/',
  },
];
