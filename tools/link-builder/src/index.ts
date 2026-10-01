import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, schemeWarning, serialize, type El } from './markup';
import { LINK_TYPES_ON_A, REGISTERED_EXTENSIONS, TARGET_KEYWORDS } from './spec-data';
import { URI_FIELD_LABELS, buildMailto, buildSms, buildTel } from './uri';

export { meta };
export { MarkupError } from './markup';
export {
  IANA_REGISTRY_UPDATED,
  LINK_TYPES_ON_A,
  REGISTERED_EXTENSIONS,
  SPEC_FETCHED,
  SPEC_LAST_UPDATED,
  TARGET_KEYWORDS,
} from './spec-data';

/** The kinds of link the builder writes. */
export const LINK_KINDS = ['web', 'mailto', 'tel', 'sms'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  kind: 'Link type',
  text: 'Link text',
  href: 'Address',
  rel: 'Rel',
  target: 'Target',
  download: 'Download',
  downloadName: 'Download file name',
  ...URI_FIELD_LABELS,
} as const;

export interface LinkSpec {
  kind: LinkKind;
  text?: string;
  /** A web address, kept exactly as typed. */
  href?: string;
  /** The rel values chosen, in the order chosen; nothing is ever added to them. */
  rel?: string[];
  target?: string;
  /** A file name, or true for the bare attribute. */
  download?: string | true;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  phone?: string;
  ext?: string;
  phoneContext?: string;
  recipients?: string;
  smsBody?: string;
}

export interface BuiltLink {
  tree: El[];
  /** The copyable markup. */
  html: string;
  /** The same tree with the address removed, so nothing in it can be followed. */
  preview: string;
  /** The bare address, with no HTML escaping, for use outside HTML. */
  address: string;
  warnings: string[];
}

/**
 * The expression the HTML Living Standard gives for a valid email address (4.10.5.1.5). It is a willful violation of
 * RFC 5322 and is used here only to warn, never to refuse.
 */
