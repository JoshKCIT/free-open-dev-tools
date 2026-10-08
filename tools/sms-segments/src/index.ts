import meta from './meta.json';

export { meta };

export { analyseMessage } from './analyse';
export type { Analysis, Encoding, ForcedCharacter, Segment } from './analyse';
export { DEFAULT_ALPHABET, ESCAPE_CODE, EXTENSION, septetsOf } from './alphabet';
export { SmsSegmentsError } from './errors';
export { OFFENDERS, codePointLabel, describeForced } from './offenders';
export type { Offender } from './offenders';
export { gsmSafeCopy } from './suggest';
export type { SafeCopy } from './suggest';
export {
  MAX_COPY_CHARACTERS,
  MAX_FORCED_ROWS,
  MAX_MESSAGE_UNITS,
  MAX_PARTS,
  MAX_SEGMENT_ROWS,
  MAX_SHOWN_CHARACTERS,
  checkMessageLength,
  withCommas,
} from './limits';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';
