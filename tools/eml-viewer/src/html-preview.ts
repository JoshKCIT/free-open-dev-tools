import type { WindowLike } from 'dompurify';
import type { CidPart } from './analyze';
import {
  MAX_ADDRESS_CHARACTERS,
  MAX_CID_IMAGE_BYTES,
  MAX_CID_TOTAL_BYTES,
  MAX_HTML_DEPTH,
  MAX_HTML_PREVIEW_BYTES,
  MAX_HTML_TAGS,
  MAX_LISTED_REFERENCES,
  withCommas,
} from './limits';
import { describeRemoved, sanitiseToFragment } from './sanitise';

/** One remote reference found in the HTML body, with where it was and what it points at. It was removed, never loaded. */
export interface BlockedReference {
  /** What kind of reference: an image source, a style address, a link element, a refresh and so on. */
  kind: string;
  /** Where it was written, for example img src or style attribute (div). */
  where: string;
  /** The address exactly as written (cut at 2,000 characters). It is text only. */
  address: string;
  /** The host the address names, or an empty string when it names none. */
  host: string;
  /** How many times the same reference was written. */
  count: number;
}

/** One link in the HTML body: its visible text and the address it had. The link itself is made inert. */
export interface LinkInfo {
  text: string;
  /** The address as written, or an empty string when the sanitiser had already removed an unsafe one. */
  target: string;
  host: string;
  /** True when the visible text looks like a host name or an address and names a different host than the link does. */
  mismatch: boolean;
}

interface PreviewBase {
  blocked: BlockedReference[];
  links: LinkInfo[];
  /** What the sanitiser removed, in sentences, and anything about cid images. */
  notes: string[];
  /** References or links found but not listed because the lists are capped. */
  omitted: number;
}

export type PreviewResult =
  (PreviewBase & { status: 'shown'; html: string }) | (PreviewBase & { status: 'skipped'; reason: string });

// ---- Step 1: the pre-scan, before any DOM call --------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose end tag may be left out, with the open elements a new start tag of that name closes first. */
const IMPLIED_CLOSE: ReadonlyMap<string, readonly string[]> = new Map([
  ['p', ['p']],
  ['li', ['li']],
  ['dt', ['dt', 'dd']],
  ['dd', ['dt', 'dd']],
  ['td', ['td', 'th']],
  ['th', ['td', 'th']],
  ['tr', ['td', 'th', 'tr']],
  ['thead', ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']],
  ['tbody', ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']],
  ['tfoot', ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']],
  ['option', ['option']],
  ['optgroup', ['option', 'optgroup']],
]);

function isNameCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x3a ||
    code === 0x5f
  );
}

/** The number of bytes a string takes as UTF-8, counted in one pass without making a copy. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Judges an HTML body before any DOM call: over 1 MiB, more than 20,000 tags (the number of < characters) or nested
 * deeper than 200 levels is refused with the reason. One linear pass over the text; the open elements are kept on an
 * explicit stack that is never allowed past 200 entries. The nesting is an estimate that errs towards refusing: it counts
 * the elements in comments and in raw text, treats elements whose end tag is optional (p, li, td and the like) as closed
 * by the next of their kind, and reads a self-closing slash as closing.
 */
export function scanHtml(html: string): { ok: true } | { ok: false; reason: string } {
  const result = scan(html);
  return result.ok ? { ok: true } : result;
}

interface ScanPassed {
  ok: true;
  /** Where the < of each base start tag is. */
  baseAt: number[];
}

function scan(html: string): ScanPassed | { ok: false; reason: string } {
  if (utf8Length(html) > MAX_HTML_PREVIEW_BYTES) {
    return { ok: false, reason: 'The HTML body is larger than 1 MiB, so it is shown as text and not rendered.' };
  }
  const open: string[] = [];
  const baseAt: number[] = [];
  let tags = 0;
  let at = html.indexOf('<');
  while (at !== -1) {
    tags++;
    if (tags > MAX_HTML_TAGS) {
      return {
        ok: false,
        reason: `The HTML body has more than ${withCommas(MAX_HTML_TAGS)} tags, so it is shown as text and not rendered.`,
      };
    }
    const next = at + 1 < html.length ? html.charCodeAt(at + 1) : 0;
    if (next === 0x2f) {
      // An end tag: close the nearest open element of that name, if there is one.
      let end = at + 2;
      while (end < html.length && isNameCode(html.charCodeAt(end))) end++;
      const name = html.slice(at + 2, end).toLowerCase();
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i] === name) {
          open.length = i;
          break;
        }
      }
    } else if ((next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a)) {
      let end = at + 1;
      while (end < html.length && isNameCode(html.charCodeAt(end))) end++;
      const name = html.slice(at + 1, end).toLowerCase();
      if (name === 'base') baseAt.push(at);
      const closes = IMPLIED_CLOSE.get(name);
      if (closes !== undefined) {
        while (open.length > 0 && closes.includes(open[open.length - 1] ?? '')) open.pop();
      }
      // Find the end of the tag; a slash right before it closes the element.
      const close = html.indexOf('>', end);
      const selfClosing = close > 0 && html.charCodeAt(close - 1) === 0x2f;
      if (!VOID_ELEMENTS.has(name) && !selfClosing) {
        open.push(name);
        if (open.length > MAX_HTML_DEPTH) {
          return {
            ok: false,
            reason: `The HTML body is nested deeper than ${MAX_HTML_DEPTH} levels, so it is shown as text and not rendered.`,
          };
        }
      }
    }
    at = html.indexOf('<', at + 1);
  }
  return { ok: true, baseAt };
}

