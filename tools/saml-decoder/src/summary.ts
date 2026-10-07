import { NS_ASSERTION, NS_PROTOCOL, attr, childrenNamed, firstNamed, wholeText } from './dom';

export type SamlKind = 'AuthnRequest' | 'Response' | 'LogoutRequest' | 'LogoutResponse' | 'Assertion' | 'other';

export interface SamlSummary {
  kind: SamlKind;
  /** The message type in words. */
  kindLabel: string;
  /** The summary as rows of name and value. */
  pairs: [string, string][];
}

function protocolKind(localName: string): SamlKind {
  if (localName === 'AuthnRequest') return 'AuthnRequest';
  if (localName === 'Response') return 'Response';
  if (localName === 'LogoutRequest') return 'LogoutRequest';
  if (localName === 'LogoutResponse') return 'LogoutResponse';
  return 'other';
}

/** Reads the message the document holds into a short summary. Nothing in it is checked: it is the XML as written. */
export function summarize(document: Document): SamlSummary {
  const root = document.documentElement;
  const isProtocol = root.namespaceURI === NS_PROTOCOL;
  const isAssertion = root.namespaceURI === NS_ASSERTION && root.localName === 'Assertion';
  const kind: SamlKind = isProtocol ? protocolKind(root.localName) : isAssertion ? 'Assertion' : 'other';
  const kindLabel = kind === 'other' ? 'A SAML 2.0 element this summary does not cover' : `SAML 2.0 ${kind}`;
  const pairs: [string, string][] = [['Message', kindLabel]];
  for (const name of ['ID', 'Version', 'IssueInstant', 'Destination', 'InResponseTo']) {
    const value = attr(root, name);
    if (value !== undefined) pairs.push([name, value]);
  }
  const issuer = firstNamed(root, NS_ASSERTION, 'Issuer');
  if (issuer) pairs.push(['Issuer', wholeText(issuer).trim()]);
  if (kind === 'LogoutRequest') {
    const nameId = firstNamed(root, NS_ASSERTION, 'NameID');
    if (nameId) pairs.push(['Name identifier', wholeText(nameId).trim()]);
    for (const index of childrenNamed(root, NS_PROTOCOL, 'SessionIndex'))
      pairs.push(['SessionIndex', wholeText(index).trim()]);
  }
  return { kind, kindLabel, pairs };
}
