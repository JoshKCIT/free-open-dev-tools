/**
 * Certificate extensions (RFC 5280 section 4.2). Twelve have a decoder; every other one is shown as its object identifier,
 * its critical flag and the hex of its bytes up to 256 bytes. A decoder that cannot read its extension never stops the
 * certificate: the extension is shown as hex with one plain note.
 *
 * Every address an extension names (CRL, OCSP, CA issuers, policy statements) stays text: nothing here, or anywhere in this
 * package, fetches, links or loads one.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import {
  DerError,
  derBitString,
  derChild,
  derContent,
  derExpect,
  derOid,
  derString,
  derUnsigned,
  readDer,
  type DerNode,
} from './der';
import { generalNamesOf, readGeneralName, readGeneralNames, type GeneralNameInfo } from './general-names';
import { cappedHex, colonHex, decimalOf, integerHex } from './hex';
import { OID_NAMES, oidLabel } from './oids';

export interface ExtensionInfo {
  oid: string;
  /** The name of the extension when this package knows its identifier. */
  name?: string;
  critical: boolean;
  /** The decoded lines, or the hex of the bytes when there is no decoder or the decoder could not read them. */
  value: string[];
  /** True when the lines are a decoding of the bytes. */
  decoded: boolean;
  /** One plain sentence, only when a decoder could not read its extension. */
  note?: string;
  /** For the subject and authority key identifiers: the key identifier as colon hex. */
  keyId?: string;
  /** For subject alternative names: the names, so the page can list them one by one. */
  names?: GeneralNameInfo[];
}

export type ExtensionDecoder = (bytes: Uint8Array, node: DerNode) => string[];

/** The most lines one extension shows; the rest are counted in one last line. */
export const MAX_EXTENSION_LINES = 200;

export const DECODE_NOTE = 'This extension could not be decoded; its bytes are shown.';

const KEY_USAGE_NAMES = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

const REASON_NAMES = [
  'unused',
  'keyCompromise',
  'cACompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'certificateHold',
  'privilegeWithdrawn',
  'aACompromise',
];

const TLS_FEATURES = new Map<string, string>([
  ['5', 'status_request'],
  ['17', 'status_request_v2'],
]);

const SUBJECT_ALT_NAME = '2.5.29.17';
const SUBJECT_KEY_IDENTIFIER = '2.5.29.14';
const AUTHORITY_KEY_IDENTIFIER = '2.5.29.35';

/** A BOOLEAN where any non-zero byte is true: real certificates write 01 as well as ff (X.690 section 11.1 says ff). */
function lenientBoolean(bytes: Uint8Array, node: DerNode): boolean {
  derExpect(node, 1, 'universal', false);
  const content = derContent(bytes, node);
  if (content.length !== 1) throw new DerError(`The BOOLEAN at offset ${node.start} must be one byte.`, node.start);
  return content[0] !== 0;
}

const nameLine = (name: GeneralNameInfo): string => `${name.type}: ${name.value}`;

/** The set bits of a BIT STRING that names flags, in order. */
function flagNames(bytes: Uint8Array, node: DerNode, names: string[]): string[] {
  const bits = derBitString(bytes, node);
  const total = bits.bytes.length * 8 - bits.unusedBits;
  const found: string[] = [];
  for (let i = 0; i < Math.min(total, names.length); i++) {
    if ((bits.bytes[i >> 3]! & (0x80 >> (i & 7))) !== 0) found.push(names[i]!);
  }
  return found;
}

function keyIdentifier(bytes: Uint8Array, node: DerNode): string {
  derExpect(node, 4, 'universal', false);
  return colonHex(derContent(bytes, node));
}

function authorityKeyIdentifierOf(bytes: Uint8Array, node: DerNode): string | undefined {
  derExpect(node, 16, 'universal', true);
  const field = node.children.find((child) => child.cls === 'context' && child.tag === 0);
  return field === undefined ? undefined : colonHex(derContent(bytes, field));
}

function displayText(bytes: Uint8Array, node: DerNode): string {
  return derString(bytes, node).text;
}

