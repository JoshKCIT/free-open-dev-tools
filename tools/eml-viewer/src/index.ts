import meta from './meta.json';

export { meta };
export { EmlViewerError, type EmlViewerPart } from './errors';
export {
  MAX_ADDRESS_CHARACTERS,
  MAX_ATTACHMENTS_OFFERED,
  MAX_CID_IMAGE_BYTES,
  MAX_CID_TOTAL_BYTES,
  MAX_CONTINUATIONS,
  MAX_DEPTH,
  MAX_ENCODED_WORDS,
  MAX_FILENAME_CHARACTERS,
  MAX_HEADERS,
  MAX_HEADER_BYTES,
  MAX_HTML_DEPTH,
  MAX_HTML_PREVIEW_BYTES,
  MAX_HTML_TAGS,
  MAX_LISTED_REFERENCES,
  MAX_MESSAGE_BYTES,
  MAX_PARAMETERS,
  MAX_PARTS,
  MAX_PASTE_CHARACTERS,
  MAX_TEXT_BODY_SHOWN,
  checkFileSize,
  checkPasteSize,
  withCommas,
} from './limits';
export { analyzeMessage } from './analyze';
export type { AttachmentInfo, CidPart, EmlAnalysis, HeaderRow, TextBody, TreeOut } from './analyze';
export { previewHtml, scanHtml } from './html-preview';
export type { BlockedReference, LinkInfo, PreviewResult } from './html-preview';
export { decodeEncodedWords, type DecodedWords } from './encoded-words';
export { parseParameters, findParam, type ParamEntry, type ParsedValue } from './params';
export { parseMime, decodePartBody, type PartNode, type MimeOptions } from './mime';
export { splitHeaderBlock, type HeaderBlock, type RawField } from './lines';
export { decodeBytes, escapeBytes, type DecodedText } from './charset';
export { decodeBase64Lenient, decodeQuotedPrintable } from './transfer';
export { safeAttachmentName, showBody, type CleanName } from './names';
export { visible } from './visible';
