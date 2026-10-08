import { septetsOf } from './alphabet';
import { MAX_PARTS, checkMessageLength } from './limits';

/** The two encodings a text message can use here: the GSM 7-bit default alphabet, or UCS-2 (16-bit units). */
export type Encoding = 'gsm7' | 'ucs2';

/** One part of a message: the text it carries, how much of its room it uses and how much room it has. */
export interface Segment {
  /** 1 for the first part. */
  index: number;
  /** The characters in this part. */
  text: string;
  /** Septets (GSM 7-bit) or UTF-16 units (UCS-2) used. */
  used: number;
  /** The room in this part: the one-message size when the whole text is one part, otherwise the size of a part. */
  capacity: number;
}

/** A character that is not in the GSM 7-bit alphabet, and so forces the whole message into UCS-2. */
export interface ForcedCharacter {
  /** The character itself (one code point, or one unpaired surrogate unit). */
  character: string;
  /** Its code point; for an unpaired surrogate, the value of the unit. */
  codePoint: number;
  /** How many times it occurs. */
  count: number;
  /** The 1-based position of its first occurrence, counted in characters (code points). */
  firstAt: number;
}

/** The answer for one message. */
export interface Analysis {
  encoding: Encoding;
  /** Characters, counted as code points: a surrogate pair is one, an unpaired surrogate is one. */
  characters: number;
  /** UTF-16 code units, which is what a JavaScript string length counts. */
  codeUnits: number;
  /** Septets (GSM 7-bit, an extension character counts 2) or UTF-16 units (UCS-2). */
  units: number;
  /** What one message holds in this encoding: 160 septets or 70 units. */
  single: number;
  /** What each part of a longer message holds in this encoding: 153 septets or 67 units. */
  part: number;
  segments: Segment[];
  /** Every distinct character outside the alphabet, in the order of first appearance. Empty when the message is GSM 7-bit. */
  forced: ForcedCharacter[];
  /** Plain-words findings. None of them repeats the message. */
  warnings: string[];
}

/** 3GPP TS 23.040: 160 septets in one message, 153 (160 minus the 7 septets of a 6 octet header) in each part of a longer one. */
const GSM_SINGLE = 160;
const GSM_PART = 153;
/** 3GPP TS 23.038 clause 6.2.3 and TS 23.040 clause 9.2.3.24.1: 70 units in one message, 67 ((140 minus 6) over 2) in each part. */
const UCS2_SINGLE = 70;
const UCS2_PART = 67;

interface Measured {
  encoding: Encoding;
  characters: number;
  codeUnits: number;
  units: number;
  single: number;
  part: number;
  segments: Segment[];
  forced: ForcedCharacter[];
}

/**
 * The whole splitting rule (TS 23.040 clause 9.2.3.24.1): a text that fits one message is one segment; otherwise walk the
 * characters, and when the next one does not fit in the room left in a part, start a new part with it. A character is never
 * split, so an extension pair or a surrogate pair moves whole to the next part and can leave the part before it one short.
 */
function split(chars: string[], widths: number[], total: number, single: number, part: number): Segment[] {
  if (total === 0) return [];
  if (total <= single) return [{ index: 1, text: chars.join(''), used: total, capacity: single }];
  const segments: Segment[] = [];
  let text = '';
  let used = 0;
  for (let i = 0; i < chars.length; i++) {
    const width = widths[i]!;
    if (used + width > part) {
      segments.push({ index: segments.length + 1, text, used, capacity: part });
      text = '';
      used = 0;
    }
    text += chars[i]!;
    used += width;
  }
  if (used > 0) segments.push({ index: segments.length + 1, text, used, capacity: part });
  return segments;
}

