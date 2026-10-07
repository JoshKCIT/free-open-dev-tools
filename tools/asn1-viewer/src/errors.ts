/**
 * The one error this package throws. It is for input the reader cannot start on: a paste or file over its size limit,
 * text that is not PEM, Base64 or hex, or nothing at all. A fault inside the structure itself is a finding, never a throw.
 *
 * RULE, stated once and enforced by a test: no message may repeat the input. A message names a position or an offset and
 * the rule that was broken, and at most 40 characters of a PEM label.
 */
export class Asn1Error extends Error {
  /** Where the input came from, so a sentence can say `paste` or `file`. */
  readonly part: 'input' | 'file';
  /** Position in the text, or offset in the bytes, where the problem was found, when there is one. */
  readonly offset?: number;
  constructor(message: string, part: 'input' | 'file' = 'input', offset?: number) {
    super(message);
    this.name = 'Asn1Error';
    this.part = part;
    if (offset !== undefined) this.offset = offset;
  }
}
