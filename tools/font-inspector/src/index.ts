import meta from './meta.json';

export { meta };

// The WOFF2 engine (./engine) is never imported here: only the background worker reaches it, so the engine is not part
// of this package's index or of the page's own code.
export { EngineRefusedError, FontInspectorError } from './errors';
export { guardEngine, watchEngineStart, type EngineStartState } from './engine-start';
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
  withChecksumAdjustment,
  type Container,
  type ContainerKind,
  type SfntFont,
  type TableEntry,
} from './sfnt';
export {
  checkWoff1Output,
  inflateTable,
  readWoff1Header,
  unwrapWoff1,
  wrapWoff1,
  type Woff1Header,
  type Woff1Table,
} from './woff1';
export {
  EXPANSION_REFUSAL,
  WOFF2_KNOWN_TAGS,
  checkWoff2Output,
  exceedsExpansionRatio,
  isCodeGenerationRefusal,
  planWoff2,
  readWoff2Header,
  unpackWoff2,
  type Woff2Decompress,
  type Woff2Header,
  type Woff2Table,
} from './woff2';
export {
  cleanName,
  conversionRefusal,
  convertFont,
  convertSfnt,
  outputName,
  type ConvertEngine,
  type ConvertJob,
  type ConvertTarget,
  type ConvertedFont,
  type OutputNames,
} from './convert';
export { verifyConversion, type ConversionReport, type VerifyEngine } from './verify';
export {
  compareGlyphs,
  glyphRanges,
  readGlyphValue,
  sameGlyphValue,
  type GlyphBudget,
  type GlyphComparison,
  type GlyphTable,
  type GlyphValue,
} from './glyph-data';
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
  restrictsEmbedding,
  verticalMetricsNote,
  type Embedding,
  type HeadInfo,
  type HheaInfo,
  type Metrics,
  type Os2Info,
  type PostInfo,
} from './metrics';
export { readCmap, type CmapResult, type CmapSubtable, type VariationSelector } from './cmap';
export { BLOCKS, UNICODE_VERSION } from './blocks';
export { blockCoverage, checkSample, type BlockCoverage, type Coverage, type SampleResult } from './coverage';
export { describeFeature, isRegisteredFeature } from './feature-tags';
export { readFeatures, type FeatureTable } from './features';
export { readVariations, type Axis, type Instance, type VariationResult } from './variations';
export { contoursToPath, quadraticContour, type Contour, type GlyphDrawing, type Segment } from './outline';
export {
  buildGrid,
  checkGridOptions,
  openGlyphs,
  type Grid,
  type GridContext,
  type GridOptions,
  type GlyphRow,
  type NamedGlyphSource,
} from './grid';
export {
  inspectFont,
  type FeatureRow,
  type FontReport,
  type InspectOptions,
  type LicenceText,
  type ReportNote,
  type TableRow,
} from './report';
