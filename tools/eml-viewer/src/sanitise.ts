/**
 * A canonical DOMPurify wrapper, built once and copied byte for byte into
 * every tool that shows markup back to a visitor. Sanitises HTML or SVG
 * markup against the OWASP XSS Filter Evasion Cheat Sheet's attack classes
 * and advisory GHSA-2p49-hgcm-8545 (namespace-prefixed script tags and
 * case-varied URL schemes bypassing a naive sanitiser). Never names a tool
 * folder: this file describes a policy, not a page.
 *
 * Every call builds a fresh DOMPurify instance from the caller's own
 * `window` argument, so no hook or configuration can leak between calls.
 * If the instance reports it cannot do its job (no usable document), this
 * module fails closed with `SanitiserUnavailableError` rather than
 * DOMPurify's own default of returning the input unchanged.
 *
 * Policy, on top of DOMPurify's own HTML/SVG/SVG-filters profiles:
 * 1. A fixed list of elements is always removed regardless of profile
 *    (script -- any namespace prefix -- foreignObject, iframe, frame,
 *    frameset, object, embed, applet, base, link, meta, noscript,
 *    template, form, input, button, textarea, select, audio, video,
 *    source, track); `style` is also always removed in the `html` profile.
 * 2. Every event handler attribute is removed, explicitly, so a future
 *    change to DOMPurify's own default event-handler detection cannot
 *    quietly loosen this. A short list of legacy resource/navigation
 *    attributes (srcset, ping, action, formaction, background, poster,
 *    data, codebase, dynsrc, lowsrc) is removed outright.
 * 3. `src`, and `href`/`xlink:href` on any element, load something and are
 *    kept only when they point at a same-document fragment (`#id`) or a
 *    small base64 `data:image/{png,gif,jpeg,webp}` image; everything else
 *    is removed and counted as an external reference. The one exception:
 *    in the `html` profile, `a href` keeps DOMPurify's own default safe-URI
 *    rule (http, https, mailto, relative, fragment) so an ordinary link
 *    still works -- only a dangerous scheme on that one attribute is
 *    removed there, and counted separately.
 * 4. A `style` attribute, an SVG `style` element's text, or any other
 *    attribute whose value contains `url(`, is removed (or, for a `style`
 *    element, cleared) when it carries a backslash, `@import`,
 *    `expression(`, `-moz-binding`, `behavior:`, or a `url(...)` target
 *    that is not a fragment or an allowed data image.
 */
import createDOMPurify, { type WindowLike } from 'dompurify';

/** Which DOMPurify profile a call sanitises against. */
export type MarkupProfile = 'html' | 'svg';

/** Counts of what a sanitising pass removed, by category. */
export interface RemovedSummary {
  /** A forbidden element (script, foreignObject, iframe, an html-profile style element, ...). */
  elements: number;
  /** An `on*` event handler attribute. */
  eventHandlers: number;
  /** A `javascript:`/`vbscript:` URL, an unsafe `data:` value, or a legacy resource/navigation attribute. */
  dangerousUrls: number;
  /** A `src`/`href`/`xlink:href` pointing outside the document (not a fragment, not an allowed data image). */
  externalReferences: number;
  /** A dangerous style attribute, style element, or `url(...)`-bearing attribute. */
  styles: number;
}

function emptySummary(): RemovedSummary {
  return { elements: 0, eventHandlers: 0, dangerousUrls: 0, externalReferences: 0, styles: 0 };
}

/** Thrown instead of returning markup unchanged when DOMPurify reports it cannot run in this environment. */
export class SanitiserUnavailableError extends Error {
  constructor() {
    super('Sanitising needs a browser document, so nothing was rendered.');
    this.name = 'SanitiserUnavailableError';
  }
}

/** Rule 1's always-removed elements (local name, lower-case, namespace prefix stripped before comparing). */
const ALWAYS_REMOVED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'noscript',
  'template',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'audio',
  'video',
  'source',
  'track',
]);

/**
 * Every DOM Level 3 Events / HTML / SVG event handler content attribute this
 * project is aware of, named explicitly rather than caught only by
 * DOMPurify's own `on*` heuristic, so a change to that heuristic cannot
 * quietly loosen this policy.
 */
const EVENT_HANDLER_ATTRS = new Set([
  'onabort',
  'onactivate',
  'onafterprint',
  'onanimationend',
  'onanimationiteration',
  'onanimationstart',
  'onbeforeprint',
  'onbeforeunload',
  'onbegin',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextmenu',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onend',
  'onended',
  'onerror',
  'onfocus',
  'onfocusin',
  'onfocusout',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onmessage',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onmousewheel',
  'onoffline',
  'ononline',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpointercancel',
  'onpointerdown',
  'onpointerenter',
  'onpointerleave',
  'onpointermove',
  'onpointerout',
  'onpointerover',
  'onpointerup',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onrepeat',
  'onreset',
  'onresize',
  'onscroll',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'ontouchcancel',
  'ontouchend',
  'ontouchmove',
  'ontouchstart',
  'ontransitionend',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwheel',
]);

