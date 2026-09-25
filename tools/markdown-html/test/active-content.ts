/**
 * An independent, test-only checker for active content left behind in HTML
 * or SVG markup. Deliberately re-implements the sanitiser's rules from
 * scratch rather than importing them, so a bug shared between the sanitiser
 * and this checker cannot hide from the tests that use it. Never imported by
 * package source. Canonical, copied byte for byte into every tool that needs
 * the same check; this header names no tool folder so it stays true wherever
 * it lands.
 */
import type { WindowLike } from 'dompurify';
import type { MarkupProfile } from '../src/sanitise';

/** Data image MIME types small enough, and safe enough, to keep inline. */
const ALLOWED_DATA_IMAGE_TYPES = ['png', 'gif', 'jpeg', 'webp'];

/** Elements that must never survive sanitising, compared by local name (a namespace prefix cannot hide one). */
const FORBIDDEN_ELEMENT_LOCAL_NAMES = new Set([
  'script',
  'foreignobject',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
]);

const REFERENCE_ATTR_NAMES = new Set(['src', 'href', 'xlink:href']);

function localName(name: string): string {
  const idx = name.indexOf(':');
  return (idx === -1 ? name : name.slice(idx + 1)).toLowerCase();
}

/** Removes ASCII whitespace and C0/C1 control characters, the way a browser does before reading a URL scheme. */
function stripWhitespaceAndControls(value: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  return value.replace(/[\x00-\x20\x7f-\x9f]+/g, '');
}

function isFragmentReference(cleaned: string): boolean {
  return cleaned.startsWith('#');
}

function isAllowedDataImage(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith('data:image/')) return false;
  const afterType = lower.slice('data:image/'.length);
  const type = afterType.split(/[;,]/, 1)[0] ?? '';
  return ALLOWED_DATA_IMAGE_TYPES.includes(type) && lower.includes(';base64,');
}

function isDangerousUrlValue(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return true;
  if (lower.startsWith('data:') && !isAllowedDataImage(cleaned)) return true;
  return false;
}

function isDangerousCss(rawValue: string): boolean {
  const collapsed = rawValue.toLowerCase().replace(/\s+/g, '');
  if (collapsed.includes('\\')) return true;
  if (collapsed.includes('@import')) return true;
  if (collapsed.includes('expression(')) return true;
  if (collapsed.includes('-moz-binding')) return true;
  if (collapsed.includes('behavior:')) return true;
  for (const match of collapsed.matchAll(/url\(([^)]*)\)/g)) {
    const target = (match[1] ?? '').replace(/^['"]|['"]$/g, '');
    if (isFragmentReference(target) || isAllowedDataImage(target)) continue;
    return true;
  }
  return false;
}

function describeNode(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  return `<${el.tagName.toLowerCase()}${id}>`;
}

function walk(root: Element, violations: string[], profile: MarkupProfile): void {
  const local = localName(root.tagName);

  if (FORBIDDEN_ELEMENT_LOCAL_NAMES.has(local)) {
    violations.push(`forbidden element ${describeNode(root)}`);
  }

  if (local === 'style') {
    const text = root.textContent ?? '';
    if (text.trim() !== '' && isDangerousCss(text)) {
      violations.push(`dangerous style element content in ${describeNode(root)}`);
    }
  }

  for (const attr of Array.from(root.attributes)) {
    const attrLocal = localName(attr.name);
    const rawNameLower = attr.name.toLowerCase();
    const value = attr.value ?? '';

    if (attrLocal.startsWith('on')) {
      violations.push(`event handler attribute "${attr.name}" on ${describeNode(root)}`);
      continue;
    }

    if (REFERENCE_ATTR_NAMES.has(rawNameLower)) {
      const cleaned = stripWhitespaceAndControls(value);
      const isAnchorHrefInHtml = profile === 'html' && local === 'a' && rawNameLower === 'href';
      if (isAnchorHrefInHtml) {
        // The one reference exception (sanitise.ts rule 3): an ordinary
        // link may point anywhere DOMPurify's own default safe-URI rule
        // allows (http, https, mailto, relative, fragment); only a
        // dangerous scheme is a violation here.
        if (isDangerousUrlValue(cleaned)) {
          violations.push(`dangerous URL in "${attr.name}" on ${describeNode(root)}`);
        }
      } else if (isDangerousUrlValue(cleaned)) {
        violations.push(`dangerous URL in "${attr.name}" on ${describeNode(root)}`);
      } else if (!isFragmentReference(cleaned) && !isAllowedDataImage(cleaned)) {
        violations.push(`external reference in "${attr.name}" on ${describeNode(root)}`);
      }
      continue;
    }

    if (attrLocal === 'style') {
      if (isDangerousCss(value)) {
        violations.push(`dangerous style attribute on ${describeNode(root)}`);
      }
      continue;
    }

    if (value.toLowerCase().includes('url(') && isDangerousCss(value)) {
      violations.push(`dangerous url() in "${attr.name}" on ${describeNode(root)}`);
    }
  }

  for (const child of Array.from(root.children)) {
    walk(child, violations, profile);
  }
}

/**
 * Parses `markup` with `win.DOMParser` (an HTML fragment wrapped in a body
 * for the `html` profile, or `image/svg+xml` for the `svg` profile) and
 * returns one plain violation string per piece of active content found: a
 * forbidden element, an event handler attribute, a dangerous URL scheme, an
 * external reference, or a dangerous style. An empty array means the markup
 * is safe by every rule this checker knows.
 */
export function findActiveContent(markup: string, win: WindowLike, profile: MarkupProfile): string[] {
  const violations: string[] = [];
  const parser = new win.DOMParser();

  if (profile === 'svg') {
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const parserError = doc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      violations.push(`markup did not parse as well-formed XML: ${parserError.textContent ?? ''}`.trim());
      return violations;
    }
    if (doc.documentElement) walk(doc.documentElement, violations, profile);
    return violations;
  }

  const doc = parser.parseFromString(`<!doctype html><body>${markup}</body>`, 'text/html');
  if (doc.body) walk(doc.body, violations, profile);
  return violations;
}
