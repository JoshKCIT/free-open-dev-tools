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
export { isIp4Literal, isIp6Literal } from './addresses';
export { readTxtRecords } from './txt';
export type { TxtRecord } from './txt';
export { parseSpf } from './spf-parse';
export type { SpfKind, SpfProblem, SpfQualifier, SpfRecord, SpfTerm } from './spf-parse';
export { checkSpf, describeTerm } from './spf-check';
export type { LookupKind, LookupTerm, NoteTone, SpfNote, SpfReport } from './spf-check';
export { countLookups } from './spf-tree';
export type { TreeCount, TreeLoop, TreeRecordInput, TreeRow } from './spf-tree';
export { buildSpf, toTxtValue } from './spf-build';
export type { BuildField, BuildProblem, BuiltSpf, SpfEnding, SpfFields } from './spf-build';
export { TABLE_2_ORDER, parseDmarc, parseUriList } from './dmarc-parse';
export type { DmarcRecord, DmarcStatus, DmarcTag, DmarcUri } from './dmarc-parse';
export { checkDmarc, pickDmarcRecord } from './dmarc-check';
export type {
  DmarcAddress,
  DmarcAuthorisation,
  DmarcNote,
  DmarcNoteTone,
  DmarcPick,
  DmarcPolicies,
  DmarcReport,
} from './dmarc-check';
export { buildDmarc } from './dmarc-build';
export type { BuiltDmarc, DmarcBuildField, DmarcBuildProblem, DmarcFields, DmarcPolicyChoice } from './dmarc-build';
export { toZoneForm } from './zone';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';
