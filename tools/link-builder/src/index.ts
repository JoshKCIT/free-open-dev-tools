import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, serialize, type El } from './markup';
import { buildMailto } from './uri';

export { meta };
export { MarkupError } from './markup';

/** The kinds of link the builder writes. */
export const LINK_KINDS = ['mailto'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  kind: 'Link type',
  text: 'Link text',
  to: 'To',
  body: 'Body',
} as const;

export interface LinkSpec {
  kind: LinkKind;
  text?: string;
  to?: string;
  body?: string;
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

const MAX_RECIPIENTS = 50;

/** Splits a comma-separated list of addresses, trimming each and dropping empty entries. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * Builds one link from the values typed on the page. One tree is built in one call, and the markup, the preview, the
 * bare address and the warnings all describe that tree. Returns null when every field the link reads is blank.
 */
export function buildLink(spec: LinkSpec): BuiltLink | null {
  const text = spec.text ?? '';
  const to = spec.to ?? '';
  const body = spec.body ?? '';
  assertSafeText(text, FIELD_LABELS.text);
  assertSafeText(to, FIELD_LABELS.to);
  assertSafeText(body, FIELD_LABELS.body, { multiline: true });
  if (to.trim() === '' && body === '') {
    if (text.trim() === '') return null;
    throw new MarkupError(FIELD_LABELS.to, 'missing, type at least one address to send the message to');
  }

  const recipients = splitList(to);
  if (recipients.length > MAX_RECIPIENTS) {
    throw new MarkupError(FIELD_LABELS.to, `more than ${MAX_RECIPIENTS} addresses, so it is refused`);
  }
  const address = buildMailto({ to: recipients, body });
  const shown = text.trim() !== '' ? text : recipients.join(', ');
  if (shown === '') {
    throw new MarkupError(
      FIELD_LABELS.text,
      'missing: with no address in To there is nothing to show, type the link text',
    );
  }

  const tree = [el('a', [['href', address]], [shown])];
  return { tree, html: serialize(tree), preview: serialize(inert(tree)), address, warnings: [] };
}
