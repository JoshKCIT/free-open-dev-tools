import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, serialize, type El } from './markup';
import { isValidTimeElementValue } from './microsyntax';

export { meta };
export { MarkupError } from './markup';

/** The elements the builder writes, in the order the page lists them. */
export const SEMANTIC_ELEMENTS = ['time'] as const;
export type SemanticElement = (typeof SEMANTIC_ELEMENTS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  element: 'Element',
  content: 'Text',
  datetime: 'Datetime',
} as const;

export interface ElementSpec {
  element: SemanticElement;
  /** The text the element holds. */
  content?: string;
  /** The machine-readable value of a time element. */
  datetime?: string;
}

export interface BuiltElement {
  tree: El[];
  /** The copyable markup. */
  html: string;
  /** The same tree with every address removed, so nothing in it can be loaded. */
  preview: string;
  warnings: string[];
}

function blank(value: string | undefined): boolean {
  return (value ?? '').trim() === '';
}

const DATETIME_FORMS =
  'a year (2011), a month (2011-11), a date (2011-11-18), a yearless date (11-18), a time (14:54:39.929), ' +
  'a local date and time (2011-11-18T14:54), a time-zone offset (-08:00 or Z), a global date and time ' +
  '(2011-11-18T14:54:39.929Z), a week (2011-W47) or a duration (PT4H18M3S or 4h 18m 3s)';

function timeValueError(source: string): MarkupError {
  return new MarkupError(
    FIELD_LABELS.datetime,
    `${source} is not a valid date or time string; WHATWG 4.5.14 allows ${DATETIME_FORMS}, written as WHATWG 2.3.5 describes with ASCII digits`,
  );
}

function buildTime(spec: ElementSpec): El | null {
  const content = spec.content ?? '';
  const datetime = spec.datetime ?? '';
  assertSafeText(content, FIELD_LABELS.content);
  assertSafeText(datetime, FIELD_LABELS.datetime);
  if (blank(content) && blank(datetime)) return null;
  if (blank(content)) {
    throw new MarkupError(FIELD_LABELS.content, 'missing, type the text a visitor reads inside the time element');
  }
  if (!blank(datetime)) {
    if (!isValidTimeElementValue(datetime)) throw timeValueError('the datetime value');
    return el('time', [['datetime', datetime]], [content]);
  }
  // With no datetime attribute, the standard reads the text itself as the value.
  if (!isValidTimeElementValue(content))
    throw timeValueError('the text, which is used as the value because no datetime is typed,');
  return el('time', [], [content]);
}

/**
 * Builds one semantic element. Returns null when every field it reads is blank, throws MarkupError naming the
 * field and the broken rule when a value is refused. One tree is built; the markup and the preview are both written
 * from it.
 */
export function buildElement(spec: ElementSpec): BuiltElement | null {
  const warnings: string[] = [];
  let root: El | null;
  switch (spec.element) {
    case 'time':
      root = buildTime(spec);
      break;
    default:
      throw new MarkupError(FIELD_LABELS.element, 'not an element this builder writes');
  }
  if (root === null) return null;
  const tree = [root];
  return { tree, html: serialize(tree), preview: serialize(inert(tree)), warnings };
}
