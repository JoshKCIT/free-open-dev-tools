import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, serialize, type El } from './markup';
import { isValidFloat, isValidTimeElementValue, parseValidFloat } from './microsyntax';

export { meta };
export { MarkupError } from './markup';

/** The elements the builder writes, in the order the page lists them. */
export const SEMANTIC_ELEMENTS = ['details', 'dialog', 'meter', 'progress', 'time'] as const;
export type SemanticElement = (typeof SEMANTIC_ELEMENTS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  element: 'Element',
  content: 'Text',
  paragraphs: 'Content',
  datetime: 'Datetime',
  summary: 'Summary',
  open: 'Open',
  group: 'Group name',
  closedby: 'Closed by',
  closeLabel: 'Close button text',
  id: 'Id',
  label: 'Label',
  value: 'Value',
  min: 'Min',
  max: 'Max',
  low: 'Low',
  high: 'High',
  optimum: 'Optimum',
  title: 'Title',
} as const;

export interface ElementSpec {
  element: SemanticElement;
  /** The text the element holds (the fallback text of a meter or progress bar). */
  content?: string;
  /** Blank lines separate paragraphs (details and dialog). */
  paragraphs?: string;
  /** The machine-readable value of a time element. */
  datetime?: string;
  summary?: string;
  open?: boolean;
  /** The name that makes details elements open one at a time. */
  group?: string;
  closedby?: string;
  closeLabel?: string;
  id?: string;
  label?: string;
  value?: string;
  min?: string;
  max?: string;
  low?: string;
  high?: string;
  optimum?: string;
  title?: string;
}

export interface BuiltElement {
  tree: El[];
  /** The copyable markup. */
  html: string;
  /** The same tree with every address removed, so nothing in it can be loaded. */
  preview: string;
  warnings: string[];
}

/** What one element builder returns: the tree, and a different tree for the preview when the plan says so. */
interface Draft {
  tree: El[];
  previewTree?: El[];
  warnings: string[];
}

const MAX_PARAGRAPHS = 50;

function blank(value: string | undefined): boolean {
  return (value ?? '').trim() === '';
}

function text(value: string | undefined): string {
  return value ?? '';
}

/** The first characters of a typed value, for a message. */
function shown(value: string): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > 40 ? `${flat.slice(0, 40)}...` : flat;
}

// ---- Time ---------------------------------------------------------------------------------------------------------

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

function buildTime(spec: ElementSpec): Draft | null {
  const content = text(spec.content);
  const datetime = text(spec.datetime);
  assertSafeText(content, FIELD_LABELS.content);
  assertSafeText(datetime, FIELD_LABELS.datetime);
  if (blank(content) && blank(datetime)) return null;
  if (blank(content)) {
    throw new MarkupError(FIELD_LABELS.content, 'missing, type the text a visitor reads inside the time element');
  }
  if (!blank(datetime)) {
    if (!isValidTimeElementValue(datetime)) throw timeValueError('the datetime value');
    return { tree: [el('time', [['datetime', datetime]], [content])], warnings: [] };
  }
  // With no datetime attribute, the standard reads the text itself as the value.
  if (!isValidTimeElementValue(content))
    throw timeValueError('the text, which is used as the value because no datetime is typed,');
  return { tree: [el('time', [], [content])], warnings: [] };
}

// ---- Shared pieces ------------------------------------------------------------------------------------------------

/** Blank lines separate paragraphs; at most 50, each trimmed, empty ones dropped. */
function paragraphList(value: string, field: string): string[] {
  const parts = value
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length > MAX_PARAGRAPHS) {
    throw new MarkupError(field, `${parts.length} paragraphs, but at most ${MAX_PARAGRAPHS} are written; remove some`);
  }
  return parts;
}

/** An id has no ASCII whitespace and is not empty (WHATWG 3.2.6). */
function checkId(id: string): void {
  if (/[ \t\n\f\r]/.test(id)) {
    throw new MarkupError(
      FIELD_LABELS.id,
      'contains a space or another ASCII whitespace character, which an id cannot hold (WHATWG 3.2.6); use a hyphen instead',
    );
  }
}