/** Rule 2's legacy resource/navigation attributes, forbidden outright regardless of value. */
const LEGACY_DANGEROUS_ATTRS = new Set([
  'srcset',
  'ping',
  'action',
  'formaction',
  'background',
  'poster',
  'data',
  'codebase',
  'dynsrc',
  'lowsrc',
]);

/** Rule 3's reference-bearing attributes: load something, checked against the fragment/data-image rule. */
const REFERENCE_ATTR_NAMES = new Set(['src', 'href', 'xlink:href']);

/** Data image MIME types small enough, and safe enough, to keep inline. */
const ALLOWED_DATA_IMAGE_TYPES = ['png', 'gif', 'jpeg', 'webp'];

/** Removes ASCII whitespace and C0/C1 control characters, the way a browser does before reading a URL scheme. */
function stripWhitespaceAndControls(value: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  return value.replace(/[\x00-\x20\x7f-\x9f]+/g, '');
}

/** True for a value that is a same-document fragment reference. */
function isFragmentReference(cleaned: string): boolean {
  return cleaned.startsWith('#');
}

/** True for a value that is a small base64 `data:image/{png,gif,jpeg,webp}` image, one of the two reference exceptions. */
function isAllowedDataImage(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith('data:image/')) return false;
  const afterType = lower.slice('data:image/'.length);
  const type = afterType.split(/[;,]/, 1)[0] ?? '';
  return ALLOWED_DATA_IMAGE_TYPES.includes(type) && lower.includes(';base64,');
}

/** True for a value carrying a dangerous URL scheme (rule 3's `a href` exception path, and general use elsewhere). */
function isDangerousUrlScheme(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return true;
  if (lower.startsWith('data:') && !isAllowedDataImage(cleaned)) return true;
  return false;
}

/**
 * Rule 4: true for CSS text (a `style` attribute value, a `style` element's
 * text, or any other attribute value containing `url(`) that is dangerous,
 * lower-cased with whitespace removed first.
 */
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

/** The local name of a tag or attribute, with any `prefix:` namespace stripped, lower-cased. */
function localName(name: string): string {
  const idx = name.indexOf(':');
  return (idx === -1 ? name : name.slice(idx + 1)).toLowerCase();
}

function baseConfig(profile: MarkupProfile) {
  const forbidTags = [...ALWAYS_REMOVED_ELEMENTS];
  if (profile === 'html') forbidTags.push('style');
  return {
    USE_PROFILES: profile === 'html' ? { html: true } : { svg: true, svgFilters: true },
    // DOMPurify's SVG profile does not allow `use` by default (it can reference an
    // external document); this project re-allows it and restricts its href/xlink:href
    // itself, via the reference rule below, rather than losing `use` entirely.
    ADD_TAGS: profile === 'svg' ? ['use'] : [],
    FORBID_TAGS: forbidTags,
    FORBID_ATTR: [...EVENT_HANDLER_ATTRS, ...LEGACY_DANGEROUS_ATTRS],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  };
}

/**
 * Builds a fresh DOMPurify instance for `win` and wires this module's hooks
 * onto it. The instance and its hooks are never reused across calls.
 */
