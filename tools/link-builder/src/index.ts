import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, serialize, type El } from './markup';
import { URI_FIELD_LABELS, buildMailto, buildSms, buildTel } from './uri';

export { meta };
export { MarkupError } from './markup';

/** The kinds of link the builder writes. */
export const LINK_KINDS = ['mailto', 'tel', 'sms'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  kind: 'Link type',
  text: 'Link text',
  ...URI_FIELD_LABELS,
} as const;

export interface LinkSpec {
  kind: LinkKind;
  text?: string;
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

/**
 * Builds one link from the values typed on the page. One tree is built in one call, and the markup, the preview, the
 * bare address and the warnings all describe that tree. Returns null when every field the link reads is blank.
 */
export function buildLink(spec: LinkSpec): BuiltLink | null {
  const text = spec.text ?? '';
  assertSafeText(text, FIELD_LABELS.text);
  const draft =
    spec.kind === 'tel' ? buildTelDraft(spec) : spec.kind === 'sms' ? buildSmsDraft(spec) : buildMailtoDraft(spec);
  if (draft === null) return null;

  const shown = text.trim() !== '' ? text : draft.defaultText;
  if (shown === '') {
    throw new MarkupError(
      FIELD_LABELS.text,
      `missing: with nothing in ${draft.textFieldHint} there is nothing to show, type the link text`,
    );
  }
  const tree = [el('a', [['href', draft.address]], [shown])];
  return {
    tree,
    html: serialize(tree),
    preview: serialize(inert(tree)),
    address: draft.address,
    warnings: draft.warnings,
  };
}
