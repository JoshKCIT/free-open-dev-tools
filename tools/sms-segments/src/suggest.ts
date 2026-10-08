import { septetsOf } from './alphabet';
import { checkMessageLength } from './limits';
import { OFFENDERS } from './offenders';

/** A copy of a message with the listed characters replaced, shown to the visitor and never applied to what they typed. */
export interface SafeCopy {
  /** The copy. */
  text: string;
  /** How many characters were replaced by their listed replacement. */
  replaced: number;
  /** True when joining letters and combining marks into single characters (Unicode NFC) changed the text first. */
  normalised: boolean;
  /** How many characters outside the alphabet the copy still holds, because they are not on the list. */
  remaining: number;
}

/**
 * A copy of the message written in the GSM 7-bit alphabet as far as the list of known characters allows: the text is first
 * joined into single characters (Unicode NFC, so a letter and its combining accent become one letter the alphabet may
 * have), then each listed character is replaced by its replacement. Characters already in the alphabet stay, and so do
 * characters that are not on the list; `remaining` counts those. The input string is never changed. Refused over
 * 100,000 UTF-16 units, like the analysis.
 */
export function gsmSafeCopy(text: string): SafeCopy {
  checkMessageLength(text);
  const composed = text.normalize('NFC');
  let copy = '';
  let replaced = 0;
  let remaining = 0;
  for (const character of composed) {
    if (septetsOf(character) !== undefined) {
      copy += character;
      continue;
    }
    const listed = OFFENDERS.get(character.codePointAt(0) ?? 0);
    if (listed) {
      copy += listed.suggestion;
      replaced++;
    } else {
      copy += character;
      remaining++;
    }
  }
  return { text: copy, replaced, normalised: composed !== text, remaining };
}
