import meta from './meta.json';
import { decodeBase64 } from './base64';
import { NS_ASSERTION, allElements, childrenNamed, isNamed } from './dom';
import { SamlDecoderError, type SamlDecoderPart } from './errors';
import { formatXml, type FormattedXml } from './format';
import { inflateCapped } from './inflate';
import { readInput, type InputKind, type InputReading, type MessageParameter } from './input';
import { MAX_NOTES, MAX_XML_BYTES, TOO_LARGE_MESSAGE, checkPaste, utf8Length, withCommas } from './limits';
import { parseSaml } from './parse';
import { prescan } from './prescan';
import { describeSignatureAlgorithm, describeSignatures, elementLabel, type SignatureReport } from './signature';
import { summarize, type SamlSummary } from './summary';
import { UTF32_MESSAGE, decodeXml, looksLikeUtf32 } from './text';
import { visible } from './visible';
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
export { describeTime, formatUtc, parseDateTime } from './times';
export { describeSignatures, describeSignatureAlgorithm } from './signature';
export { formatXml } from './format';
export { visible } from './visible';
export type { SamlSummary, TimeRow, AttributeRow, SamlKind } from './summary';
export type { SignatureReport, SignatureInfo, ReferenceInfo, ReferenceTarget } from './signature';
export type { FormattedXml } from './format';
export type { InputKind, MessageParameter } from './input';

export interface DecodeOptions {
  /** The time, in milliseconds since 1970, that times in the message are judged against. */
  now: number;
}

/** What the binding carried next to the message. All of it is text exactly as pasted, or decoded once. */
export interface TransportDetails {
  parameter?: MessageParameter;
  relayState?: string;
  sigAlg?: string;
  /** What the page can say about the SigAlg address: its name, or that it is not an address it knows. */
  sigAlgNote?: string;
  /** How long the Signature parameter is, and whether it is Base64. The value itself is never used. */
  signatureLength?: string;
  /** The octet string the HTTP-Redirect binding signs, from the pasted substrings and never re-encoded. */
  signedString?: string;
  /** True when a Signature parameter was pasted. */
  signaturePresent: boolean;
}

export interface SamlReport {
  kind: InputKind;
  /** What was recognised: HTTP-Redirect, HTTP-POST, raw XML or a bare value. */
  binding: string;
  /** What was done to the pasted text, in order. */
  steps: string[];
  /** Unusual things about the wrapping of the message. */
  warnings: string[];
  /** The message as the XML text it decoded to. */
  xml: string;
  xmlBytes: number;
  summary: SamlSummary;
  signatures: SignatureReport;
  formatted: FormattedXml;
  /** What the binding carried next to the message, for a redirect address or a form. */
  transport?: TransportDetails;
  /** Things worth a look about the message itself, each one sentence. */
  notes: string[];
}

/** True when the first bytes are the start of XML text in UTF-8 or UTF-16, so the data was not compressed. */
function startsLikeXml(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  else if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] === 0x3c) return true;
  return bytes[i] === 0 && bytes[i + 1] === 0x3c;
}

function describeSignatureValue(signature: string): string {
  let text = signature;
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Left as pasted: the length is still the length of what was pasted.
    }
  }
  const length = `${withCommas(text.length)} characters`;
  try {
    return `${length}, Base64 for ${withCommas(decodeBase64(text).bytes.length)} bytes`;
  } catch {
    return `${length}, which is not Base64 text`;
  }
}

function transportOf(reading: InputReading): TransportDetails | undefined {
  if (reading.kind === 'xml' || reading.kind === 'base64') return undefined;
  const transport: TransportDetails = { signaturePresent: reading.signature !== undefined };
  if (reading.parameter !== undefined) transport.parameter = reading.parameter;
  if (reading.relayState !== undefined) transport.relayState = reading.relayState;
  if (reading.sigAlg !== undefined) {
    transport.sigAlg = reading.sigAlg;
    transport.sigAlgNote = describeSignatureAlgorithm(reading.sigAlg);
  }
  if (reading.signature !== undefined) transport.signatureLength = describeSignatureValue(reading.signature);
  if (reading.signedString !== undefined) transport.signedString = reading.signedString;
  return transport;
}

