import meta from './meta.json';

export { meta };
export { WasmInspectorError } from './errors';
export type { Finding } from './errors';
export {
  MAX_EXPR_PARTS,
  MAX_LARGEST_FUNCTIONS,
  MAX_MODULE_BYTES,
  MAX_NAME_BYTES,
  MAX_NOTES,
  MAX_PREVIEW_BYTES,
  MAX_ROWS,
  MAX_SHOWN_NAME,
  MAX_SIGNATURE_PARTS,
  MAX_STRINGS,
  MAX_STRING_SCAN_BYTES,
  MAX_TREE_ITEMS,
  MIN_STRING_LENGTH,
  withCommas,
} from './limits';
export { Cursor } from './cursor';
export { visible } from './visible';
export { readConstExpr } from './const-expr';
export { SECTION_NAMES, readHeader, walkSections } from './sections';
export type { Header, SectionInfo, SectionWalk } from './sections';
export { Capped, exportedFunctionNames, readModule } from './module';
export type {
  BodyRow,
  DataRow,
  ElementRow,
  ExportRow,
  ExternKind,
  GlobalRow,
  ImportRow,
  MemoryRow,
  ModuleData,
  TableRow,
  TagRow,
} from './module';
export { readNameSection } from './names';
export type { NameSubsection, NamesReport } from './names';
export { readCustomSections } from './custom';
export type { CustomKind, CustomReport, CustomRow, ProducerField, TargetFeature } from './custom';
export { findStrings } from './strings';
export type { StringItem, StringsReport } from './strings';
export { FEATURE_ORDER, usedFeatures } from './features';
export type { Limits, TypeKind, TypeRow } from './types';
export { checkModuleSize, inspect } from './report';
export type { FunctionRow, FunctionsReport, Report, ReportKind } from './report';
