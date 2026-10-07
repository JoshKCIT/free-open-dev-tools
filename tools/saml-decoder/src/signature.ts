import { NS_DS, allElements, attr, childrenNamed, firstNamed, isNamed, wholeText } from './dom';
import { MAX_NOTES, MAX_ROWS_SHOWN } from './limits';
import { visible } from './visible';

/** Where a Reference of a ds:Signature points, from the message alone. */
export type ReferenceTarget =
  'parent' | 'other' | 'missing' | 'duplicate' | 'document' | 'outside' | 'none' | 'xpointer';

export interface ReferenceInfo {
  /** The URI attribute as written, or `null` when the Reference has none. */
  uri: string | null;
  points: ReferenceTarget;
  /** The name and ID of the element another element's ID reached, for a Reference that points elsewhere. */
  target?: string;
  transforms: string[];
  digestMethod?: string;
}

export interface SignatureInfo {
  /** 1-based, in document order. */
  index: number;
  /** The qualified name of the element the signature sits in. */
  parent: string;
  parentId?: string;
  canonicalization?: string;
  signatureMethod?: string;
  references: ReferenceInfo[];
}

export interface SignatureReport {
  signatures: SignatureInfo[];
  headers: string[];
  /** One row per Reference (or one per signature that has none). Each row says it is present and not verified. */
  rows: string[][];
  /** Rows not shown because the table is capped. */
  omitted: number;
  notes: string[];
  /** The elements the Signatures say they cover: `saml:Assertion identifier_3`. */
  signedElements: string[];
  /** The first X509Certificate, re-wrapped as PEM text. It is only text: nothing in it is read. */
  certificatePem?: string;
}

const HEADERS = ['Signature', 'Parent element', 'Parent ID', 'Reference URI', 'Points at', 'Methods', 'Status'];
const MAX_SIGNATURES = 100;
const MAX_CERTIFICATE_CHARACTERS = 200_000;
const SHOWN = 200;

const SIGNATURE_ALGORITHMS: ReadonlyMap<string, string> = new Map([
  ['http://www.w3.org/2000/09/xmldsig#rsa-sha1', 'RSA with SHA-1'],
  ['http://www.w3.org/2000/09/xmldsig#dsa-sha1', 'DSA with SHA-1'],
  ['http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', 'RSA with SHA-256'],
  ['http://www.w3.org/2001/04/xmldsig-more#rsa-sha384', 'RSA with SHA-384'],
  ['http://www.w3.org/2001/04/xmldsig-more#rsa-sha512', 'RSA with SHA-512'],
  ['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256', 'ECDSA with SHA-256'],
  ['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384', 'ECDSA with SHA-384'],
  ['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512', 'ECDSA with SHA-512'],
]);

const DIGEST_ALGORITHMS: ReadonlyMap<string, string> = new Map([
  ['http://www.w3.org/2000/09/xmldsig#sha1', 'SHA-1'],
  ['http://www.w3.org/2001/04/xmlenc#sha256', 'SHA-256'],
  ['http://www.w3.org/2001/04/xmldsig-more#sha384', 'SHA-384'],
  ['http://www.w3.org/2001/04/xmlenc#sha512', 'SHA-512'],
]);

const CANONICALIZATIONS: ReadonlyMap<string, string> = new Map([
  ['http://www.w3.org/2001/10/xml-exc-c14n#', 'Exclusive XML Canonicalization 1.0'],
  ['http://www.w3.org/2001/10/xml-exc-c14n#WithComments', 'Exclusive XML Canonicalization 1.0 with comments'],
  ['http://www.w3.org/TR/2001/REC-xml-c14n-20010315', 'Canonical XML 1.0'],
  ['http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments', 'Canonical XML 1.0 with comments'],
  ['http://www.w3.org/2006/12/xml-c14n11', 'Canonical XML 1.1'],
]);

const TRANSFORMS: ReadonlyMap<string, string> = new Map([
  ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'enveloped signature'],
  ...CANONICALIZATIONS,
]);

/**
 * Names a signature algorithm address as the XML Signature documents define it, or says it is not one this page knows. The
 * address itself is never changed or corrected: a misspelt one is shown as written.
 */
export function describeSignatureAlgorithm(uri: string): string {
  const known = SIGNATURE_ALGORITHMS.get(uri);
  return known ?? 'Not an address this page knows as a signature algorithm.';
}

function nameOf(uri: string | undefined, table: ReadonlyMap<string, string>): string {
  if (uri === undefined) return 'not written';
  const known = table.get(uri);
  return known === undefined ? `${visible(uri, SHOWN)} (an address this page does not know)` : known;
}