/** Lowercase ASCII letters and digits, every other run becomes one hyphen, hyphens at the ends dropped. */
function deriveId(label: string, fallback: string): string {
  const derived = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return derived === '' ? fallback : derived;
}

// ---- details ------------------------------------------------------------------------------------------------------

function buildDetails(spec: ElementSpec): Draft | null {
  const summary = text(spec.summary);
  const group = text(spec.group);
  assertSafeText(summary, FIELD_LABELS.summary);
  assertSafeText(text(spec.paragraphs), FIELD_LABELS.paragraphs, { multiline: true });
  assertSafeText(group, FIELD_LABELS.group);
  const paragraphs = paragraphList(text(spec.paragraphs), FIELD_LABELS.paragraphs);
  if (blank(summary) && paragraphs.length === 0 && group === '') return null;
  // A name must not be the empty string (WHATWG 4.11.1); one made only of spaces would only look empty.
  if (group !== '' && blank(group)) {
    throw new MarkupError(FIELD_LABELS.group, 'only spaces, which is no name at all; type a name or leave it blank');
  }
  if (blank(summary)) {
    throw new MarkupError(
      FIELD_LABELS.summary,
      'missing, type the text a visitor clicks to open the details (a details element starts with one summary)',
    );
  }
  const warnings: string[] = [];
  if (paragraphs.length === 0) {
    warnings.push('The content is blank, so the details element opens to nothing; type the text it should reveal.');
  }
  const details = el(
    'details',
    [
      ['open', spec.open === true],
      ['name', group === '' ? undefined : group],
    ],
    [el('summary', [], [summary]), ...paragraphs.map((p) => el('p', [], [p]))],
  );
  return { tree: [details], warnings };
}

// ---- dialog -------------------------------------------------------------------------------------------------------

const CLOSEDBY_KEYWORDS = ['any', 'closerequest', 'none'] as const;

/** A copy of a dialog with the open attribute added where the markup would write it (after id, before closedby). */
function withOpen(dialog: El): El {
  if (dialog.attrs.some(([name]) => name === 'open')) return dialog;
  const at = dialog.attrs.findIndex(([name]) => name === 'closedby');
  const attrs = [...dialog.attrs];
  attrs.splice(at === -1 ? attrs.length : at, 0, ['open', true]);
  return { tag: dialog.tag, attrs, children: dialog.children };
}

function buildDialog(spec: ElementSpec): Draft | null {
  const closedby = text(spec.closedby);
  const closeLabel = text(spec.closeLabel);
  const id = text(spec.id);
  assertSafeText(text(spec.paragraphs), FIELD_LABELS.paragraphs, { multiline: true });
  assertSafeText(closeLabel, FIELD_LABELS.closeLabel);
  assertSafeText(id, FIELD_LABELS.id);
  assertSafeText(closedby, FIELD_LABELS.closedby);
  const paragraphs = paragraphList(text(spec.paragraphs), FIELD_LABELS.paragraphs);
  if (paragraphs.length === 0 && blank(closeLabel) && blank(id) && closedby === '') return null;
  if (closedby !== '' && !(CLOSEDBY_KEYWORDS as readonly string[]).includes(closedby)) {
    throw new MarkupError(
      FIELD_LABELS.closedby,
      `"${shown(closedby)}" is not a closedby keyword; WHATWG 4.11.4 allows any, closerequest or none, or leave it unset to write no closedby attribute`,
    );
  }
  if (!blank(id)) checkId(id);
  // The standard says tabindex must not be specified on a dialog, so no focus-order attribute is ever written here.
  const dialog = el(
    'dialog',
    [
      ['id', blank(id) ? undefined : id],
      ['open', spec.open === true],
      ['closedby', closedby === '' ? undefined : closedby],
    ],
    [
      ...paragraphs.map((p) => el('p', [], [p])),
      el('form', [['method', 'dialog']], [el('button', [], [blank(closeLabel) ? 'Close' : closeLabel])]),
    ],
  );
  const warnings: string[] = [];
  let previewTree: El[] | undefined;
  if (spec.open !== true) {
    previewTree = [withOpen(dialog)];
    warnings.push(
      'The preview shows the dialog open so you can see it; the markup keeps it closed until script or the open attribute shows it. In the preview, the close button closes the dialog only in some browsers.',
    );
  }
  return { tree: [dialog], previewTree, warnings };
}