const VALID_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Splits a list typed with commas (and, when `lines` is set, line breaks), trimming and dropping empty entries. */
function splitList(value: string, lines = false): string[] {
  return value
    .split(lines ? /[,\r\n]+/ : ',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function blank(value: string | undefined): boolean {
  return (value ?? '').trim() === '';
}

interface Draft {
  address: string;
  /** What the link text is when the visitor leaves it blank. */
  defaultText: string;
  warnings: string[];
  /** The field to name when there is no text to show. */
  textFieldHint: string;
  /** Web links only: the attributes chosen after href. */
  rel?: string[];
  target?: string;
  download?: string | true;
}

function buildMailtoDraft(spec: LinkSpec): Draft | null {
  const fields = [spec.to, spec.cc, spec.bcc, spec.subject, spec.body];
  // A line break in a header field is refused by buildMailto with the reason; the generic check would hide it.
  assertSafeText(spec.to ?? '', FIELD_LABELS.to, { multiline: true });
  assertSafeText(spec.cc ?? '', FIELD_LABELS.cc, { multiline: true });
  assertSafeText(spec.bcc ?? '', FIELD_LABELS.bcc, { multiline: true });
  assertSafeText(spec.subject ?? '', FIELD_LABELS.subject, { multiline: true });
  assertSafeText(spec.body ?? '', FIELD_LABELS.body, { multiline: true });
  if (fields.every(blank)) {
    if (blank(spec.text)) return null;
    throw new MarkupError(FIELD_LABELS.to, 'missing, type at least one address to send the message to');
  }

  const to = splitList(spec.to ?? '');
  const cc = splitList(spec.cc ?? '');
  const bcc = splitList(spec.bcc ?? '');
  const address = buildMailto({ to, cc, bcc, subject: spec.subject ?? '', body: spec.body ?? '' });

  const warnings: string[] = [];
  const listed: [string, string[]][] = [
    [FIELD_LABELS.to, to],
    [FIELD_LABELS.cc, cc],
    [FIELD_LABELS.bcc, bcc],
  ];
  for (const [label, list] of listed) {
    for (const item of list) {
      if (!VALID_EMAIL.test(item)) {
        warnings.push(
          `${label}: "${item}" is not a valid email address by the expression in the HTML Living Standard (4.10.5.1.5); it is written as typed, encoded.`,
        );
      }
    }
  }
  if (bcc.length > 0) {
    warnings.push(
      'Bcc: the addresses in a bcc field are part of the link itself, so they are visible to anyone who reads the page source or the link (RFC 6068 section 7).',
    );
  }
  return { address, defaultText: to.join(', '), warnings, textFieldHint: FIELD_LABELS.to };
}

function buildTelDraft(spec: LinkSpec): Draft | null {
  const phone = spec.phone ?? '';
  assertSafeText(phone, FIELD_LABELS.phone);
  assertSafeText(spec.ext ?? '', FIELD_LABELS.ext);
  assertSafeText(spec.phoneContext ?? '', FIELD_LABELS.phoneContext);
  if (blank(phone) && blank(spec.ext) && blank(spec.phoneContext)) {
    if (blank(spec.text)) return null;
    throw new MarkupError(FIELD_LABELS.phone, 'missing, type a phone number');
  }
  const { uri, notes } = buildTel(phone, { ext: spec.ext ?? '', phoneContext: spec.phoneContext ?? '' });
  return { address: uri, defaultText: phone.trim(), warnings: notes, textFieldHint: FIELD_LABELS.phone };
}

function buildSmsDraft(spec: LinkSpec): Draft | null {
  const recipients = spec.recipients ?? '';
  const message = spec.smsBody ?? '';
  assertSafeText(recipients, FIELD_LABELS.recipients, { multiline: true });
  assertSafeText(message, FIELD_LABELS.smsBody, { multiline: true });
  if (blank(recipients) && message === '') {
    if (blank(spec.text)) return null;
    throw new MarkupError(FIELD_LABELS.recipients, 'missing, type at least one phone number');
  }
  const list = splitList(recipients, true);
  const { uri, notes } = buildSms(list, message);
  return { address: uri, defaultText: list.join(', '), warnings: notes, textFieldHint: FIELD_LABELS.recipients };
}

export interface ParsedRel {
  /** The values as typed, in the order typed. */
  tokens: string[];
  /** The tokens that are IANA registered extensions rather than keywords of the Living Standard's table. */
  registered: string[];
}

/**
 * Checks rel values against the 16 link types the Living Standard allows on an a element (4.6.8) and the two
 * registered extensions, sponsored and ugc. Keywords compare ASCII case-insensitively; a repeated keyword and an
 * unknown value are refused naming the field; spelling and order are kept and nothing is ever added.
 */
export function parseRel(tokens: string[], field: string = FIELD_LABELS.rel): ParsedRel {
  const kept: string[] = [];
  const registered: string[] = [];
  const seen = new Set<string>();
  const known = [...LINK_TYPES_ON_A.map((t) => t.value), ...REGISTERED_EXTENSIONS.map((t) => t.value)];
  for (const raw of tokens) {
    const token = raw.trim();
    if (token === '') continue;
    assertSafeText(token, field);
    if (/\s/.test(token)) {
      throw new MarkupError(
        field,
        `"${token}" holds a space; rel values are separated by spaces, so type one value each`,
      );
    }
    const lower = token.toLowerCase();
    if (!known.includes(lower)) {
      throw new MarkupError(
        field,
        `"${token}" is not a link type the HTML Living Standard allows on an a element (4.6.8) or one registered with IANA; the values are ${known.join(', ')}`,
      );
    }
    if (seen.has(lower)) {
      throw new MarkupError(
        field,
        `"${token}" is given more than once; the standard says a keyword must not be specified more than once (4.6.8)`,
      );
    }
    seen.add(lower);
    kept.push(token);
    if (REGISTERED_EXTENSIONS.some((t) => t.value === lower)) registered.push(token);
  }
  return { tokens: kept, registered };
}

/** A valid navigable target name or keyword (HTML 7.3.1.7). */
function isValidTarget(value: string): boolean {
  if (TARGET_KEYWORDS.some((k) => k === value.toLowerCase())) return true;
  if (value === '' || value.startsWith('_')) return false;
  return !(/[\t\n\r]/.test(value) && value.includes('<'));
}

function buildWebDraft(spec: LinkSpec): Draft | null {
  const href = spec.href ?? '';
  const target = spec.target ?? '';
  const download = spec.download;
  assertSafeText(href, FIELD_LABELS.href);
  assertSafeText(target, FIELD_LABELS.target);
  if (typeof download === 'string') assertSafeText(download, FIELD_LABELS.download);
  const rel = parseRel(spec.rel ?? []);
  if (blank(href)) {
    if (blank(spec.text) && rel.tokens.length === 0 && blank(target) && download === undefined) return null;
    throw new MarkupError(FIELD_LABELS.href, 'missing, type the address the link points to');
  }
  const chosenTarget = blank(target) ? '' : target;
  if (chosenTarget !== '' && !isValidTarget(chosenTarget)) {
    throw new MarkupError(
      FIELD_LABELS.target,
      `"${chosenTarget}" is not a valid navigable target name or keyword (HTML 7.3.1.7): use _blank, _self, _parent, _top, or a name of at least one character that does not start with an underscore`,
    );
  }

  const warnings: string[] = [];
  const scheme = schemeWarning(FIELD_LABELS.href, href);
  if (scheme !== null) warnings.push(scheme);
  const lower = rel.tokens.map((t) => t.toLowerCase());
  const hasOpener = lower.includes('opener');
  const settled = lower.includes('noopener') || lower.includes('noreferrer');
  if (hasOpener && settled) {
    warnings.push(
      `${FIELD_LABELS.rel}: opener together with noopener or noreferrer contradict each other; noopener wins, because the standard's algorithm for an element's noopener (4.6.5) checks noopener and noreferrer first, so the link opens without a reference to this page.`,
    );
  }
  if (chosenTarget.toLowerCase() === '_blank' && !hasOpener && !settled) {
    warnings.push(
      'The standard already opens this link without a reference to this page (target _blank implies noopener), so rel=noopener is not needed and was not added.',
    );
  }
  for (const token of rel.registered) {
    const record = REGISTERED_EXTENSIONS.find((t) => t.value === token.toLowerCase());
    warnings.push(
      `${FIELD_LABELS.rel}: ${token} is a registered extension (IANA Link Relations, record dated ${record?.recorded ?? ''}), not a keyword in the HTML Living Standard's table of link types.`,
    );
  }
  return {
    address: href,
    defaultText: href,
    warnings,
    textFieldHint: FIELD_LABELS.href,
    rel: rel.tokens,
    target: chosenTarget,
    download,
  };
}

/** rel, target and download belong to web links; for the other kinds a typed value is refused, never dropped. */
function refuseWebOnly(spec: LinkSpec): void {
  if ((spec.rel ?? []).some((token) => token.trim() !== '')) {
    throw new MarkupError(FIELD_LABELS.rel, 'is offered for web links only, so it is not written on this kind of link');
  }
  if (!blank(spec.target)) {
    throw new MarkupError(
      FIELD_LABELS.target,
      'is offered for web links only, so it is not written on this kind of link',
    );
  }
  if (spec.download !== undefined) {
    throw new MarkupError(
      FIELD_LABELS.download,
      'has no effect on mailto, tel and sms addresses (HTML 4.6.6), so it is not written',
    );
  }
}

/**
 * Builds one link from the values typed on the page. One tree is built in one call, and the markup, the preview, the
 * bare address and the warnings all describe that tree. Returns null when every field the link reads is blank.
 */
export function buildLink(spec: LinkSpec): BuiltLink | null {
  const text = spec.text ?? '';
  assertSafeText(text, FIELD_LABELS.text);
  let draft: Draft | null;
  switch (spec.kind) {
    case 'web':
      draft = buildWebDraft(spec);
      break;
    case 'tel':
      refuseWebOnly(spec);
      draft = buildTelDraft(spec);
      break;
    case 'sms':
      refuseWebOnly(spec);
      draft = buildSmsDraft(spec);
      break;
    case 'mailto':
      refuseWebOnly(spec);
      draft = buildMailtoDraft(spec);
      break;
    default:
      throw new MarkupError(
        FIELD_LABELS.kind,
        `"${String(spec.kind)}" is not one of the link types offered: ${LINK_KINDS.join(', ')}`,
      );
  }
  if (draft === null) return null;

  const shown = text.trim() !== '' ? text : draft.defaultText;
  if (shown === '') {
    throw new MarkupError(
      FIELD_LABELS.text,
      `missing: with nothing in ${draft.textFieldHint} there is nothing to show, type the link text`,
    );
  }
  const attrs: [string, string | true | null][] = [['href', draft.address]];
  if (draft.rel !== undefined && draft.rel.length > 0) attrs.push(['rel', draft.rel.join(' ')]);
  if (draft.target) attrs.push(['target', draft.target]);
  if (draft.download === true || (typeof draft.download === 'string' && draft.download.trim() === ''))
    attrs.push(['download', true]);
  else if (typeof draft.download === 'string') attrs.push(['download', draft.download]);
  const tree = [el('a', attrs, [shown])];
  return {
    tree,
    html: serialize(tree),
    preview: serialize(inert(tree)),
    address: draft.address,
    warnings: draft.warnings,
  };
}