/** One qualifier of a certificate policy: a CPS address, a user notice, or something else shown in hex. */
function policyQualifier(bytes: Uint8Array, node: DerNode): string[] {
  derExpect(node, 16, 'universal', true);
  const id = derOid(bytes, derChild(node, 0));
  const qualifier = derChild(node, 1);
  if (id === '1.3.6.1.5.5.7.2.1') return [`CPS: ${displayText(bytes, qualifier)}`];
  if (id === '1.3.6.1.5.5.7.2.2') {
    derExpect(qualifier, 16, 'universal', true);
    const lines: string[] = [];
    for (const part of qualifier.children) {
      if (part.cls === 'universal' && part.tag === 16) {
        const numbers = derChild(part, 1).children.map((n) => decimalOf(derUnsigned(bytes, n)));
        lines.push(`Notice reference: ${displayText(bytes, derChild(part, 0))}, numbers ${numbers.join(', ')}`);
      } else {
        lines.push(`User notice: ${displayText(bytes, part)}`);
      }
    }
    return lines;
  }
  return [`${oidLabel(id)}: ${cappedHex(bytes.subarray(qualifier.start, qualifier.end))}`];
}

/** A GeneralSubtree list of a name constraint: the base name, and the distances only when they are written. */
function subtreeLines(bytes: Uint8Array, group: DerNode, word: string): string[] {
  const lines: string[] = [];
  for (const subtree of group.children) {
    derExpect(subtree, 16, 'universal', true);
    const base = readGeneralName(bytes, derChild(subtree, 0), true);
    let distances = '';
    for (const part of subtree.children.slice(1)) {
      if (part.cls !== 'context') continue;
      const number = decimalOf(derUnsigned(bytes, { ...part, tag: 2, cls: 'universal' }));
      distances += `${distances === '' ? ' (' : ', '}${part.tag === 0 ? 'minimum' : 'maximum'} ${number}`;
    }
    lines.push(`${word}: ${nameLine(base)}${distances === '' ? '' : distances + ')'}`);
  }
  return lines;
}

function distributionPoints(bytes: Uint8Array, node: DerNode): string[] {
  derExpect(node, 16, 'universal', true);
  const lines: string[] = [];
  for (const point of node.children) {
    derExpect(point, 16, 'universal', true);
    for (const field of point.children) {
      if (field.cls !== 'context') continue;
      if (field.tag === 0) {
        for (const choice of field.children) {
          if (choice.cls === 'context' && choice.tag === 0) {
            for (const name of generalNamesOf(bytes, choice)) lines.push(`Full name: ${nameLine(name)}`);
          } else if (choice.cls === 'context' && choice.tag === 1) {
            lines.push(`Relative name: ${cappedHex(derContent(bytes, choice))}`);
          }
        }
      } else if (field.tag === 1) {
        lines.push(`Reasons: ${flagNames(bytes, { ...field, tag: 3, cls: 'universal' }, REASON_NAMES).join(', ')}`);
      } else if (field.tag === 2) {
        for (const name of generalNamesOf(bytes, field)) lines.push(`CRL issuer: ${nameLine(name)}`);
      }
    }
  }
  return lines;
}