/** The qualified name of an element and its ID, as a short label. */
function label(element: Element): string {
  const id = attr(element, 'ID');
  return id === undefined ? element.tagName : `${element.tagName} ${id}`;
}

function insideSignature(element: Element): boolean {
  let node = element.parentNode;
  for (let depth = 0; node !== null && depth < 200; depth++) {
    if (node.nodeType === 1 && isNamed(node as Element, NS_DS, 'Signature')) return true;
    node = node.parentNode;
  }
  return false;
}

function pemOf(text: string): string | null {
  let compact = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) continue;
    const ok =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47 ||
      code === 61;
    if (!ok) return null;
    compact += text[i];
  }
  if (compact.length < 4 || compact.length > MAX_CERTIFICATE_CHARACTERS) return null;
  const lines: string[] = ['-----BEGIN CERTIFICATE-----'];
  for (let i = 0; i < compact.length; i += 64) lines.push(compact.slice(i, i + 64));
  lines.push('-----END CERTIFICATE-----');
  return lines.join('\n');
}

/**
 * Lists every ds:Signature of the message as present and not verified: the element it sits in, its ID, and for each Reference
 * the URI and where it points. A Reference that points at some other element than the one the signature sits in, at no element
 * at all, or at several, is the shape a signature-wrapping attack takes, and is noted. Nothing is computed: no digest, no
 * canonicalisation, no certificate is read.
 */
