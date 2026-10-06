import meta from './meta.json';

export { meta };
export { SpfDmarcError } from './errors';
export type { SpfDmarcPart } from './errors';
export {
  LOOKUP_LIMIT,
  MAX_PASTE_CHARACTERS,
  MAX_RECORDS,
  MAX_RECORD_CHARACTERS,
  MAX_TERMS_SHOWN,
  SIZE_NOTE_OCTETS,
  STRING_OCTETS,
  withCommas,
} from './limits';
export { readTxtRecords } from './txt';
export type { TxtRecord } from './txt';
export { parseSpf } from './spf-parse';
export type { SpfKind, SpfProblem, SpfQualifier, SpfRecord, SpfTerm } from './spf-parse';
export { checkSpf } from './spf-check';
export type { LookupKind, LookupTerm, NoteTone, SpfNote, SpfReport } from './spf-check';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';
