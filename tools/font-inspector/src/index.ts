import meta from './meta.json';

export { meta };

// The WOFF2 engine (./engine) is never imported here: only the background worker reaches it, so the engine is not part
// of this package's index or of the page's own code.
export { FontInspectorError } from './errors';
export * from './limits';
export { visible } from './visible';
export { ByteReader } from './bytes';
export {
  WHOLE_FILE_CHECKSUM,
  assembleSfnt,
  checkFileSize,
  checksum,
  readContainer,
  readSfntFont,
  tableBytes,
  type Container,
  type ContainerKind,
  type SfntFont,
  type TableEntry,
} from './sfnt';
export { inflateTable, readWoff1Header, unwrapWoff1, type Woff1Header, type Woff1Table } from './woff1';
export {
  WOFF2_KNOWN_TAGS,
  planWoff2,
  readWoff2Header,
  unpackWoff2,
  type Woff2Decompress,
  type Woff2Header,
  type Woff2Table,
} from './woff2';
export {
  NAME_ID_LABELS,
  decodeNameBytes,
  encodingFor,
  pickName,
  readNameTable,
  type NameRecord,
  type NameTable,
} from './names';
export {
  describeEmbedding,
  longDateTime,
  readMetrics,
  verticalMetricsNote,
  type Embedding,
  type HeadInfo,
  type HheaInfo,
  type Metrics,
  type Os2Info,
  type PostInfo,
} from './metrics';
export {
  inspectFont,
  type FontReport,
  type InspectOptions,
  type LicenceText,
  type ReportNote,
  type TableRow,
} from './report';