/**
 * The markup with every base start tag renamed (<base becomes <x-base). The page's own policy forbids a base address, and a
 * parser made by the page reports the attempt as a policy violation even though nothing happens, so no parser may be given
 * a base element. The renamed element is an unknown element: it does nothing, its address is still read as text, and the
 * sanitiser drops it.
 */
function renameBase(html: string, at: readonly number[]): string {
  if (at.length === 0) return html;
  const parts: string[] = [];
  let from = 0;
  for (const position of at) {
    parts.push(html.slice(from, position + 1), 'x-');
    from = position + 1;
  }
  parts.push(html.slice(from));
  return parts.join('');
}

// ---- Addresses ----------------------------------------------------------------------------------------------------

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function cutAddress(text: string): string {
  return text.length > MAX_ADDRESS_CHARACTERS ? text.slice(0, MAX_ADDRESS_CHARACTERS) : text;
}

/** The host a web address or mail address names, in lower case, or an empty string. */
function hostOf(address: string): string {
  const text = address.trim();
  const lower = asciiLower(text);
  if (lower.startsWith('mailto:')) {
    const at = text.lastIndexOf('@');
    if (at === -1) return '';
    let host = text.slice(at + 1);
    for (const stop of ['?', '>', ',']) {
      const k = host.indexOf(stop);
      if (k !== -1) host = host.slice(0, k);
    }
    return asciiLower(host.trim());
  }
  if (!(lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//'))) return '';
  try {
    return new URL(lower.startsWith('//') ? `https:${text}` : text).hostname;
  } catch {
    return '';
  }
}

/** True for a base64 PNG, GIF, JPEG or WebP data address: the only address an image or a style may keep. */
function isDataImage(address: string): boolean {
  const lower = asciiLower(address.trim());
  if (!lower.startsWith('data:image/')) return false;
  const afterType = lower.slice('data:image/'.length);
  const type = afterType.slice(0, Math.max(0, afterType.search(/[;,]/)));
  return ['png', 'gif', 'jpeg', 'webp'].includes(type) && lower.includes(';base64,');
}

/**
 * True for an address that names a place in this document or an allowed data image. Only a link may name a place: an
 * image or a style address that is only a fragment is resolved against the page's own address and loads that.
 */
function isLocalReference(address: string): boolean {
  return asciiLower(address.trim()).startsWith('#') || isDataImage(address);
}

// ---- Style text ---------------------------------------------------------------------------------------------------

/** Style functions that load something or may: each is blocked as a whole declaration in an inline style. */
const RISKY_FUNCTIONS = [
  'image-set(',
  '-webkit-image-set(',
  'image(',
  'cross-fade(',
  '-webkit-cross-fade(',
  'element(',
  'paint(',
  'src(',
];

function isIdentifierCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x5f
  );
}

