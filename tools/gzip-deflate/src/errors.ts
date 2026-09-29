export type GzipDeflateErrorKind = 'input' | 'container' | 'checksum' | 'truncated' | 'corrupt' | 'output-cap';

export class GzipDeflateError extends Error {
  readonly kind: GzipDeflateErrorKind;
  /** Index into the pasted text where the problem was found (input errors only). */
  readonly position?: number;
  /** How many bytes had already been produced when the output cap was hit (output-cap only). */
  readonly producedBytes?: number;
  constructor(kind: GzipDeflateErrorKind, message: string, extra?: { position?: number; producedBytes?: number }) {
    super(message);
    this.name = 'GzipDeflateError';
    this.kind = kind;
    this.position = extra?.position;
    this.producedBytes = extra?.producedBytes;
  }
}