export function describeSignatures(document: Document): SignatureReport {
  const root = document.documentElement;
  const elements = allElements(root);
  const ids = new Map<string, Element[]>();
  for (const element of elements) {
    const id = attr(element, 'ID');
    if (id === undefined) continue;
    const list = ids.get(id);
    if (list) list.push(element);
    else ids.set(id, [element]);
  }
  const signatures: SignatureInfo[] = [];
  const rows: string[][] = [];
  const notes: string[] = [];
  const signedElements: string[] = [];
  let omitted = 0;
  let certificateElements = 0;
  let firstCertificate: string | null = null;
  const note = (text: string): void => {
    if (notes.length < MAX_NOTES && !notes.includes(text)) notes.push(text);
  };
  let total = 0;
  for (const element of elements) {
    if (!isNamed(element, NS_DS, 'Signature') || insideSignature(element)) continue;
    total++;
    if (signatures.length >= MAX_SIGNATURES) continue;
    const index = signatures.length + 1;
    const parent =
      element.parentNode !== null && element.parentNode.nodeType === 1 ? (element.parentNode as Element) : null;
    const info: SignatureInfo = {
      index,
      parent: parent ? parent.tagName : '(the document)',
      references: [],
    };
    const parentId = parent ? attr(parent, 'ID') : undefined;
    if (parentId !== undefined) info.parentId = parentId;
    const signedInfo = firstNamed(element, NS_DS, 'SignedInfo');
    if (signedInfo === null) {
      note(`Signature ${index} holds no SignedInfo, so nothing it covers can be listed.`);
    } else {
      const canonical = firstNamed(signedInfo, NS_DS, 'CanonicalizationMethod');
      const method = firstNamed(signedInfo, NS_DS, 'SignatureMethod');
      const canonicalUri = canonical ? attr(canonical, 'Algorithm') : undefined;
      const methodUri = method ? attr(method, 'Algorithm') : undefined;
      if (canonicalUri !== undefined) info.canonicalization = canonicalUri;
      if (methodUri !== undefined) info.signatureMethod = methodUri;
      for (const reference of childrenNamed(signedInfo, NS_DS, 'Reference')) {
        const uri = reference.hasAttribute('URI') ? (attr(reference, 'URI') ?? '') : null;
        const transforms: string[] = [];
        const transformList = firstNamed(reference, NS_DS, 'Transforms');
        if (transformList) {
          for (const transform of childrenNamed(transformList, NS_DS, 'Transform')) {
            const algorithm = attr(transform, 'Algorithm');
            if (algorithm !== undefined) transforms.push(algorithm);
          }
        }
        const digest = firstNamed(reference, NS_DS, 'DigestMethod');
        const entry: ReferenceInfo = { uri, points: 'none', transforms };
        const digestUri = digest ? attr(digest, 'Algorithm') : undefined;
        if (digestUri !== undefined) entry.digestMethod = digestUri;
        if (uri === null) {
          entry.points = 'none';
          note(`Signature ${index} has a Reference with no URI, so the receiving application decides what it covers.`);
        } else if (uri === '') {
          entry.points = parent === root ? 'parent' : 'document';
          if (entry.points === 'document') {
            note(
              `Signature ${index} has an empty Reference URI, which means the whole document, but it sits in ${parent ? parent.tagName : 'no element'} and not at the root: a signature-wrapping shape.`,
            );
          }
        } else if (uri.startsWith('#xpointer(')) {
          entry.points = 'xpointer';
          note(
            `Signature ${index} points at its target with an XPointer, which this page does not resolve: read the XML.`,
          );
        } else if (uri.startsWith('#')) {
          const matches = ids.get(uri.slice(1)) ?? [];
          if (matches.length === 0) {
            entry.points = 'missing';
            note(
              `Signature ${index} has a Reference to an ID that no element of the message holds: a signature-wrapping shape, or a reference outside the message.`,
            );
          } else if (matches.length > 1) {
            entry.points = 'duplicate';
            note(
              `More than one element holds the ID that a Reference of signature ${index} points at: a signature-wrapping shape.`,
            );
          } else if (matches[0] === parent) {
            entry.points = 'parent';
          } else {
            entry.points = 'other';
            entry.target = label(matches[0]!);
            note(
              `Signature ${index} has a Reference that points at ${visible(entry.target, 80)}, not at the element it sits in: a signature-wrapping shape.`,
            );
          }
        } else {
          entry.points = 'outside';
          note(`Signature ${index} has a Reference that points outside the message.`);
        }
        info.references.push(entry);
        if (entry.points === 'parent' && parent) signedElements.push(label(parent));
        else if (entry.points === 'other' && entry.target) signedElements.push(entry.target);
        else if (entry.points === 'document') signedElements.push('the whole document');
      }
      if (info.references.length === 0)
        note(`Signature ${index} has no Reference, so it covers nothing that can be listed.`);
    }
    const methods = `${nameOf(info.canonicalization, CANONICALIZATIONS)}; ${nameOf(info.signatureMethod, SIGNATURE_ALGORITHMS)}`;
    const keyInfo = firstNamed(element, NS_DS, 'KeyInfo');
    if (keyInfo) {
      for (const data of childrenNamed(keyInfo, NS_DS, 'X509Data')) {
        for (const certificate of childrenNamed(data, NS_DS, 'X509Certificate')) {
          certificateElements++;
          if (firstCertificate === null) firstCertificate = wholeText(certificate);
        }
      }
    }
    const base = [String(index), info.parent, info.parentId ?? '(none)'];
    const pointText = (reference: ReferenceInfo): string => {
      if (reference.points === 'parent') return 'its parent element';
      if (reference.points === 'other') return `another element: ${visible(reference.target ?? '', 80)}`;
      if (reference.points === 'missing') return 'no element of this message has that ID';
      if (reference.points === 'duplicate') return 'more than one element has that ID';
      if (reference.points === 'document') return 'the whole document';
      if (reference.points === 'outside') return 'outside the message';
      if (reference.points === 'xpointer') return 'an XPointer (not resolved here)';
      return 'no URI written';
    };
    const addRow = (cells: string[]): void => {
      if (rows.length < MAX_ROWS_SHOWN) rows.push([...base, ...cells, 'Present, not verified']);
      else omitted++;
    };
    if (info.references.length === 0) addRow(['(none)', 'no Reference written', methods]);
    for (const reference of info.references) {
      const transforms = reference.transforms.map((t) => nameOf(t, TRANSFORMS)).join(', ');
      const digest = nameOf(reference.digestMethod, DIGEST_ALGORITHMS);
      addRow([
        reference.uri === null ? '(none)' : visible(reference.uri, SHOWN),
        pointText(reference),
        `${methods}; digest ${digest}${transforms === '' ? '' : `; transforms ${transforms}`}`,
      ]);
    }
    signatures.push(info);
  }
  if (total > signatures.length) {
    note(`The message holds ${total} signatures; the first ${signatures.length} are listed.`);
  }
  const report: SignatureReport = { signatures, headers: HEADERS, rows, omitted, notes, signedElements };
  if (firstCertificate !== null) {
    const pem = pemOf(firstCertificate);
    if (pem === null) note('The text of the first certificate is not Base64, so it is not shown as PEM.');
    else report.certificatePem = pem;
    if (certificateElements > 1) {
      note(
        `The signatures hold ${certificateElements} certificates; only the first certificate is shown, as PEM text that this page does not read.`,
      );
    }
  }
  return report;
}
