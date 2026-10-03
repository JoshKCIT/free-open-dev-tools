/**
 * Distinguished names (RFC 5280 section 4.1.2.4): a SEQUENCE of RDNs, each a SET of attribute type and value pairs.
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
  name: string;
  value: string;
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
      let value: string;
      try {
        const text = derString(bytes, valueNode);
        value = text.text;
        if (text.replaced) replaced = true;
      } catch (err) {
        if (!(err instanceof DerError)) throw err;
        value = '#' + derHex(bytes.subarray(valueNode.start, valueNode.end));
      }
      attributes.push({ name: oidName(oid) ?? oid, value });
    }
    rdns.push(attributes);
  }
  const written = (rdn: Attribute[]): string => rdn.map((a) => `${a.name}=${a.value}`).join(' + ');
  return {
    display: rdns.map(written).join(', '),
    rfc4514: [...rdns]
      .reverse()
      .map((rdn) => rdn.map((a) => `${a.name}=${a.value}`).join('+'))
      .join(','),
    der: bytes.subarray(node.start, node.end),
    replaced,
  };
}