// ---- meter and progress -------------------------------------------------------------------------------------------

type NumberField = 'value' | 'min' | 'max' | 'low' | 'high' | 'optimum';

/** A valid floating-point number (WHATWG 2.3.4.3), or a refusal naming the field. */
function floatField(field: NumberField, s: string): number {
  const label = FIELD_LABELS[field];
  const parsed = isValidFloat(s) ? parseValidFloat(s) : null;
  if (parsed === null) {
    throw new MarkupError(
      label,
      `"${shown(s)}" is not a valid floating-point number (WHATWG 2.3.4.3): an optional minus sign, digits with an optional decimal point between or before them, and an optional exponent; no plus sign, no trailing point, no spaces`,
    );
  }
  return parsed;
}

export interface MeterInput {
  value?: string;
  min?: string;
  max?: string;
  low?: string;
  high?: string;
  optimum?: string;
}

export interface MeterNumbers {
  value: number;
  min: number;
  max: number;
  low?: number;
  high?: number;
  optimum?: number;
}

/**
 * The rules of WHATWG 4.10.14: value is required, every number is a valid floating-point number, the minimum is 0 and
 * the maximum 1 when absent, and the five orderings hold: minimum <= value <= maximum, minimum <= low <= maximum,
 * minimum <= high <= maximum, minimum <= optimum <= maximum, and low <= high. Throws a MarkupError naming the field.
 */
export function checkMeter(input: MeterInput): MeterNumbers {
  const given = (s: string | undefined): s is string => !blank(s);
  if (!given(input.value)) {
    throw new MarkupError(FIELD_LABELS.value, 'missing; a meter must have a value (WHATWG 4.10.14)');
  }
  const value = floatField('value', input.value);
  const min = given(input.min) ? floatField('min', input.min) : 0;
  const max = given(input.max) ? floatField('max', input.max) : 1;
  const low = given(input.low) ? floatField('low', input.low) : undefined;
  const high = given(input.high) ? floatField('high', input.high) : undefined;
  const optimum = given(input.optimum) ? floatField('optimum', input.optimum) : undefined;

  const range = `from ${given(input.min) ? 'Min' : 'the default minimum'} ${min} to ${given(input.max) ? 'Max' : 'the default maximum'} ${max}`;
  const inRange = (field: NumberField, n: number): void => {
    if (n < min || n > max) {
      throw new MarkupError(
        FIELD_LABELS[field],
        `${n} is outside the range ${range}; WHATWG 4.10.14 needs the minimum at most ${FIELD_LABELS[field].toLowerCase()} and ${FIELD_LABELS[field].toLowerCase()} at most the maximum`,
      );
    }
  };
  inRange('value', value);
  if (low !== undefined) inRange('low', low);
  if (high !== undefined) inRange('high', high);
  if (optimum !== undefined) inRange('optimum', optimum);
  if (low !== undefined && high !== undefined && low > high) {
    throw new MarkupError(
      FIELD_LABELS.high,
      `Low (${low}) is above High (${high}); WHATWG 4.10.14 needs low at most high`,
    );
  }
  return { value, min, max, low, high, optimum };
}

export interface ProgressInput {
  value?: string;
  max?: string;
}

export interface ProgressNumbers {
  /** Absent for an indeterminate progress bar. */
  value?: number;
  max: number;
}

/**
 * The rules of WHATWG 4.10.13: value and max are valid floating-point numbers, max is above zero (1 when absent), and
 * value is at least 0 and at most max. No value means the progress bar is indeterminate.
 */
export function checkProgress(input: ProgressInput): ProgressNumbers {
  const given = (s: string | undefined): s is string => !blank(s);
  const value = given(input.value) ? floatField('value', input.value) : undefined;
  const max = given(input.max) ? floatField('max', input.max) : 1;
  if (max <= 0) {
    throw new MarkupError(FIELD_LABELS.max, `${max} is not above zero; WHATWG 4.10.13 needs max above zero`);
  }
  if (value !== undefined && (value < 0 || value > max)) {
    throw new MarkupError(
      FIELD_LABELS.value,
      `${value} is outside the range from 0 to ${given(input.max) ? `Max ${max}` : 'the default maximum 1'}; WHATWG 4.10.13 needs value at least 0 and at most max`,
    );
  }
  return { value, max };
}