/** Positions of a function name in lower-case style text that is a whole name (not the end of a longer one). */
function findFunction(low: string, name: string, from: number): number {
  let at = low.indexOf(name, from);
  while (at !== -1) {
    if (at === 0 || !isIdentifierCode(low.charCodeAt(at - 1))) return at;
    at = low.indexOf(name, at + name.length);
  }
  return -1;
}

interface StyleAddress {
  kind: string;
  address: string;
}

/** The quoted string or bare word that starts at `at`, and where it ends; skips leading white space. */
function readAddressAt(text: string, at: number): { address: string; end: number } {
  let i = at;
  while (
    i < text.length &&
    (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9 || text.charCodeAt(i) === 10 || text.charCodeAt(i) === 13)
  )
    i++;
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, i + 1);
    const end = close === -1 ? text.length : close;
    return { address: text.slice(i + 1, end), end: close === -1 ? text.length : close + 1 };
  }
  const close = text.indexOf(')', i);
  const end = close === -1 ? text.length : close;
  return { address: text.slice(i, end).trim(), end };
}

/** Every address in a piece of style text that points outside the document, in the order written. One pass per kind. */
function styleAddresses(text: string): StyleAddress[] {
  const low = asciiLower(text);
  const found: StyleAddress[] = [];
  const consumed = new Set<number>();

  // @import "address" and @import url(address)
  let from = 0;
  for (;;) {
    const at = low.indexOf('@import', from);
    if (at === -1) break;
    let i = at + 7;
    while (
      i < low.length &&
      (low.charCodeAt(i) === 32 || low.charCodeAt(i) === 9 || low.charCodeAt(i) === 10 || low.charCodeAt(i) === 13)
    )
      i++;
    if (low.startsWith('url(', i)) {
      consumed.add(i);
      const read = readAddressAt(text, i + 4);
      found.push({ kind: 'style import', address: read.address });
      from = read.end;
    } else {
      const read = readAddressAt(text, i);
      if (read.address !== '') found.push({ kind: 'style import', address: read.address });
      from = Math.max(read.end, at + 7);
    }
  }

  // url(address)
  from = 0;
  for (;;) {
    const at = findFunction(low, 'url(', from);
    if (at === -1) break;
    const read = readAddressAt(text, at + 4);
    if (!consumed.has(at) && !isDataImage(read.address)) found.push({ kind: 'style url', address: read.address });
    from = Math.max(read.end, at + 4);
  }

  // image-set(...) and the other functions that can load an image
  for (const name of RISKY_FUNCTIONS) {
    let start = 0;
    for (;;) {
      const at = findFunction(low, name, start);
      if (at === -1) break;
      const close = low.indexOf(')', at);
      const end = close === -1 ? low.length : close;
      found.push({ kind: 'style image', address: text.slice(at, Math.min(end + 1, at + 200)) });
      start = Math.max(end, at + name.length);
    }
  }
  return found;
}

/** Splits inline style text into declarations at semicolons that are outside quotes and parentheses. */
function splitDeclarations(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

// ---- Images named by cid ------------------------------------------------------------------------------------------

/** The image type a part's first bytes show (PNG, JPEG, GIF or WebP), or null. SVG is never one of them. */
function imageTypeOf(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  )
    return 'gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'webp';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  }
  return btoa(binary);
}

function decodeCid(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// ---- The preview --------------------------------------------------------------------------------------------------

interface DomParserWindow {
  DOMParser: new () => DOMParser;
}

/** Attribute names that name an address to load, with the kind each is listed under. */
const SOURCE_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ['src', 'source'],
  ['poster', 'poster'],
  ['background', 'background'],
  ['data', 'object data'],
  ['ping', 'ping'],
  ['action', 'form action'],
  ['formaction', 'form action'],
];

/** The text with each run of white space made one space, and the ends trimmed. */
function squash(text: string): string {
  let out = '';
  let space = false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 0xa0) space = out !== '';
    else {
      if (space) out += ' ';
      space = false;
      out += ch;
    }
  }
  return out;
}

