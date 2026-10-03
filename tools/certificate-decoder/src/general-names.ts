/**
 * GeneralName (RFC 5280 section 4.2.1.6): the names in subject and issuer alternative names, key identifiers, distribution
 * points, access descriptions and name constraints. Every value is text and stays text: an address in a name is never
 * followed.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import { DerError, derChild, derContent, derExpect, derOid, derString, type DerNode } from './der';
import { cappedHex } from './hex';
import { readName, visible } from './names';
import { oidLabel } from './oids';

export interface GeneralNameInfo {
  type: string;
  value: string;
}

const REPLACEMENT = String.fromCodePoint(0xfffd);
const USER_PRINCIPAL_NAME = '1.3.6.1.4.1.311.20.2.3';

/** IA5String content: each byte is one character, and a byte of 128 or more is shown as U+FFFD. */
function asciiText(content: Uint8Array): string {
  const pieces: string[] = [];
  for (const octet of content) pieces.push(octet < 128 ? String.fromCharCode(octet) : REPLACEMENT);
  return pieces.join('');
}

/** An IPv4 address, or an IPv6 address in the compressed lower case form of RFC 5952 section 4. */
function addressText(content: Uint8Array): string {
  if (content.length === 4) return Array.from(content).join('.');
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((content[i]! << 8) | content[i + 1]!).toString(16));
  // The longest run of zero groups of two or more is written as `::`; the first one wins a tie (RFC 5952 section 4.2.3).
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let end = i;
    while (end < 8 && groups[end] === '0') end++;
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }
  if (bestLength < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

/**
 * An iPAddress value. Four octets are IPv4 and sixteen are IPv6; in a name constraint (`withMask`) eight and thirty-two
 * octets are an address and its mask, written `address/mask`. Any other length is shown as hex.
 */
export function ipText(content: Uint8Array, withMask: boolean): string {
  if (content.length === 4 || content.length === 16) return addressText(content);
  if (withMask && content.length === 8)
    return `${addressText(content.subarray(0, 4))}/${addressText(content.subarray(4))}`;
  if (withMask && content.length === 32)
    return `${addressText(content.subarray(0, 16))}/${addressText(content.subarray(16))}`;
  return cappedHex(content);
}

function otherName(bytes: Uint8Array, node: DerNode): string {
  const typeId = derOid(bytes, derChild(node, 0));
  const wrapper = derChild(node, 1);
  derExpect(wrapper, 0, 'context', true);
  const value = derChild(wrapper, 0);
  const label = oidLabel(typeId);
  if (typeId === USER_PRINCIPAL_NAME) {
    try {
      return `${label}: ${visible(derString(bytes, value).text)}`;
    } catch (err) {
      if (!(err instanceof DerError)) throw err;
    }
  }
  return `${label}: ${cappedHex(bytes.subarray(value.start, value.end))}`;
}

/** The type, in the words of RFC 5280, and the text of one GeneralName. */
export function readGeneralName(bytes: Uint8Array, node: DerNode, inConstraint = false): GeneralNameInfo {
  if (node.cls !== 'context') {
    throw new DerError(`Expected a general name at offset ${node.start}, found another kind of element.`, node.start);
  }
  const content = derContent(bytes, node);
  switch (node.tag) {
    case 0:
      return { type: 'otherName', value: otherName(bytes, node) };
    case 1:
      return { type: 'rfc822Name', value: visible(asciiText(content)) };
    case 2:
      return { type: 'dNSName', value: visible(asciiText(content)) };
    case 3:
      return { type: 'x400Address', value: cappedHex(content) };
    case 4:
      return { type: 'directoryName', value: readName(bytes, derChild(node, 0)).display };
    case 5:
      return { type: 'ediPartyName', value: cappedHex(content) };
    case 6:
      return { type: 'uniformResourceIdentifier', value: visible(asciiText(content)) };
    case 7:
      return { type: 'iPAddress', value: ipText(content, inConstraint) };
    case 8:
      // The identifier is written with the implicit tag [8], so it is read as an OBJECT IDENTIFIER with the same content.
      return { type: 'registeredID', value: derOid(bytes, { ...node, tag: 6, cls: 'universal' }) };
    default:
      return { type: `[${node.tag}]`, value: cappedHex(content) };
  }
}

/** Every GeneralName that is a child of `node`, whatever tag `node` has (a SEQUENCE, or an implicitly tagged one). */
export function generalNamesOf(bytes: Uint8Array, node: DerNode, inConstraint = false): GeneralNameInfo[] {
  return node.children.map((child) => readGeneralName(bytes, child, inConstraint));
}

/** The GeneralNames of a SEQUENCE OF GeneralName, such as the value of a subject alternative name extension. */
export function readGeneralNames(bytes: Uint8Array, node: DerNode): GeneralNameInfo[] {
  derExpect(node, 16, 'universal', true);
  return generalNamesOf(bytes, node);
}
