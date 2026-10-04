/**
 * The shared rejection sampler and the byte reader of the newer modes (dice, coin flips, lottery draws and list picks).
 *
 * `drawUniformInt` is the sampler the integer and decimal modes have always used, moved here unchanged so the newer
 * modes can use the very same one. Every draw of a newer mode goes through it, over bytes from the browser's
 * cryptographic source, so no outcome is favoured.
 */

/** A problem with a coin, lottery or list request, or a test byte sequence that ran out. */
export class RandomDrawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RandomDrawError';
  }
}

/**
 * Draws a uniform integer in [0, span) by rejection sampling.
 *
 * A modulo of a random word (`randomByte % span`) is the tempting shortcut,
 * and it is biased whenever `span` does not divide the word size evenly: the
 * values below the remainder of that division come up more often than the
 * values above it. For a 3-value range over a single byte, modulo gives
 * 86/256, 85/256 and 85/256 -- a bias too small to catch reliably in a
 * sample-count test at any size that does not flake, but real all the same.
 *
 * Rejection sampling removes it instead: compute the largest multiple of
 * `span` that fits in the drawn word size, discard any draw that lands above
 * it (the incomplete final block), and redraw. Every value that survives is
 * then exactly uniform.
 */
export function drawUniformInt(span: number, readByte: () => number): number {
  if (span <= 1) return 0;

  let bytesNeeded = 1;
  let wordSize = 256;
  while (wordSize < span) {
    bytesNeeded++;
    wordSize *= 256;
  }
  const maxValid = Math.floor(wordSize / span) * span - 1;

  for (;;) {
    let value = 0;
    for (let i = 0; i < bytesNeeded; i++) value = value * 256 + readByte();
    if (value <= maxValid) return value % span;
  }
}

/**
 * The byte reader of the newer modes: one byte at a time from `crypto.getRandomValues`, and from nowhere else.
 *
 * Testing only: a `byteSource` replaces the cryptographic source with a fixed sequence, consumed in order, so the
 * rejection path can be proven by hand-worked bytes. The page never passes one.
 */
export function newModeByteReader(byteSource?: number[]): () => number {
  if (byteSource) {
    let i = 0;
    return () => {
      if (i >= byteSource.length) {
        throw new RandomDrawError('The supplied test byte sequence ran out before generation finished.');
      }
      return byteSource[i++]!;
    };
  }
  return () => {
    const out = new Uint8Array(1);
    globalThis.crypto.getRandomValues(out);
    return out[0]!;
  };
}
