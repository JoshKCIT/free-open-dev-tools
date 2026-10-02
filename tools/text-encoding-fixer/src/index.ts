import meta from './meta.json';
import { encodeWindows1252 } from './windows-1252';

export { meta };

/** The most bytes read, in a file or in pasted hex: 20 MiB. */
export const MAX_INPUT_BYTES = 20971520;

/** A problem with what the visitor gave. `position` counts characters (code points) from 1 where one applies. */
export class TextEncodingFixerError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'TextEncodingFixerError';
    if (position !== undefined) this.position = position;
  }
}

export type RepairFrom = 'windows-1252' | 'iso-8859-1';

export interface RepairResult {
  text: string;
  changed: boolean;
  unrepairedLines: number[];
}

/** Writes each character as the byte the chosen encoding gives it; a character with no byte there is reported. */
function toBytes(text: string, from: RepairFrom): { bytes: Uint8Array; badPosition?: number } {
  if (from === 'windows-1252') return encodeWindows1252(text);
  const bytes = new Uint8Array(text.length);
  let written = 0;
  let position = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) return { bytes: bytes.slice(0, written), badPosition: position };
    bytes[written++] = codePoint;
    position++;
  }
  return { bytes: bytes.slice(0, written) };
}

/**
 * Repairs text where UTF-8 bytes were read as windows-1252 (or as ISO-8859-1): every character is written back as the
 * byte it came from, and the bytes are read as UTF-8, so cafÃ© becomes café.
 */
export function repairMojibake(text: string, from: RepairFrom, options: { perLine: boolean }): RepairResult {
  void options;
  const { bytes, badPosition } = toBytes(text, from);
  if (badPosition !== undefined) {
    throw new TextEncodingFixerError(
      'That character cannot come from a UTF-8 text read as ' + from + ', so the text cannot be repaired.',
      badPosition + 1,
    );
  }
  let repaired: string;
  try {
    repaired = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TextEncodingFixerError('The bytes behind this text are not UTF-8, so the text cannot be repaired.');
  }
  return { text: repaired, changed: repaired !== text, unrepairedLines: [] };
}
