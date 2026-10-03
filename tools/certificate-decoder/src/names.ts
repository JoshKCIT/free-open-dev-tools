/**
 * Distinguished names (RFC 5280 section 4.1.2.4): a SEQUENCE of RDNs, each a SET of attribute type and value pairs.
 *
 * Two forms are made. The first is as written in the certificate: the RDNs in order, `, ` between them and ` + ` between
 * the attributes of one, every value shown as text with nothing escaped. The second is the RFC 4514 string: the RDNs in
 * reverse order, `+` and `,` as separators, and each value escaped as RFC 4514 section 2.4 requires. An attribute type with
 * no short name, and a value that is not a character string, are written as the dotted identifier and `#` followed by the
 * hex of the value's DER, as section 2.4 says.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value. Names are shown as text only.
 */
import { DerError, derChild, derExpect, derHex, derOid, derString, type DerNode } from './der';
import { oidName } from './oids';

export interface NameInfo {
  /** The attributes in the order they are written in the certificate, `, ` between RDNs and ` + ` inside one. */
  display: string;
  /** The RFC 4514 string: the RDNs in reverse order, `+` inside one and `,` between. */
  rfc4514: string;
  /** The exact DER bytes of the Name, for comparing one name with another. */
  der: Uint8Array;
  /** True when a byte of a string did not belong to its string type and was shown as U+FFFD. */
  replaced: boolean;
}

interface Attribute {
  /** The short name, or the dotted identifier when there is none. */
  type: string;
  /** Whether the type has a short name. */
  named: boolean;
  /** The value as text, or `#` and the hex of its DER when it is not a character string. */
  text: string;
  /** True when the value is hex of DER (not a string), so it is never escaped. */
  raw: boolean;
  /** The `#` and hex of the value's DER, which an unnamed type always uses in the RFC 4514 form. */
  der: string;
}

/** RFC 4514 section 2.4: escapes the characters that need it; a control character is written as a backslash and two hex digits. */
function escape4514(text: string): string {
  let out = '';
  const last = text.length - 1;
  for (let i = 0; i <= last; i++) {
    const char = text[i]!;
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) out += '\\' + code.toString(16).padStart(2, '0');
    else if (
      char === '"' ||
      char === '+' ||
      char === ',' ||
      char === ';' ||
      char === '<' ||
      char === '>' ||
      char === '\\'
    )
      out += '\\' + char;
    else if (i === 0 && (char === ' ' || char === '#')) out += '\\' + char;
    else if (i === last && char === ' ') out += '\\ ';
    else out += char;
  }
  return out;
}

export function readName(bytes: Uint8Array, node: DerNode): NameInfo {
  derExpect(node, 16, 'universal', true);
  let replaced = false;
  const rdns: Attribute[][] = [];
  for (const rdn of node.children) {
    derExpect(rdn, 17, 'universal', true);
    const attributes: Attribute[] = [];
    for (const pair of rdn.children) {
      derExpect(pair, 16, 'universal', true);
      const oid = derOid(bytes, derChild(pair, 0));
      const valueNode = derChild(pair, 1);
      const whole = '#' + derHex(bytes.subarray(valueNode.start, valueNode.end));
      let text = whole;
      let raw = true;
      try {
        const decoded = derString(bytes, valueNode);
        text = decoded.text;
        raw = false;
        if (decoded.replaced) replaced = true;
      } catch (err) {
        if (!(err instanceof DerError)) throw err;
      }
      const short = oidName(oid);
      attributes.push({ type: short ?? oid, named: short !== undefined, text, raw, der: whole });
    }
    rdns.push(attributes);
  }
  const written = (rdn: Attribute[]): string => rdn.map((a) => `${a.type}=${a.text}`).join(' + ');
  const rfc = (rdn: Attribute[]): string =>
    rdn.map((a) => `${a.type}=${a.named && !a.raw ? escape4514(a.text) : a.der}`).join('+');
  return {
    display: rdns.map(written).join(', '),
    rfc4514: [...rdns].reverse().map(rfc).join(','),
    der: bytes.subarray(node.start, node.end),
    replaced,
  };
}
