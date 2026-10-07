/** The XML namespaces SAML 2.0 messages are written in, and the XML Signature namespace. */
export const NS_PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const NS_ASSERTION = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
/** SAML 1.x namespaces: named so a message in them is refused with a plain reason. */
export const NS_SAML1_PROTOCOL = 'urn:oasis:names:tc:SAML:1.0:protocol';
export const NS_SAML1_ASSERTION = 'urn:oasis:names:tc:SAML:1.0:assertion';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
const COMMENT_NODE = 8;

/** The element children of an element, in document order. */
export function childElements(element: Element): Element[] {
  const out: Element[] = [];
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === ELEMENT_NODE) out.push(node as Element);
  }
  return out;
}

export function isNamed(element: Element, namespace: string, localName: string): boolean {
  return element.namespaceURI === namespace && element.localName === localName;
}

/** The children of an element with the given namespace and local name, in order. */
export function childrenNamed(element: Element, namespace: string, localName: string): Element[] {
  return childElements(element).filter((child) => isNamed(child, namespace, localName));
}

export function firstNamed(element: Element, namespace: string, localName: string): Element | null {
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === ELEMENT_NODE && isNamed(node as Element, namespace, localName)) return node as Element;
  }
  return null;
}

/** The value of an attribute written without a namespace, or `undefined` when it is not there. */
export function attr(element: Element, name: string): string | undefined {
  return element.hasAttribute(name) ? (element.getAttribute(name) ?? undefined) : undefined;
}

/** What the text children of an element hold, joined: the text a reader gets from the whole of its text. */
export function wholeText(element: Element): string {
  let out = '';
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) out += (node as CharacterData).data;
  }
  return out;
}

/** The data of the first child that is text, as a reader that stops at the first text node sees it. */
export function firstTextNode(element: Element): string {
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) return (node as CharacterData).data;
  }
  return '';
}

/** True when an element holds a comment or a processing instruction as a direct child. */
export function hasCommentChild(element: Element): boolean {
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]!.nodeType === COMMENT_NODE) return true;
  }
  return false;
}

/** True when an element holds text that is not only white space. */
export function hasRealText(element: Element): boolean {
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if ((node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) && (node as CharacterData).data.trim() !== '')
      return true;
  }
  return false;
}

/** The attributes of an element in the order they were written. */
export function attributesInOrder(element: Element): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const list = element.attributes;
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    out.push({ name: item.name, value: item.value });
  }
  return out;
}

/**
 * Every element of a document in document order, found with an explicit stack so nesting depth never decides how much
 * of the call stack is used.
 */
export function allElements(root: Element): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const element = stack.pop()!;
    out.push(element);
    const kids = childElements(element);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}