/** Whether a link's visible text looks like a host name or a mail address, and which host it names. */
function textHost(text: string): string {
  let t = text;
  const lower = asciiLower(t);
  if (lower.startsWith('https://')) t = t.slice(8);
  else if (lower.startsWith('http://')) t = t.slice(7);
  if (t === '' || t.length > 253 || t.includes(' ')) return '';
  const at = t.indexOf('@');
  let host = at === -1 ? t : t.slice(at + 1);
  for (const stop of ['/', '?', '#']) {
    const k = host.indexOf(stop);
    if (k !== -1) host = host.slice(0, k);
  }
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  host = asciiLower(host);
  if (host.endsWith('.')) host = host.slice(0, -1);
  const dot = host.lastIndexOf('.');
  if (dot < 1 || host.length - dot - 1 < 2) return '';
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i);
    if (!((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2e || code === 0x2d))
      return '';
  }
  return host;
}

/**
 * The markup of a sanitised fragment, written out inside the document the fragment already belongs to (the sanitiser's
 * own inert document, which has no window and loads nothing). An empty fragment is an empty string and touches nothing.
 */
function serialiseInert(fragment: DocumentFragment): string {
  if (!fragment.hasChildNodes()) return '';
  const holder = fragment.ownerDocument.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
}

/**
 * Makes the HTML body of a message safe to show and lists what it tried to load. In order: the size, tag and nesting scan
 * (nothing is parsed if it fails); an inert parse that loads and runs nothing, in which every remote reference is
 * recorded as text and a cid image that names a PNG, JPEG, GIF or WebP part of at most 1 MiB (5 MiB in all) is rewritten
 * to a data address; the canonical sanitiser; then every anchor loses href, target, ping and rel, so no link navigates,
 * and every source that is not a data image is listed and removed. The markup is written out inside the sanitiser's inert
 * document. `win` is the caller's window: this file touches no DOM global of its own and puts no node into its document.
 */