/** How many of the elements the Signatures cover a note names before it says "and more". */
const SIGNED_NAMED = 3;

/**
 * The two signature-wrapping shapes that only show when the summary and the signatures are read together. The summary
 * reads the assertions that sit directly in a Response, so (1) an Assertion element anywhere else in the message is noted,
 * and (2) when the Signatures point at elements but none of them is the root, an assertion the summary reads that no
 * Signature points at is noted, with the elements they do point at. A message with no Signature, or whose Signatures name
 * nothing they cover, gets no second note: those have notes of their own.
 */
function wrappingNotes(document: Document, summary: SamlSummary, signatures: SignatureReport): string[] {
  const root = document.documentElement;
  let summarised: Element[] = [];
  if (summary.kind === 'Assertion') summarised = [root];
  else if (summary.kind === 'Response') summarised = childrenNamed(root, NS_ASSERTION, 'Assertion');
  else return [];
  const notes: string[] = [];
  if (summary.kind === 'Response') {
    const total = allElements(root).filter((element) => isNamed(element, NS_ASSERTION, 'Assertion')).length;
    const direct = summarised.length;
    if (total > direct) {
      notes.push(
        direct === 0
          ? `The message holds ${withCommas(total)} Assertion element${total === 1 ? '' : 's'}, none of them directly in the Response, so the summary reads none of them; an assertion inside another element is a signature-wrapping shape.`
          : `The message holds ${withCommas(total)} Assertion elements, but the summary reads only the ${withCommas(direct)} that ${direct === 1 ? 'sits' : 'sit'} directly in the Response; the others sit inside other elements, a signature-wrapping shape.`,
      );
    }
  }
  // A Signature that names nothing it covers (no SignedInfo, no Reference, a Reference to no element or outside the
  // message) already has its own note, and then nothing here can be compared.
  const signed = signatures.signedElements;
  if (signed.length === 0) return notes;
  if (signed.includes(elementLabel(root)) || signed.includes('the whole document')) return notes;
  const covered = ` (they point at ${signed
    .slice(0, SIGNED_NAMED)
    .map((name) => visible(name, 80))
    .join(', ')}${signed.length > SIGNED_NAMED ? ', and more' : ''})`;
  for (const assertion of summarised) {
    const name = elementLabel(assertion);
    if (signed.includes(name)) continue;
    notes.push(
      `The assertion summarised here (${visible(name, 80)}) is not an element any Signature points at${covered}: a signature-wrapping shape.`,
    );
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}

/**
 * Decodes a SAML 2.0 message pasted as an HTTP-Redirect address, an HTTP-POST form or value, or raw XML. Each step runs once,
 * in this order: read the input, undo Base64, undo compression, decode the text, refuse a DOCTYPE or entity declaration,
 * count tags and depth, read the XML, summarise, list the signatures, format. Nothing is verified, nothing is fetched, and no
 * state is kept between calls, so the same text and time always give the same report.
 */
export function decodeSaml(text: string, options: DecodeOptions): SamlReport {
  checkPaste(text);
  const reading = readInput(text);
  const steps = [...reading.steps];
  const warnings = [...reading.warnings];
  let binding = reading.binding;
  let xml: string;
  if (reading.kind === 'xml') {
    if (utf8Length(reading.raw) > MAX_XML_BYTES) throw new SamlDecoderError(TOO_LARGE_MESSAGE, 'message');
    xml = reading.raw;
  } else {
    const base64 = decodeBase64(reading.raw);
    warnings.push(...base64.warnings);
    steps.push(`Undid Base64: ${withCommas(base64.bytes.length)} bytes.`);
    let bytes = base64.bytes;
    if (looksLikeUtf32(bytes)) throw new SamlDecoderError(UTF32_MESSAGE, 'message');
    const compressed = !startsLikeXml(bytes);
    if (compressed) {
      const inflated = inflateCapped(bytes, MAX_XML_BYTES);
      bytes = inflated.bytes;
      steps.push(`Inflated the data (DEFLATE): ${withCommas(bytes.length)} bytes.`);
      if (inflated.container !== 'raw') {
        warnings.push(
          `The data was wrapped as ${inflated.container}, but the binding says raw DEFLATE with no wrapper. It was read anyway.`,
        );
      }
      if (reading.kind === 'post') {
        warnings.push(
          'The HTTP-POST binding does not compress the message, but this one was compressed. It was inflated.',
        );
      }
    } else {
      if (bytes.length > MAX_XML_BYTES) throw new SamlDecoderError(TOO_LARGE_MESSAGE, 'message');
      steps.push('The decoded data is XML text already, so it was not inflated.');
      if (reading.kind === 'redirect' && reading.hasAddress) {
        warnings.push(
          'The message in the address was not compressed, but the HTTP-Redirect binding says DEFLATE (RFC 1951). It was read as it is.',
        );
      }
    }
    if (reading.kind === 'redirect' && !reading.hasAddress) binding = compressed ? 'HTTP-Redirect' : 'HTTP-POST';
    if (reading.kind === 'base64') {
      binding = compressed ? 'HTTP-Redirect encoding (value only)' : 'HTTP-POST encoding (value only)';
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
  const summary = summarize(parsed.document, options.now);
  const signatures = describeSignatures(parsed.document);
  const formatted = formatXml(parsed.document);
  const transport = transportOf(reading);

  // The signatures, as one row of the summary.
  const signatureParts: string[] = [];
  if (signatures.signatures.length > 0) {
    const places = signatures.signatures
      .slice(0, 5)
      .map((signature) => `in ${signature.parent}${signature.parentId === undefined ? '' : ` ${signature.parentId}`}`);
    const covered = ` (${places.join(', ')}${signatures.signatures.length > 5 ? ', and more' : ''})`;
    signatureParts.push(`${signatures.signatures.length} present, not verified${covered}`);
  }
  if (transport?.signaturePresent)
    signatureParts.push('a Signature parameter is in the redirect address, not verified');
  summary.pairs.push(['Signatures', signatureParts.length > 0 ? signatureParts.join('; ') : 'None present']);

  const notes = [...summary.notes, ...signatures.notes, ...wrappingNotes(parsed.document, summary, signatures)];
  const hasSignature = signatures.signatures.length > 0 || transport?.signaturePresent === true;
  if (!hasSignature) {
    notes.push(
      'No signature is present in this message, so nothing in it says who wrote it. A signature that is present would still not be checked here.',
    );
  }
  const protocolMessage = summary.kind !== 'Assertion' && summary.kind !== 'other';
  if (hasSignature && protocolMessage && !parsed.document.documentElement.hasAttribute('Destination')) {
    notes.push(
      'The message is signed but has no Destination attribute; the bindings say a signed message must carry one (Bindings sections 3.4.5.2 and 3.5.5.2).',
    );
  }
  if (transport?.relayState !== undefined && utf8Length(transport.relayState) > 80) {
    notes.push(
      `The RelayState is ${withCommas(utf8Length(transport.relayState))} bytes; the bindings say it must not exceed 80 bytes (Bindings sections 3.4.3 and 3.5.3).`,
    );
  }
  return {
    kind: reading.kind,
    binding,
    steps,
    warnings,
    xml,
    xmlBytes: utf8Length(xml),
    summary,
    signatures,
    formatted,
    ...(transport ? { transport } : {}),
    notes: notes.slice(0, MAX_NOTES * 2),
  };
}