function freshInstance(win: WindowLike, profile: MarkupProfile, removed: RemovedSummary) {
  const instance = createDOMPurify(win);
  if (!instance.isSupported) {
    throw new SanitiserUnavailableError();
  }

  instance.addHook('uponSanitizeElement', (node, data) => {
    const local = localName(data.tagName);

    if (ALWAYS_REMOVED_ELEMENTS.has(local) || (profile === 'html' && local === 'style')) {
      data.allowedTags[data.tagName] = false;
      removed.elements++;
      return;
    }

    // Rule 4, the style ELEMENT case: only reachable in the svg profile,
    // since the html profile already removed the whole element above.
    if (local === 'style' && node.nodeType === 1) {
      const text = (node as unknown as Element).textContent ?? '';
      if (text.trim() !== '' && isDangerousCss(text)) {
        (node as unknown as Element).textContent = '';
        removed.styles++;
      }
    }
  });

  instance.addHook('uponSanitizeAttribute', (node, data) => {
    const name = localName(data.attrName);
    // xlink:href keeps its prefix as a meaningful part of the reference-attribute
    // set (bare "href" and "xlink:href" are both reference attributes), so the
    // reference check below matches on the ORIGINAL (prefixed) lower-cased name,
    // not the prefix-stripped local name every other branch uses.
    const rawNameLower = data.attrName.toLowerCase();

    if (EVENT_HANDLER_ATTRS.has(name) || name.startsWith('on')) {
      data.keepAttr = false;
      removed.eventHandlers++;
      return;
    }

    if (LEGACY_DANGEROUS_ATTRS.has(name)) {
      data.keepAttr = false;
      removed.dangerousUrls++;
      return;
    }

    if (REFERENCE_ATTR_NAMES.has(rawNameLower)) {
      const cleaned = stripWhitespaceAndControls(data.attrValue ?? '');
      const tagLocal = localName((node as Element).tagName ?? '');
      const isAnchorHrefInHtml = profile === 'html' && tagLocal === 'a' && rawNameLower === 'href';

      if (isAnchorHrefInHtml) {
        // The one reference exception (rule 3): an ordinary link keeps DOMPurify's
        // own default safe-URI allow-list; only a dangerous scheme is removed here.
        if (isDangerousUrlScheme(cleaned)) {
          data.keepAttr = false;
          removed.dangerousUrls++;
        }
        return;
      }

      if (isFragmentReference(cleaned) || isAllowedDataImage(cleaned)) {
        return;
      }
      data.keepAttr = false;
      removed.externalReferences++;
      return;
    }

    if (name === 'style') {
      if (isDangerousCss(data.attrValue ?? '')) {
        data.keepAttr = false;
        removed.styles++;
      }
      return;
    }

    if (typeof data.attrValue === 'string' && data.attrValue.toLowerCase().includes('url(')) {
      if (isDangerousCss(data.attrValue)) {
        data.keepAttr = false;
        removed.styles++;
      }
    }
  });

  return instance;
}

/**
 * Sanitises `markup` against `profile`, returning the sanitised DOM as a
 * `DocumentFragment` for further processing (e.g. an optimiser). `win` is
 * the caller's own `window`; this module never reads a DOM global itself.
 */
export function sanitiseToFragment(
  markup: string,
  win: WindowLike,
  profile: MarkupProfile,
): { fragment: DocumentFragment; removed: RemovedSummary } {
  const removed = emptySummary();
  const instance = freshInstance(win, profile, removed);
  const fragment = instance.sanitize(markup, { ...baseConfig(profile), RETURN_DOM_FRAGMENT: true });
  // DOMPurify returns null, not an empty fragment, when every node in the
  // input was removed (e.g. an input that was nothing but a forbidden
  // element with no surviving content) -- normalise that to a genuinely
  // empty fragment so callers never need a null check of their own.
  return { fragment: fragment ?? win.document!.createDocumentFragment(), removed };
}

/** Serialises a fragment `sanitiseToFragment` returned back to markup text for the given profile. */
export function serialiseFragment(fragment: DocumentFragment, win: WindowLike, profile: MarkupProfile): string {
  if (profile === 'svg') {
    const serializer = new (win as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer();
    let out = '';
    for (const child of Array.from(fragment.childNodes)) {
      out += serializer.serializeToString(child as Node);
    }
    return out;
  }
  const container = (win.document as Document).createElement('div');
  container.appendChild(fragment.cloneNode(true));
  return container.innerHTML;
}

/** Sanitises `markup` against `profile` and returns it as text, in one call. */
export function sanitiseMarkup(
  markup: string,
  win: WindowLike,
  profile: MarkupProfile,
): { markup: string; removed: RemovedSummary } {
  const { fragment, removed } = sanitiseToFragment(markup, win, profile);
  return { markup: serialiseFragment(fragment, win, profile), removed };
}

/** Turns a `RemovedSummary`'s non-zero counts into plain sentences, singular and plural both handled. */
export function describeRemoved(removed: RemovedSummary): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (removed.elements > 0) {
    lines.push(
      `Removed ${plural(removed.elements, 'script or other active element', 'scripts or other active elements')}.`,
    );
  }
  if (removed.eventHandlers > 0) {
    lines.push(`Removed ${plural(removed.eventHandlers, 'event handler attribute', 'event handler attributes')}.`);
  }
  if (removed.dangerousUrls > 0) {
    lines.push(
      `Removed ${plural(removed.dangerousUrls, 'dangerous URL or attribute', 'dangerous URLs or attributes')}.`,
    );
  }
  if (removed.externalReferences > 0) {
    lines.push(
      `Removed ${plural(removed.externalReferences, 'reference to another address', 'references to other addresses')}.`,
    );
  }
  if (removed.styles > 0) {
    lines.push(`Removed ${plural(removed.styles, 'dangerous style', 'dangerous styles')}.`);
  }
  return lines;
}
