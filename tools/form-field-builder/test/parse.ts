/**
 * Test helper around parse5 (the HTML Living Standard's own tokenizer and tree
 * construction rules). Test code only: nothing here ships in the package.
 *
 * - parse(html): the fragment plus every parse error code it reported
 * - shape(frag): nested tag names and attribute names only, so two outputs can
 *   be compared for structure while their text and values differ
 * - findAll, attrOf, textOf: small tree readers
 * - accName: a small name function that follows HTML-AAM 4.1.1 to 4.1.7
 * - HOSTILE: values that must come out as text and never change the structure
 */
import * as parse5 from 'parse5';

type ParsedNode = parse5.DefaultTreeAdapterMap['node'];
export type ParsedElement = parse5.DefaultTreeAdapterMap['element'];
export type ParsedFragment = parse5.DefaultTreeAdapterMap['documentFragment'];

export function parse(html: string): { frag: ParsedFragment; errors: string[] } {
  const errors: string[] = [];
  const frag = parse5.parseFragment(html, { onParseError: (e) => errors.push(e.code) });
  return { frag, errors };
}

function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node;
}

function childrenOf(node: ParsedNode): ParsedNode[] {
  // A template element keeps its children in a separate content fragment.
  if (isElement(node) && node.tagName === 'template' && 'content' in node) {
    return (node as unknown as { content: ParsedFragment }).content.childNodes;
  }
  return 'childNodes' in node ? (node.childNodes as ParsedNode[]) : [];
}

/** Nested tag names and attribute names only; whitespace-only text is ignored. */
export function shape(node: ParsedNode): string {
  const parts: string[] = [];
  const walk = (n: ParsedNode): void => {
    if (isElement(n)) {
      parts.push(`<${n.tagName}[${n.attrs.map((a) => a.name).join(',')}]`);
      for (const c of childrenOf(n)) walk(c);
      parts.push('>');
    } else if (n.nodeName === '#text') {
      const v = (n as parse5.DefaultTreeAdapterMap['textNode']).value;
      if (v.trim() !== '') parts.push('#');
    }
  };
  for (const c of childrenOf(node)) walk(c);
  return parts.join('');
}

export function findAll(node: ParsedNode, tag: string): ParsedElement[] {
  const out: ParsedElement[] = [];
  const walk = (n: ParsedNode): void => {
    for (const c of childrenOf(n)) {
      if (isElement(c)) {
        if (c.tagName === tag) out.push(c);
        walk(c);
      }
    }
  };
  walk(node);
  return out;
}

export function attrOf(node: ParsedElement, name: string): string | undefined {
  return node.attrs.find((a) => a.name === name)?.value;
}

export function textOf(node: ParsedNode): string {
  let out = '';
  const walk = (n: ParsedNode): void => {
    if (n.nodeName === '#text') out += (n as parse5.DefaultTreeAdapterMap['textNode']).value;
    else for (const c of childrenOf(n)) walk(c);
  };
  walk(node);
  return out;
}

function ancestors(frag: ParsedFragment, target: ParsedElement): ParsedElement[] {
  const path: ParsedElement[] = [];
  const walk = (n: ParsedNode, trail: ParsedElement[]): boolean => {
    for (const c of childrenOf(n)) {
      if (c === target) {
        path.push(...trail);
        return true;
      }
      if (isElement(c) && walk(c, [...trail, c])) return true;
    }
    return false;
  };
  walk(frag, []);
  return path;
}

/** The text of the labels that name a control: label[for] matching its id, and any wrapping label. */
function labelText(frag: ParsedFragment, control: ParsedElement): string {
  const id = attrOf(control, 'id');
  const labels: ParsedElement[] = [];
  if (id) for (const l of findAll(frag, 'label')) if (attrOf(l, 'for') === id) labels.push(l);
  for (const a of ancestors(frag, control)) if (a.tagName === 'label' && !labels.includes(a)) labels.push(a);
  return labels
    .map((l) => textOf(l).replace(/\s+/g, ' ').trim())
    .filter((t) => t !== '')
    .join(' ');
}

/**
 * A small accessible name function for the structures the builders write.
 * HTML-AAM 4.1.1 (text-like inputs, textarea): label, title, placeholder.
 * 4.1.2 (button, submit, reset): label, value, title; a button with no value
 * has no name. 4.1.3 (image): label, alt, title. 4.1.4 (button element):
 * label, then its own content. 4.1.5 (fieldset): its legend. 4.1.7 (other form
 * elements such as checkbox, radio, range, select, meter, progress): label,
 * then title. Returns null when no step gives a name.
 */
export function accName(frag: ParsedFragment, control: ParsedElement): string | null {
  const tag = control.tagName;
  const clean = (s: string | undefined): string | null => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
  };
  if (tag === 'fieldset') {
    const legend = findAll(control, 'legend')[0];
    return legend ? clean(textOf(legend)) : null;
  }
  const label = clean(labelText(frag, control));
  const title = clean(attrOf(control, 'title'));
  if (tag === 'button') return label ?? clean(textOf(control)) ?? title;
  if (tag === 'textarea') return label ?? title ?? clean(attrOf(control, 'placeholder'));
  if (tag !== 'input') return label ?? title;
  const type = (attrOf(control, 'type') ?? 'text').toLowerCase();
  switch (type) {
    case 'hidden':
      return null;
    case 'text':
    case 'password':
    case 'number':
    case 'search':
    case 'tel':
    case 'email':
    case 'url':
      return label ?? title ?? clean(attrOf(control, 'placeholder'));
    case 'button':
      return label ?? clean(attrOf(control, 'value')) ?? title;
    case 'submit':
      return label ?? clean(attrOf(control, 'value')) ?? title ?? 'Submit';
    case 'reset':
      return label ?? clean(attrOf(control, 'value')) ?? title ?? 'Reset';
    case 'image':
      return label ?? clean(attrOf(control, 'alt')) ?? title ?? 'Submit';
    default:
      return label ?? title;
  }
}

/** Values that must come out as inert text and never change a generated structure. */
export const HOSTILE: string[] = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  '" onmouseover="alert(1)',
  '</textarea><script>x</script>',
  '</style>',
];