/** A meter or a progress bar with the label that gives it its accessible name (HTML-AAM 4.1.7). */
function buildGauge(spec: ElementSpec, tag: 'meter' | 'progress'): Draft | null {
  const label = text(spec.label);
  const id = text(spec.id);
  const content = text(spec.content);
  const title = tag === 'meter' ? text(spec.title) : '';
  const numbers: Record<string, string> =
    tag === 'meter'
      ? {
          value: text(spec.value),
          min: text(spec.min),
          max: text(spec.max),
          low: text(spec.low),
          high: text(spec.high),
          optimum: text(spec.optimum),
        }
      : { value: text(spec.value), max: text(spec.max) };
  for (const [field, value] of Object.entries(numbers)) {
    assertSafeText(value, FIELD_LABELS[field as NumberField]);
  }
  assertSafeText(label, FIELD_LABELS.label);
  assertSafeText(id, FIELD_LABELS.id);
  assertSafeText(content, FIELD_LABELS.content);
  assertSafeText(title, FIELD_LABELS.title);
  const everything = [label, id, content, title, ...Object.values(numbers)];
  if (everything.every(blank)) return null;

  // The label is what a screen reader reads for the gauge, so it is always written (HTML-AAM 4.1.7).
  if (blank(label)) {
    throw new MarkupError(
      FIELD_LABELS.label,
      `missing, type the text a visitor reads for the ${tag === 'meter' ? 'gauge' : 'progress bar'}; it gives the element its accessible name`,
    );
  }
  if (!blank(id)) checkId(id);
  const warnings: string[] = [];
  let attrs: [string, string | undefined][];
  if (tag === 'meter') {
    checkMeter(numbers);
    attrs = [
      ['value', numbers.value],
      ['min', blank(numbers.min) ? undefined : numbers.min],
      ['max', blank(numbers.max) ? undefined : numbers.max],
      ['low', blank(numbers.low) ? undefined : numbers.low],
      ['high', blank(numbers.high) ? undefined : numbers.high],
      ['optimum', blank(numbers.optimum) ? undefined : numbers.optimum],
      ['title', blank(title) ? undefined : title],
    ];
  } else {
    const checked = checkProgress(numbers);
    if (checked.value === undefined) {
      warnings.push(
        'No value is written, so this progress bar is indeterminate: it shows that work is happening without saying how far it has got (WHATWG 4.10.13).',
      );
    }
    attrs = [
      ['value', blank(numbers.value) ? undefined : numbers.value],
      ['max', blank(numbers.max) ? undefined : numbers.max],
    ];
  }
  const finalId = blank(id) ? deriveId(label, `${tag}-1`) : id;
  const gauge = el(tag, [['id', finalId], ...attrs], blank(content) ? [] : [content]);
  return { tree: [el('label', [['for', finalId]], [label]), gauge], warnings };
}

/**
 * Builds one semantic element. Returns null when every field it reads is blank, throws MarkupError naming the
 * field and the broken rule when a value is refused. One tree is built; the markup and the preview are both written
 * from it.
 */
export function buildElement(spec: ElementSpec): BuiltElement | null {
  let draft: Draft | null;
  switch (spec.element) {
    case 'details':
      draft = buildDetails(spec);
      break;
    case 'dialog':
      draft = buildDialog(spec);
      break;
    case 'meter':
    case 'progress':
      draft = buildGauge(spec, spec.element);
      break;
    case 'time':
      draft = buildTime(spec);
      break;
    default:
      throw new MarkupError(FIELD_LABELS.element, 'not an element this builder writes');
  }
  if (draft === null) return null;
  return {
    tree: draft.tree,
    html: serialize(draft.tree),
    preview: serialize(inert(draft.previewTree ?? draft.tree)),
    warnings: draft.warnings,
  };
}
