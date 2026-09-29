import meta from './meta.json';

export { meta };
export { GzipDeflateError, type GzipDeflateErrorKind } from './errors';
export { crc32, crc32Update, adler32, adler32Update } from './checksums';
export { decodeInput } from './input';
export { detectContainer, type Container, type ZlibLevelHint } from './container';
export {
  MAX_OUTPUT_BYTES,
  FEED_CHUNK_BYTES,
  decompressBytes,
  decompress,
  type DecompressBytesOptions,
  type DecompressBytesResult,
  type DecompressOptions,
  type DecompressResult,
  type GzipMemberInfo,
  type ZlibHeaderInfo,
} from './inflate';
export {
  compressBytes,
  compress,
  type CompressFormat,
  type CompressBytesOptions,
  type CompressOptions,
  type CompressOutputEncoding,
  type CompressResult,
} from './compress';
