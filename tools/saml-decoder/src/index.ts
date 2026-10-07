import meta from './meta.json';
import { decodeBase64 } from './base64';
import { SamlDecoderError, type SamlDecoderPart } from './errors';
import { inflateCapped } from './inflate';
import { readInput, type InputKind } from './input';
import { MAX_XML_BYTES, TOO_LARGE_MESSAGE, checkPaste, utf8Length } from './limits';
import { parseSaml } from './parse';
import { prescan } from './prescan';
import { summarize, type SamlSummary } from './summary';
import { decodeXml } from './text';
import { DOCTYPE_REFUSAL_MESSAGE, findDoctype } from './xml-doctype';
import { ENTITY_REFUSAL_MESSAGE, findEntityDeclaration } from './xml-entity';

export { meta };
export { SamlDecoderError, type SamlDecoderPart };
export {
  FEED_CHUNK_BYTES,
  MAX_ATTRIBUTES_PER_ELEMENT,
  MAX_DEPTH,
  MAX_PASTE_CHARACTERS,
  MAX_SHOWN_LINES,
  MAX_TAGS,
  MAX_XML_BYTES,
} from './limits';
export { DOCTYPE_REFUSAL_MESSAGE, findDoctype } from './xml-doctype';
export { ENTITY_REFUSAL_MESSAGE, findEntityDeclaration } from './xml-entity';
export { inflateCapped } from './inflate';
export { prescan } from './prescan';
export { readInput } from './input';
export { decodeBase64 } from './base64';
export { visible } from './visible';
export type { SamlSummary } from './summary';

export interface DecodeOptions {
  /** The time, in milliseconds since 1970, that times in the message are judged against. */
  now: number;
}

export interface SamlReport {
  kind: InputKind;
  /** What was recognised: HTTP-Redirect, HTTP-POST, raw XML or a bare value. */
  binding: string;
  /** What was done to the pasted text, in order. */
  steps: string[];
  warnings: string[];
  /** The message as the XML text it decoded to. */
  xml: string;
  summary: SamlSummary;
}

/** True when the first bytes are the start of XML text in UTF-8 or UTF-16, so the data was not compressed. */
function startsLikeXml(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  else if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] === 0x3c) return true;
  return (bytes[i] === 0x3c && bytes[i + 1] === 0) || (bytes[i] === 0 && bytes[i + 1] === 0x3c);
}

function containerWarning(container: string): string {
  return `The data was wrapped as ${container}, but the HTTP-Redirect binding says raw DEFLATE with no wrapper. It was read anyway.`;
}

/**
 * Decodes a SAML 2.0 message pasted as an HTTP-Redirect address, or as raw XML. Each step runs once, in this order: read the
 * input, undo Base64, undo compression, decode the text, refuse a DOCTYPE or entity declaration, count tags and depth, read
 * the XML, summarise. Nothing is verified, nothing is fetched, and no state is kept between calls.
 */
export function decodeSaml(text: string, options: DecodeOptions): SamlReport {
  void options;
  checkPaste(text);
  const reading = readInput(text);
  const steps = [...reading.steps];
  const warnings = [...reading.warnings];
  let xml: string;
  if (reading.kind === 'xml') {
    if (utf8Length(reading.raw) > MAX_XML_BYTES) throw new SamlDecoderError(TOO_LARGE_MESSAGE, 'message');
    xml = reading.raw;
  } else {
    const base64 = decodeBase64(reading.raw);
    warnings.push(...base64.warnings);
    steps.push(`Undid Base64: ${base64.bytes.length} bytes.`);
    let bytes = base64.bytes;
    if (!startsLikeXml(bytes)) {
      const inflated = inflateCapped(bytes, MAX_XML_BYTES);
      bytes = inflated.bytes;
      steps.push(`Inflated the data (DEFLATE): ${bytes.length} bytes.`);
      if (inflated.container !== 'raw') warnings.push(containerWarning(inflated.container));
    } else {
      if (bytes.length > MAX_XML_BYTES) throw new SamlDecoderError(TOO_LARGE_MESSAGE, 'message');
      steps.push('The decoded data is XML text already, so it was not inflated.');
    }
    const decoded = decodeXml(bytes);
    steps.push(`Read the bytes as ${decoded.encoding} text.`);
    xml = decoded.text.charCodeAt(0) === 0xfeff ? decoded.text.slice(1) : decoded.text;
  }
  const doctype = findDoctype(xml);
  if (doctype) throw new SamlDecoderError(DOCTYPE_REFUSAL_MESSAGE, 'message', doctype.line, doctype.column);
  const entity = findEntityDeclaration(xml);
  if (entity) throw new SamlDecoderError(ENTITY_REFUSAL_MESSAGE, 'message', entity.line, entity.column);
  prescan(xml);
  const parsed = parseSaml(xml);
  warnings.push(...parsed.warnings);
  return { kind: reading.kind, binding: reading.binding, steps, warnings, xml, summary: summarize(parsed.document) };
}