export function previewHtml(html: string, win: WindowLike, cid: readonly CidPart[] = []): PreviewResult {
  const scanned = scan(html);
  if (!scanned.ok) return { status: 'skipped', reason: scanned.reason, blocked: [], links: [], notes: [], omitted: 0 };
  const markup = renameBase(html, scanned.baseAt);

  const references = new Map<string, BlockedReference>();
  let omitted = 0;
  const record = (kind: string, where: string, address: string): void => {
    const text = cutAddress(address.trim());
    const key = `${kind}\u0000${where}\u0000${text}`;
    const existing = references.get(key);
    if (existing !== undefined) {
      existing.count++;
      return;
    }
    if (references.size >= MAX_LISTED_REFERENCES) {
      omitted++;
      return;
    }
    references.set(key, { kind, where, address: text, host: hostOf(text), count: 1 });
  };
  const notes: string[] = [];

  // Step 2: the inert parse. A document made by a parser never loads or runs anything.
  const parser = new (win as unknown as DomParserWindow).DOMParser();
  const doc = parser.parseFromString(markup, 'text/html');
  const idMap = new Map<string, CidPart>();
  for (const part of cid) if (!idMap.has(part.id)) idMap.set(part.id, part);
  let cidTotal = 0;
  let cidShown = 0;

  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const tag = el.localName.toLowerCase();

    for (const [name, kind] of SOURCE_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value === null || value.trim() === '') continue;
      if (name === 'src' && tag === 'img' && asciiLower(value.trim()).startsWith('cid:')) {
        const id = decodeCid(value.trim().slice(4));
        const part = idMap.get(id) ?? idMap.get(value.trim().slice(4));
        const type = part === undefined ? null : imageTypeOf(part.bytes);
        if (part === undefined) record('inline image not found', 'img src', value);
        else if (type === null) record('inline image is not a PNG, JPEG, GIF or WebP', 'img src', value);
        else if (part.bytes.length > MAX_CID_IMAGE_BYTES || cidTotal + part.bytes.length > MAX_CID_TOTAL_BYTES) {
          record('inline image over the size limit', 'img src', value);
        } else {
          cidTotal += part.bytes.length;
          cidShown++;
          el.setAttribute('src', `data:image/${type};base64,${toBase64(part.bytes)}`);
        }
        continue;
      }
      if (name === 'src' && isLocalReference(value)) continue;
      record(kind, `${tag} ${name}`, value);
    }

    const srcset = el.getAttribute('srcset');
    if (srcset !== null && srcset.trim() !== '') {
      for (const token of srcset.split(/\s+/)) {
        const url = token.endsWith(',') ? token.slice(0, -1) : token;
        if (url === '' || /^\d+(\.\d+)?[wx]$/.test(url)) continue;
        record('srcset', `${tag} srcset`, url);
      }
    }

    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    if (href !== null && href.trim() !== '') {
      if (tag === 'link') record('link element', 'link href', href);
      else if (tag === 'base' || tag === 'x-base') record('base address', 'base href', href);
      else if (tag === 'a') {
        const lower = asciiLower(href.trim());
        if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:')) {
          record('link with an unsafe address', 'a href', href);
        }
      } else if (!isLocalReference(href)) record('reference', `${tag} href`, href);
    }

    if (tag === 'meta' && asciiLower(el.getAttribute('http-equiv') ?? '').trim() === 'refresh') {
      const content = el.getAttribute('content') ?? '';
      const at = asciiLower(content).indexOf('url=');
      record('meta refresh', 'meta content', at === -1 ? content : content.slice(at + 4));
    }

    const style = el.getAttribute('style');
    if (style !== null && style.trim() !== '') {
      // Declarations that load something are dropped one by one, so the rest of the style stays.
      const kept: string[] = [];
      let dropped = false;
      for (const declaration of splitDeclarations(style)) {
        const found = styleAddresses(declaration);
        if (found.length > 0) {
          dropped = true;
          for (const item of found) record(item.kind, `style attribute (${tag})`, item.address);
        } else if (declaration.trim() !== '') kept.push(declaration.trim());
      }
      if (dropped) {
        if (kept.length > 0) el.setAttribute('style', kept.join('; '));
        else el.removeAttribute('style');
      }
    }

    if (tag === 'style') {
      for (const item of styleAddresses(el.textContent ?? '')) record(item.kind, 'style element', item.address);
    }
  }
  if (cidShown > 0)
    notes.push(`${cidShown} inline ${cidShown === 1 ? 'image is' : 'images are'} shown from the message's own parts.`);

  // Step 3: the canonical sanitiser, on the markup of the parse above.
  const { fragment, removed } = sanitiseToFragment(doc.documentElement.outerHTML, win, 'html');
  for (const line of describeRemoved(removed)) notes.push(line);

  // Step 4: every anchor keeps its words and loses everything that could go anywhere.
  const links: LinkInfo[] = [];
  let omittedLinks = 0;
  for (const anchor of Array.from(fragment.querySelectorAll('a'))) {
    const text = squash(anchor.textContent ?? '');
    const target = anchor.getAttribute('href') ?? '';
    if (links.length < MAX_LISTED_REFERENCES) {
      const wanted = textHost(text);
      const actual = hostOf(target);
      links.push({
        text: text.length > 200 ? text.slice(0, 200) : text,
        target: cutAddress(target),
        host: actual,
        mismatch: wanted !== '' && target !== '' && wanted !== actual,
      });
    } else omittedLinks++;
    for (const name of ['href', 'target', 'ping', 'rel', 'xlink:href']) anchor.removeAttribute(name);
  }

  // Every source the sanitiser kept that is not a data image is a fragment (#x): the frame resolves it against the page's
  // own address and would try to load the page as an image. It is listed and removed, so only data images remain.
  for (const el of Array.from(fragment.querySelectorAll('[src]'))) {
    const src = el.getAttribute('src') ?? '';
    if (isDataImage(src)) continue;
    record('image source that names this page', `${el.localName.toLowerCase()} src`, src);
    el.removeAttribute('src');
  }

  // Step 5: serialise inside the sanitiser's own inert document, never the page's: a node put into the page's document,
  // even one that is never shown, starts loading its image there.
  const output = serialiseInert(fragment);
  return {
    status: 'shown',
    html: output,
    blocked: Array.from(references.values()),
    links,
    notes,
    omitted: omitted + omittedLinks,
  };
}
