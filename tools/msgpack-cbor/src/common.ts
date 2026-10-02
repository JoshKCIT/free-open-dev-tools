/** Input can be up to this many bytes (5 MiB); anything larger is refused before it is decoded. */
export const MAX_INPUT_BYTES = 5242880;
/** Arrays, maps and tags may nest this deep; one level deeper is refused with its byte offset. */
export const MAX_DEPTH = 256;

/**
 * Raised, with a plain message, for every expected failure: input that is not hex or Base64, bytes that are not valid
 * MessagePack or CBOR, JSON that cannot be written as either, and anything over a limit. `offset` is the byte offset in
 * the binary data a refusal is about (counted from 0), `path` says where in the value it happened, such as `$[2].a`.
 */
export class MsgpackCborError extends Error {
  readonly offset?: number;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { offset?: number; path?: string; line?: number; column?: number } = {}) {
    super(message);
    this.name = 'MsgpackCborError';
    if (detail.offset !== undefined) this.offset = detail.offset;
    if (detail.path !== undefined) this.path = detail.path;
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

/** Formats a size the way the refusal sentences quote it. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units: [string, number][] = [
    ['MiB', 1048576],
    ['KiB', 1024],
  ];
  for (const [name, size] of units) {
    if (bytes >= size) return `${(bytes / size).toFixed(1)} ${name} (${bytes.toLocaleString('en-US')} bytes)`;
  }
  return `${bytes} bytes`;
}

/** The refusal for input over the limit, raised before any byte of it is decoded. */
export function tooLarge(bytes: number, what = 'The input'): MsgpackCborError {
  return new MsgpackCborError(
    `${what} is ${sizeWords(bytes)}. The limit is 5 MiB because the whole value is held in the page while it is converted.`,
  );
}
