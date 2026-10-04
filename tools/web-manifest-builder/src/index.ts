import meta from './meta.json';

export { meta };

export { ManifestBuilderError } from './errors';
export {
  MAX_FIELD_CHARACTERS,
  MAX_ICONS,
  MAX_JSON_BYTES,
  MAX_SHORTCUTS,
  MAX_SHOWN,
  countCodePoints,
  visible,
  withCommas,
} from './limits';
export { NAMED_COLOURS, parseCssColour } from './colour';
export type { ParsedColour } from './colour';
export { parseIconPurpose, parseIconSizes } from './sizes';
export { parseMimeEssence } from './mime';
export { MAX_CELL_SHOWN, MEMBER_ORDER, processManifest } from './process';
export type {
  FindingSeverity,
  ManifestFinding,
  ProcessedColour,
  ProcessedIcon,
  ProcessedManifest,
  ProcessedRow,
  ProcessedShortcut,
} from './process';
export { buildManifest, manifestLinkTag, manifestToJson } from './build';
export type { ManifestFields } from './build';
export { installAdvice } from './advice';
export { DEFAULT_MANIFEST_URL, DEFAULT_PAGE_URL } from './address';