/** One pass over the code points, then the encoding is chosen: any character outside the alphabet makes it UCS-2. */
function measure(text: string): Measured {
  const chars: string[] = [];
  const septets: number[] = [];
  const unitsEach: number[] = [];
  const forced = new Map<number, ForcedCharacter>();
  let gsmTotal = 0;
  for (const character of text) {
    const septet = septetsOf(character);
    const units = character.length;
    chars.push(character);
    unitsEach.push(units);
    if (septet === undefined) {
      septets.push(0);
      const codePoint = character.codePointAt(0) ?? 0;
      const seen = forced.get(codePoint);
      if (seen) seen.count++;
      else forced.set(codePoint, { character, codePoint, count: 1, firstAt: chars.length });
    } else {
      septets.push(septet);
      gsmTotal += septet;
    }
  }
  if (forced.size === 0) {
    return {
      encoding: 'gsm7',
      characters: chars.length,
      codeUnits: text.length,
      units: gsmTotal,
      single: GSM_SINGLE,
      part: GSM_PART,
      segments: split(chars, septets, gsmTotal, GSM_SINGLE, GSM_PART),
      forced: [],
    };
  }
  return {
    encoding: 'ucs2',
    characters: chars.length,
    codeUnits: text.length,
    units: text.length,
    single: UCS2_SINGLE,
    part: UCS2_PART,
    segments: split(chars, unitsEach, text.length, UCS2_SINGLE, UCS2_PART),
    forced: [...forced.values()],
  };
}

function codePointLabel(codePoint: number): string {
  return 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function unitWord(encoding: Encoding, count: number): string {
  return encoding === 'gsm7' ? plural(count, 'septet', 'septets') : plural(count, 'UTF-16 unit', 'UTF-16 units');
}

/**
 * Counts the SMS segments a message needs and says why. Refused over 100,000 UTF-16 units, before anything is read. The
 * text is counted exactly as given and is never normalised. Characters are code points; one character outside the GSM
 * 7-bit alphabet (3GPP TS 23.038) makes the whole message UCS-2; an extension character counts two septets; no character
 * is split between parts. An empty message needs no segment.
 */
export function analyseMessage(text: string): Analysis {
  checkMessageLength(text);
  const measured = measure(text);
  const warnings: string[] = [];

  if (measured.forced.length > 0) {
    let occurrences = 0;
    for (const f of measured.forced) occurrences += f.count;
    if (occurrences === 1) {
      warnings.push(
        `One character outside the GSM 7-bit alphabet (${codePointLabel(measured.forced[0]!.codePoint)}) turns the whole message into UCS-2, which holds ${UCS2_SINGLE} units in one message instead of ${GSM_SINGLE} septets.`,
      );
    } else {
      warnings.push(
        `${occurrences} characters outside the GSM 7-bit alphabet (${measured.forced.length} kinds, listed below) turn the whole message into UCS-2, which holds ${UCS2_SINGLE} units in one message instead of ${GSM_SINGLE} septets.`,
      );
    }
  }

  let shortParts = 0;
  for (let i = 0; i < measured.segments.length - 1; i++) {
    const s = measured.segments[i]!;
    if (s.used < s.capacity) shortParts++;
  }
  if (shortParts > 0) {
    warnings.push(
      measured.encoding === 'gsm7'
        ? `${shortParts} ${plural(shortParts, 'part is', 'parts are')} left one septet short: the next character takes two septets (an escape and its code) and is never split between parts, so it starts the next part.`
        : `${shortParts} ${plural(shortParts, 'part is', 'parts are')} left one unit short: the next character is a surrogate pair of two units and is never split between parts, so it starts the next part.`,
    );
  }

  if (measured.encoding === 'ucs2') {
    const composed = text.normalize('NFC');
    if (composed !== text) {
      const other = measure(composed);
      const fewerParts = other.segments.length < measured.segments.length;
      const shorter = other.encoding === measured.encoding && other.units < measured.units;
      const backToGsm = other.encoding === 'gsm7';
      if (fewerParts || shorter || backToGsm) {
        warnings.push(
          `Some characters are written as a letter followed by a combining mark. Joined into single characters (Unicode NFC) the text would be ${other.units} ${unitWord(other.encoding, other.units)} in ${other.segments.length} ${plural(other.segments.length, 'segment', 'segments')} instead of ${measured.units} ${unitWord(measured.encoding, measured.units)} in ${measured.segments.length}. This page counts the text as it is and does not change it.`,
        );
      }
    }
  }

  if (measured.segments.length > MAX_PARTS) {
    warnings.push(
      `The message needs ${measured.segments.length} parts. A concatenated message has at most ${MAX_PARTS} parts, so it cannot be sent as one message.`,
    );
  }

  return { ...measured, warnings };
}