/** The decoders, by the dotted identifier of the extension. A Map, so no name can be mistaken for a prototype member. */
export const EXTENSION_DECODERS: ReadonlyMap<string, ExtensionDecoder> = new Map<string, ExtensionDecoder>([
  [
    '2.5.29.19',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      let ca = false;
      let pathLength: string | undefined;
      for (const child of node.children) {
        if (child.cls === 'universal' && child.tag === 1) ca = lenientBoolean(bytes, child);
        else if (child.cls === 'universal' && child.tag === 2)
          pathLength = decimalOf(derUnsigned(bytes, child));
        else
          throw new DerError(
            `The basic constraints at offset ${node.start} hold an element of the wrong kind.`,
            node.start,
          );
      }
      return [`CA:${ca ? 'TRUE' : 'FALSE'}${pathLength === undefined ? '' : `, pathlen:${pathLength}`}`];
    },
  ],
  [
    '2.5.29.15',
    (bytes, node) => {
      const names = flagNames(bytes, node, KEY_USAGE_NAMES);
      return [names.length === 0 ? '(no usage is set)' : names.join(', ')];
    },
  ],
  [
    '2.5.29.37',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      return node.children.map((child) => oidLabel(derOid(bytes, child)));
    },
  ],
  [SUBJECT_KEY_IDENTIFIER, (bytes, node) => [keyIdentifier(bytes, node)]],
  [
    AUTHORITY_KEY_IDENTIFIER,
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      const lines: string[] = [];
      for (const field of node.children) {
        if (field.cls !== 'context') continue;
        if (field.tag === 0) lines.push(`Key identifier: ${colonHex(derContent(bytes, field))}`);
        else if (field.tag === 1)
          for (const name of generalNamesOf(bytes, field)) lines.push(`Issuer: ${nameLine(name)}`);
        else if (field.tag === 2) lines.push(`Serial number: ${integerHex(derContent(bytes, field))}`);
      }
      return lines;
    },
  ],
  [SUBJECT_ALT_NAME, (bytes, node) => readGeneralNames(bytes, node).map(nameLine)],
  ['2.5.29.18', (bytes, node) => readGeneralNames(bytes, node).map(nameLine)],
  ['2.5.29.31', distributionPoints],
  [
    '1.3.6.1.5.5.7.1.1',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      return node.children.map((description) => {
        derExpect(description, 16, 'universal', true);
        const method = oidLabel(derOid(bytes, derChild(description, 0)));
        const location = readGeneralName(bytes, derChild(description, 1));
        return `${method} - ${nameLine(location)}`;
      });
    },
  ],
  [
    '2.5.29.32',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      const lines: string[] = [];
      for (const policy of node.children) {
        derExpect(policy, 16, 'universal', true);
        const id = derOid(bytes, derChild(policy, 0));
        const name = OID_NAMES.get(id);
        lines.push(`Policy: ${name === undefined ? id : `${name} (${id})`}`);
        const qualifiers = policy.children[1];
        if (qualifiers !== undefined) {
          derExpect(qualifiers, 16, 'universal', true);
          for (const qualifier of qualifiers.children) lines.push(...policyQualifier(bytes, qualifier));
        }
      }
      return lines;
    },
  ],
  [
    '2.5.29.30',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      const lines: string[] = [];
      for (const group of node.children) {
        if (group.cls !== 'context') continue;
        if (group.tag === 0) lines.push(...subtreeLines(bytes, group, 'Permitted'));
        else if (group.tag === 1) lines.push(...subtreeLines(bytes, group, 'Excluded'));
      }
      return lines;
    },
  ],
  [
    '1.3.6.1.5.5.7.1.24',
    (bytes, node) => {
      derExpect(node, 16, 'universal', true);
      return node.children.map((child) => {
        const number = decimalOf(derUnsigned(bytes, child));
        return TLS_FEATURES.get(number) ?? number;
      });
    },
  ],
]);

function capLines(lines: string[]): string[] {
  if (lines.length <= MAX_EXTENSION_LINES) return lines;
  const more = lines.length - MAX_EXTENSION_LINES;
  return [...lines.slice(0, MAX_EXTENSION_LINES), `and ${more} more lines are not shown.`];
}

/**
 * The extensions of a certificate, from the SEQUENCE inside the [3] field. An extension whose envelope is malformed stops
 * the reading (a DerError), because nothing after it can be found; one whose value a decoder cannot read is shown as hex.
 */
export function readExtensions(bytes: Uint8Array, node: DerNode): ExtensionInfo[] {
  derExpect(node, 16, 'universal', true);
  const out: ExtensionInfo[] = [];
  for (const entry of node.children) {
    derExpect(entry, 16, 'universal', true);
    const oid = derOid(bytes, derChild(entry, 0));
    let at = 1;
    let critical = false;
    const flag = derChild(entry, 1);
    if (flag.cls === 'universal' && flag.tag === 1) {
      critical = lenientBoolean(bytes, flag);
      at = 2;
    }
    const wrapper = derChild(entry, at);
    derExpect(wrapper, 4, 'universal', false);
    const content = derContent(bytes, wrapper);
    const name = OID_NAMES.get(oid);
    const base: ExtensionInfo = { oid, critical, value: [], decoded: false };
    if (name !== undefined) base.name = name;
    const decoder = EXTENSION_DECODERS.get(oid);
    if (decoder === undefined) {
      out.push({ ...base, value: [cappedHex(content)] });
      continue;
    }
    try {
      const inner = readDer(content);
      const info: ExtensionInfo = { ...base, value: capLines(decoder(content, inner)), decoded: true };
      if (oid === SUBJECT_KEY_IDENTIFIER) info.keyId = keyIdentifier(content, inner);
      if (oid === AUTHORITY_KEY_IDENTIFIER) {
        const id = authorityKeyIdentifierOf(content, inner);
        if (id !== undefined) info.keyId = id;
      }
      if (oid === SUBJECT_ALT_NAME) info.names = readGeneralNames(content, inner);
      out.push(info);
    } catch {
      // A decoder that cannot read its extension, for any reason, leaves the certificate whole.
      out.push({ ...base, value: [cappedHex(content)], note: DECODE_NOTE });
    }
  }
  return out;
}
