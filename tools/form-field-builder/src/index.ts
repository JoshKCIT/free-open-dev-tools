import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, schemeWarning, serialize, type AttrValue, type El } from './markup';
import {
  compareTyped,
  isValidDate,
  isValidFloat,
  isValidLocalDateTime,
  isValidMonth,
  isValidTime,
  isValidWeek,
  parseValidFloat,
} from './microsyntax';
import {
  AUTOFILL_CONTACT,
  AUTOFILL_CONTACT_TYPES,
  AUTOFILL_GROUP_CONTROLS,
  AUTOFILL_NORMAL,
  INPUT_APPLICABILITY,
  INPUT_TYPES,
} from './spec-data';

export { meta };
export { MarkupError } from './markup';

/** The 22 input types of WHATWG 4.10.5 in the order of its table, then textarea (4.10.11) and select (4.10.7). */
export const CONTROL_KINDS = [...INPUT_TYPES, 'textarea', 'select'] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  control: 'Control',
  label: 'Label text',
  name: 'Name',
  id: 'Id',
  value: 'Starting value',
  options: 'Options',
  flags: 'Flags',
  autocomplete: 'Autocomplete',
  placeholder: 'Placeholder',
  pattern: 'Pattern',
  title: 'Title',
  minlength: 'Minlength',
  maxlength: 'Maxlength',
  size: 'Size',
  min: 'Min',
  max: 'Max',
  step: 'Step',
  accept: 'Accept',
  src: 'Image address (src)',
  alt: 'Alt text (alt)',
  width: 'Width',
  height: 'Height',
  rows: 'Rows',
  cols: 'Columns (cols)',
} as const;

type FieldKey = Exclude<keyof typeof FIELD_LABELS, 'control'>;

export interface FieldSpec {
  control: ControlKind;
  /** The text a visitor reads next to the control (the legend of a radio group). */
  label?: string;
  /** The name the form sends the value under. */
  name?: string;
  /** The control id; worked out from the name when blank. */
  id?: string;
  /** The starting value (for a textarea its text; for a select or radio group, the option value to select). */
  value?: string;
  /** One option per line: value | label (select and radio only). */
  options?: string;
  /** Space-separated boolean attributes: disabled autofocus required readonly multiple checked. */
  flags?: string;
  autocomplete?: string;
  placeholder?: string;
  pattern?: string;
  title?: string;
  minlength?: string;
  maxlength?: string;
  size?: string;
  min?: string;
  max?: string;
  step?: string;
  accept?: string;
  src?: string;
  alt?: string;
  width?: string;
  height?: string;
  rows?: string;
  cols?: string;
}

export interface AccessibleName {
  name: string;
  from: string;
}

export interface BuiltField {
  tree: El[];
  html: string;
  preview: string;
  warnings: string[];
  accessibleName: AccessibleName | null;
}

const FIELD_KEYS = Object.keys(FIELD_LABELS).filter((k) => k !== 'control') as FieldKey[];

const CITE_FORMS = 'WHATWG 4.10.5, 4.10.7 and 4.10.11';
const MAX_RADIO_OPTIONS = 50;
const MAX_SELECT_OPTIONS = 200;

const ASCII_WHITESPACE = /[\t\n\f\r ]+/;

/** WHATWG 3.2.6: an id may not contain ASCII whitespace, so each run of it becomes one hyphen. */
export function deriveId(name: string): string {
  return name.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').replace(/[\t\n\f\r ]+/g, '-');
}

function isControlKind(value: string): value is ControlKind {
  return (CONTROL_KINDS as readonly string[]).includes(value);
}

// ---- Which attributes each control allows ---------------------------------------------------------------------

/** The attributes this builder offers beyond id, name and value. */
const CONSTRAINT_ATTRIBUTES = [
  'autocomplete',
  'placeholder',
  'pattern',
  'minlength',
  'maxlength',
  'size',
  'min',
  'max',
  'step',
  'accept',
  'src',
  'alt',
  'width',
  'height',
  'rows',
  'cols',
] as const;

/** Boolean attributes the Flags field accepts. */
const FLAG_ATTRIBUTES = ['disabled', 'autofocus', 'required', 'readonly', 'multiple', 'checked'] as const;

/**
 * The controls an attribute applies to: the input types from the standard's own table (WHATWG 4.10.5), plus the
 * textarea (4.10.11) and select (4.10.7) lists, plus the global attributes this builder offers.
 */
function homesOf(attribute: string): readonly ControlKind[] {
  const fromTable = INPUT_APPLICABILITY[attribute] ?? [];
  switch (attribute) {
    case 'autocomplete':
      return [...fromTable, 'textarea', 'select'];
    case 'maxlength':
    case 'minlength':
    case 'placeholder':
    case 'readonly':
      return [...fromTable, 'textarea'];
    case 'required':
      return [...fromTable, 'textarea', 'select'];
    case 'size':
    case 'multiple':
      return [...fromTable, 'select'];
    case 'rows':
    case 'cols':
      return ['textarea'];
    case 'disabled':
    case 'autofocus':
      return CONTROL_KINDS;
    case 'title':
      return CONTROL_KINDS.filter((c) => c !== 'hidden');
    default:
      return fromTable;
  }
}

/** The attributes (including the boolean ones) the standard allows on a control and this builder offers. */
export function allowedAttributes(control: ControlKind): string[] {
  const names = [...CONSTRAINT_ATTRIBUTES, 'title', ...FLAG_ATTRIBUTES] as string[];
  return names.filter((a) => homesOf(a).includes(control) && !(control === 'radio' && a === 'checked'));
}

/** The page fields that apply to a control: what the page shows, and the only values the run reads. */
export function visibleFields(control: ControlKind): string[] {
  const fields: string[] = [];
  if (control !== 'hidden') fields.push('label');
  fields.push('name');
  if (control !== 'hidden') fields.push('id');
  if (control !== 'file' && control !== 'image') fields.push('value');
  if (control === 'select' || control === 'radio') fields.push('options');
  fields.push('flags');
  const allowed = allowedAttributes(control);
  for (const a of [...CONSTRAINT_ATTRIBUTES, 'title']) if (allowed.includes(a)) fields.push(a);
  return fields;
}

// ---- Autofill (WHATWG 4.10.19.7) ---------------------------------------------------------------------------

export interface ParsedAutocomplete {
  /** The single keyword on or off, when that is all there is. */
  keyword?: 'on' | 'off';
  section?: string;
  addressType?: string;
  contactType?: string;
  field?: string;
  webauthn: boolean;
  /** The tokens as typed, separated by single spaces. */
  value: string;
}

/**
 * Checks an autocomplete value against the authoring grammar of WHATWG 4.10.19.7.1: an optional section-* token, an
 * optional shipping or billing, then one normal field name or an optional contact type and a contact field name,
 * then an optional webauthn; or on or off alone (not on a hidden input). Tokens compare ASCII case-insensitively.
 * Parsed from the last token backwards, as the processing model of 4.10.19.7.2 does. A field name inappropriate for
 * the control is not part of the grammar for it (its group is listed in 4.10.19.7.1), so it is refused.
 */
export function parseAutocomplete(raw: string, control: ControlKind): ParsedAutocomplete {
  const field = FIELD_LABELS.autocomplete;
  const tokens = raw.split(ASCII_WHITESPACE).filter((t) => t !== '');
  const lower = tokens.map((t) => t.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  const value = tokens.join(' ');
  if (tokens.length === 0) throw new MarkupError(field, 'empty; type a token or leave the field blank');
  const refuse = (message: string): never => {
    throw new MarkupError(field, `${message} (WHATWG 4.10.19.7.1)`);
  };

  if (lower.length === 1 && (lower[0] === 'on' || lower[0] === 'off')) {
    if (control === 'hidden') {
      refuse(
        `${lower[0]} is not allowed on a hidden input, which describes the value it carries and needs a field name`,
      );
    }
    return { keyword: lower[0] as 'on' | 'off', webauthn: false, value };
  }

  let index = lower.length - 1;
  let webauthn = false;
  if (lower[index] === 'webauthn') {
    if (control === 'select') refuse('webauthn is only valid for input and textarea elements, not select');
    webauthn = true;
    index--;
    if (index < 0)
      refuse('webauthn alone is not enough; add the field name it goes with, for example current-password webauthn');
  }

  const fieldName = lower[index] as string;
  const isNormal = Object.prototype.hasOwnProperty.call(AUTOFILL_NORMAL, fieldName);
  const isContact = Object.prototype.hasOwnProperty.call(AUTOFILL_CONTACT, fieldName);
  if (!isNormal && !isContact) {
    if (fieldName === 'on' || fieldName === 'off') {
      refuse(`${fieldName} stands alone; it cannot be combined with other tokens`);
    }
    refuse(`"${tokens[index]}" is not an autofill field name; the last token before webauthn must be one`);
  }
  const group = isNormal ? AUTOFILL_NORMAL[fieldName] : AUTOFILL_CONTACT[fieldName];
  const groupControls = group ? AUTOFILL_GROUP_CONTROLS[group] : [];
  if (!groupControls.includes(control)) {
    const where = groupControls.join(', ');
    refuse(`"${fieldName}" is inappropriate for a ${control} control: its group is ${group}, which covers ${where}`);
  }
  const parsed: ParsedAutocomplete = { field: fieldName, webauthn, value };
  index--;

  if (isContact && index >= 0 && (AUTOFILL_CONTACT_TYPES as readonly string[]).includes(lower[index] as string)) {
    parsed.contactType = lower[index];
    index--;
  }
  if (index >= 0 && (lower[index] === 'shipping' || lower[index] === 'billing')) {
    parsed.addressType = lower[index];
    index--;
  }
  if (index >= 0 && (lower[index] as string).startsWith('section-')) {
    if ((lower[index] as string).length === 'section-'.length) {
      refuse('a section token needs a name after the hyphen, for example section-blue');
    }
    parsed.section = tokens[index];
    index--;
  }
  if (index >= 0) {
    refuse(
      `"${tokens[index]}" is out of place; the order is an optional section-name, an optional shipping or billing, ` +
        'an optional home, work, mobile, fax or pager for the contact names only, the field name, then an optional webauthn',
    );
  }
  return parsed;
}

// ---- Small validators --------------------------------------------------------------------------------------------

function isDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function requireNonNegativeInteger(s: string, field: string, rule: string): bigint {
  if (!isDigits(s)) {
    throw new MarkupError(field, `"${s}" is not a valid non-negative integer; use digits only (${rule})`);
  }
  return BigInt(s);
}

function requirePositiveInteger(s: string, field: string, rule: string): bigint {
  const n = requireNonNegativeInteger(s, field, rule);
  if (n === 0n) throw new MarkupError(field, `must be greater than zero (${rule})`);
  return n;
}

/** The number of characters the standard counts for maxlength: UTF-16 code units, textarea newlines as one. */
function valueLength(value: string, control: ControlKind): number {
  return (control === 'textarea' ? value.replace(/\r\n?/g, '\n') : value).length;
}

function parseFlags(raw: string, control: ControlKind): string[] {
  const field = FIELD_LABELS.flags;
  const allowed = allowedAttributes(control).filter((a) => (FLAG_ATTRIBUTES as readonly string[]).includes(a));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(ASCII_WHITESPACE).filter((t) => t !== '')) {
    const flag = token.replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (!(FLAG_ATTRIBUTES as readonly string[]).includes(flag)) {
      throw new MarkupError(
        field,
        `"${token}" is not a flag this builder writes; a ${control} control allows: ${allowed.join(', ')}`,
      );
    }
    if (control === 'radio' && flag === 'checked') {
      throw new MarkupError(
        field,
        'checked cannot be set for a radio group here; type the option value to select in the starting value instead (WHATWG 4.10.5.1.16)',
      );
    }
    if (!allowed.includes(flag)) {
      throw new MarkupError(
        field,
        `${flag} applies only to ${homesOf(flag).join(', ')} (${CITE_FORMS}); a ${control} control allows: ${allowed.join(', ')}`,
      );
    }
    if (seen.has(flag)) {
      throw new MarkupError(
        field,
        `${flag} is written twice; an attribute may appear only once on an element (WHATWG 13.1.2.3)`,
      );
    }
    seen.add(flag);
    out.push(flag);
  }
  return out;
}

interface OptionLine {
  value: string | undefined;
  text: string;
  line: number;
}

function parseOptionLines(raw: string, kind: 'select' | 'radio'): OptionLine[] {
  const field = FIELD_LABELS.options;
  const cap = kind === 'select' ? MAX_SELECT_OPTIONS : MAX_RADIO_OPTIONS;
  const out: OptionLine[] = [];
  raw.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const n = i + 1;
    const parts = line.split('|');
    if (parts.length > 2) {
      throw new MarkupError(field, `line ${n} has more than one bar; an option is written value | label`);
    }
    const hasBar = parts.length === 2;
    const value = hasBar ? (parts[0] as string).trim() : undefined;
    const text = (hasBar ? (parts[1] as string) : line).trim();
    if (text === '') throw new MarkupError(field, `line ${n} has no label text after the bar`);
    if (kind === 'radio' && hasBar && value === '') {
      throw new MarkupError(
        field,
        `line ${n} has an empty value; every radio button in a group needs its own value (WHATWG 4.10.5.1.16)`,
      );
    }
    out.push({ value: kind === 'radio' && !hasBar ? text : value, text, line: n });
  });
  if (out.length > cap) {
    throw new MarkupError(field, `${out.length} options is more than the ${cap} this builder writes for a ${kind}`);
  }
  return out;
}

function optionValue(o: OptionLine): string {
  return o.value ?? o.text;
}

/** WHATWG 4.10.5.1.17: comma-separated tokens, each audio/*, video/*, image/*, a MIME type or a file extension. */
function parseAccept(raw: string): string[] {
  const field = FIELD_LABELS.accept;
  const tokens = raw.split(',').map((t) => t.trim());
  const seen = new Set<string>();
  const mime = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
  for (const t of tokens) {
    if (t === '')
      throw new MarkupError(field, 'has an empty token; separate tokens with single commas (WHATWG 4.10.5.1.17)');
    const lowerToken = t.toLowerCase();
    const ok =
      lowerToken === 'audio/*' ||
      lowerToken === 'video/*' ||
      lowerToken === 'image/*' ||
      mime.test(t) ||
      (t.startsWith('.') && t.length > 1);
    if (!ok) {
      throw new MarkupError(
        field,
        `"${t}" is not audio/*, video/*, image/*, a MIME type without parameters, or a file extension starting with a dot (WHATWG 4.10.5.1.17)`,
      );
    }
    if (seen.has(lowerToken)) {
      throw new MarkupError(field, `"${t}" appears twice; a token may appear once (WHATWG 4.10.5.1.17)`);
    }
    seen.add(lowerToken);
  }
  return tokens;
}

// ---- Numbers, dates, times and patterns (WHATWG 4.10.5.3) ----------------------------------------------------------

interface TypedRule {
  valid: (s: string) => boolean;
  compare: 'date' | 'month' | 'week' | 'time' | 'datetime-local' | 'number';
  what: string;
}

/** The syntax each control's min, max and starting value must have, from the section that defines its state. */
const TYPED_RULES: Readonly<Record<string, TypedRule>> = {
  date: { valid: isValidDate, compare: 'date', what: 'a valid date string such as 2011-11-18 (WHATWG 2.3.5.2)' },
  month: { valid: isValidMonth, compare: 'month', what: 'a valid month string such as 2011-11 (WHATWG 2.3.5.1)' },
  week: { valid: isValidWeek, compare: 'week', what: 'a valid week string such as 2011-W47 (WHATWG 2.3.5.8)' },
  time: { valid: isValidTime, compare: 'time', what: 'a valid time string such as 14:54 (WHATWG 2.3.5.4)' },
  'datetime-local': {
    valid: isValidLocalDateTime,
    compare: 'datetime-local',
    what: 'a valid local date and time string such as 2011-11-18T14:54 (WHATWG 2.3.5.5)',
  },
  number: {
    valid: isValidFloat,
    compare: 'number',
    what: 'a valid floating-point number such as 1.5 (WHATWG 2.3.4.3)',
  },
  range: { valid: isValidFloat, compare: 'number', what: 'a valid floating-point number such as 1.5 (WHATWG 2.3.4.3)' },
};

/**
 * Checks min, max, step and the starting value of the date, time, number and range controls against the syntax of
 * the control: a step is a floating-point number above zero or any, and max may not be below min except for time,
 * whose range wraps round midnight (WHATWG 4.10.5.3.7 and 4.10.5.3.8). A starting value outside min and max only
 * earns a note, because the standard treats it as out of range rather than as a markup error.
 */
function checkTypedAttributes(
  control: ControlKind,
  min: string,
  max: string,
  step: string,
  value: string,
  warnings: string[],
): void {
  const rule = Object.prototype.hasOwnProperty.call(TYPED_RULES, control) ? TYPED_RULES[control] : undefined;
  if (!rule) return;
  const check = (key: 'min' | 'max' | 'value', v: string): void => {
    if (v !== '' && !rule.valid(v)) {
      throw new MarkupError(FIELD_LABELS[key], `"${v.length > 60 ? v.slice(0, 60) + '...' : v}" is not ${rule.what}`);
    }
  };
  check('min', min);
  check('max', max);
  check('value', value);
  const lowerStep = step.replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (step !== '' && lowerStep !== 'any') {
    const n = parseValidFloat(step);
    if (n === null) {
      throw new MarkupError(
        FIELD_LABELS.step,
        `"${step}" is not a valid floating-point number or the word any (WHATWG 4.10.5.3.8)`,
      );
    }
    if (n <= 0) {
      throw new MarkupError(
        FIELD_LABELS.step,
        `${step} is not greater than zero; use a positive floating-point number or any (WHATWG 4.10.5.3.8)`,
      );
    }
  }
  if (control === 'time') return;
  if (min !== '' && max !== '' && compareTyped(rule.compare, min, max) === 1) {
    throw new MarkupError(
      FIELD_LABELS.max,
      `${max} is less than the min ${min}; the maximum may not be below the minimum (WHATWG 4.10.5.3.7)`,
    );
  }
  if (value !== '') {
    if (min !== '' && compareTyped(rule.compare, value, min) === -1) {
      warnings.push(`The starting value ${value} is below the min ${min}; the standard treats it as out of range.`);
    }
    if (max !== '' && compareTyped(rule.compare, value, max) === 1) {
      warnings.push(`The starting value ${value} is above the max ${max}; the standard treats it as out of range.`);
    }
  }
}

/**
 * WHATWG 4.10.5.3.6: the pattern must match the JavaScript Pattern production with the v flag, and is compiled wrapped
 * in a group between a start and an end anchor. It is only compiled here, never run against any text, so no pattern
 * can stall the page.
 */
function checkPattern(pattern: string): void {
  try {
    new RegExp('^(?:' + pattern + ')$', 'v');
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 160) : 'it does not compile';
    throw new MarkupError(
      FIELD_LABELS.pattern,
      `is not a valid regular expression; the standard compiles it with the v flag: ${why} (WHATWG 4.10.5.3.6)`,
    );
  }
}

// ---- Building ------------------------------------------------------------------------------------------------------

type AttrPair = [string, AttrValue | false | null | undefined];

/**
 * Builds one form field: a label tied to its control by a for value that equals the control id (a radio group is a
 * fieldset with a legend). Returns null when every field it reads is blank.
 */
export function buildField(spec: FieldSpec): BuiltField | null {
  const control = spec.control;
  if (!isControlKind(control)) {
    throw new MarkupError(FIELD_LABELS.control, `"${String(control)}" is not one of the 24 controls offered`);
  }
  const raw = {} as Record<FieldKey, string>;
  for (const key of FIELD_KEYS) raw[key] = spec[key] ?? '';
  if (FIELD_KEYS.every((k) => raw[k].trim() === '')) return null;

  for (const key of FIELD_KEYS) {
    assertSafeText(raw[key], FIELD_LABELS[key], {
      multiline: key === 'options' || (key === 'value' && control === 'textarea'),
    });
  }

  const warnings: string[] = [];
  const t = (key: FieldKey): string => raw[key].trim();

  // Attributes the standard does not allow on this control are refused naming the controls that allow them.
  for (const key of [...CONSTRAINT_ATTRIBUTES, 'title'] as const) {
    if (t(key) !== '' && !homesOf(key).includes(control)) {
      throw new MarkupError(
        FIELD_LABELS[key],
        `the ${key} attribute applies only to ${homesOf(key).join(', ')} (${CITE_FORMS}); it is not written for a ${control} control`,
      );
    }
  }
  if (raw.value !== '' && (control === 'file' || control === 'image')) {
    throw new MarkupError(
      FIELD_LABELS.value,
      `a ${control} input's value attribute must be omitted (WHATWG ${control === 'file' ? '4.10.5.1.17' : '4.10.5.1.19'})`,
    );
  }
  if (t('options') !== '' && control !== 'select' && control !== 'radio') {
    throw new MarkupError(FIELD_LABELS.options, 'options apply only to a select or a radio group');
  }

  // Label, name and id.
  const hidden = control === 'hidden';
  const label = t('label');
  if (!hidden && label === '') {
    throw new MarkupError(FIELD_LABELS.label, 'missing, type the text a visitor reads next to the control');
  }
  const name = t('name');
  const nameOptional = control === 'submit' || control === 'reset' || control === 'button' || control === 'image';
  if (name === '' && !nameOptional) {
    throw new MarkupError(
      FIELD_LABELS.name,
      'missing, type the name the form sends this value under; the id is worked out from it',
    );
  }
  if (name === 'isindex') {
    throw new MarkupError(FIELD_LABELS.name, 'a name may not be isindex (WHATWG 4.10.19.1); choose another name');
  }
  const typedId = t('id');
  if (/[\t\n\f\r ]/.test(typedId)) {
    throw new MarkupError(
      FIELD_LABELS.id,
      'contains whitespace, which an id may not (WHATWG 3.2.6); use a hyphen instead',
    );
  }
  const id = typedId !== '' ? typedId : deriveId(name);
  if (id === '' && !hidden) {
    throw new MarkupError(
      FIELD_LABELS.id,
      'missing; type an id so the label can be tied to the control, or type a name and the id is worked out from it',
    );
  }
  if (hidden) {
    warnings.push('A hidden input is not labelable (WHATWG 4.10.5), so no label is written.');
  }

  // Numbers that must be integers, and the lengths that go together.
  const intAttr = (key: FieldKey, rule: string, positive = false): string | undefined => {
    const v = t(key);
    if (v === '') return undefined;
    if (positive) requirePositiveInteger(v, FIELD_LABELS[key], rule);
    else requireNonNegativeInteger(v, FIELD_LABELS[key], rule);
    return v;
  };
  const minlength = intAttr('minlength', 'WHATWG 4.10.19.4');
  const maxlength = intAttr('maxlength', 'WHATWG 4.10.19.3');
  if (minlength !== undefined && maxlength !== undefined && BigInt(minlength) > BigInt(maxlength)) {
    throw new MarkupError(
      FIELD_LABELS.minlength,
      `${minlength} is more than the maxlength ${maxlength}; the minimum may not exceed the maximum (WHATWG 4.10.19.4)`,
    );
  }
  const size = intAttr('size', control === 'select' ? 'WHATWG 4.10.7' : 'WHATWG 4.10.5.3.2', true);
  const rows = intAttr('rows', 'WHATWG 4.10.11', true);
  const cols = intAttr('cols', 'WHATWG 4.10.11', true);
  const width = intAttr('width', 'WHATWG 4.10.5.1.19');
  const height = intAttr('height', 'WHATWG 4.10.5.1.19');

  const flags = parseFlags(raw.flags, control);

  const autocomplete = t('autocomplete') === '' ? undefined : parseAutocomplete(t('autocomplete'), control).value;

  if (t('placeholder') !== '') {
    warnings.push(
      'A placeholder is a hint, not a label: it disappears once a visitor types, and HTML-AAM 4.1.1 uses it for the name only when no label exists. The label above names the control.',
    );
  }
  if (t('pattern') !== '') {
    checkPattern(t('pattern'));
    if (t('title') === '') {
      warnings.push(
        'The pattern has no title; a title should describe the pattern so a visitor knows what is expected (WHATWG 4.10.5.3.6).',
      );
    }
  }
  checkTypedAttributes(control, t('min'), t('max'), t('step'), raw.value, warnings);
  if (control === 'image' && t('src') !== '') {
    const risky = schemeWarning(FIELD_LABELS.src, t('src'));
    if (risky) warnings.push(risky);
  }

  // The starting value against the lengths.
  const value = control === 'textarea' ? raw.value.replace(/\r\n?/g, '\n') : raw.value;
  if (value !== '' && (maxlength !== undefined || minlength !== undefined)) {
    const length = valueLength(value, control);
    if (maxlength !== undefined && BigInt(length) > BigInt(maxlength)) {
      throw new MarkupError(
        FIELD_LABELS.value,
        `is ${length} characters long, more than the maxlength ${maxlength}; characters are counted as UTF-16 code units, so an emoji counts as two (WHATWG 4.10.19.3)`,
      );
    }
    if (minlength !== undefined && BigInt(length) < BigInt(minlength)) {
      throw new MarkupError(
        FIELD_LABELS.value,
        `is ${length} characters long, fewer than the minlength ${minlength} (WHATWG 4.10.19.4)`,
      );
    }
  }

  const common = (type: string | undefined, valueAttr: string | undefined, withLabelTie: boolean): AttrPair[] => [
    ['type', type],
    ['id', withLabelTie || typedId !== '' ? id : undefined],
    ['name', name === '' ? undefined : name],
    ['value', valueAttr],
    ['placeholder', t('placeholder') === '' ? undefined : t('placeholder')],
    ['autocomplete', autocomplete],
    ['min', t('min') === '' ? undefined : t('min')],
    ['max', t('max') === '' ? undefined : t('max')],
    ['step', t('step') === '' ? undefined : t('step')],
    ['minlength', minlength],
    ['maxlength', maxlength],
    ['size', size],
    ['rows', rows],
    ['cols', cols],
    ['pattern', t('pattern') === '' ? undefined : t('pattern')],
    ['title', t('title') === '' ? undefined : t('title')],
    ['accept', t('accept') === '' ? undefined : parseAccept(t('accept')).join(', ')],
    ['src', t('src') === '' ? undefined : t('src')],
    ['alt', control === 'image' ? t('alt') : undefined],
    ['width', width],
    ['height', height],
    ...flags.map((f): AttrPair => [f, true]),
  ];

  let tree: El[];
  let accessibleName: AccessibleName | null;
  const labelEl = (forId: string, text: string): El => el('label', [['for', forId]], [text]);
  const collapsed = label.replace(/\s+/g, ' ');

  if (control === 'hidden') {
    tree = [el('input', common('hidden', raw.value === '' ? undefined : raw.value, false))];
    accessibleName = null;
  } else if (control === 'textarea') {
    tree = [labelEl(id, label), el('textarea', common(undefined, undefined, true), value === '' ? [] : [value])];
    accessibleName = { name: collapsed, from: 'the label element (HTML-AAM 4.1.1)' };
  } else if (control === 'select') {
    const lines = parseOptionLines(raw.options, 'select');
    if (lines.length === 0) {
      throw new MarkupError(FIELD_LABELS.options, 'missing; type one option per line, for example a | Alpha');
    }
    const multiple = flags.includes('multiple');
    const displaySize = size === undefined ? (multiple ? 4 : 1) : Number(size);
    const first = lines[0] as OptionLine;
    if (flags.includes('required') && !multiple && displaySize === 1 && (first.value ?? first.text) !== '') {
      throw new MarkupError(
        FIELD_LABELS.options,
        `a required select with one visible row needs a first option with an empty value, but line ${first.line} is "${first.text}"; for example make the first line "| Choose one" (WHATWG 4.10.7)`,
      );
    }
    const chosen = raw.value.trim();
    if (chosen !== '' && !lines.some((o) => optionValue(o) === chosen)) {
      throw new MarkupError(
        FIELD_LABELS.value,
        `no option has the value "${chosen}"; type the value of one of the options to select it`,
      );
    }
    const options = lines.map((o) =>
      el(
        'option',
        [
          ['value', o.value],
          ['selected', chosen !== '' && optionValue(o) === chosen],
        ],
        [o.text],
      ),
    );
    tree = [
      labelEl(id, label),
      el(
        'select',
        common(undefined, undefined, true).filter(([n]) => selectAttributes.has(n)),
        options,
      ),
    ];
    accessibleName = { name: collapsed, from: 'the label element (HTML-AAM 4.1.7)' };
  } else if (control === 'radio') {
    const lines = parseOptionLines(raw.options, 'radio');
    if (lines.length < 2) {
      throw new MarkupError(
        FIELD_LABELS.options,
        `${lines.length === 0 ? 'missing' : 'only one option'}; a radio button group needs at least two radio buttons, and a tree must not contain a radio button group with only one (WHATWG 4.10.5.1.16)`,
      );
    }
    const chosen = raw.value.trim();
    if (chosen !== '' && !lines.some((o) => optionValue(o) === chosen)) {
      throw new MarkupError(
        FIELD_LABELS.value,
        `no option has the value "${chosen}"; type the value of one of the options to check it`,
      );
    }
    const children: El[] = [el('legend', [], [label])];
    lines.forEach((o, i) => {
      const rid = `${id}-${i + 1}`;
      children.push(
        el('input', [
          ['type', 'radio'],
          ['id', rid],
          ['name', name],
          ['value', optionValue(o)],
          ['checked', chosen !== '' && optionValue(o) === chosen],
          ...flags.filter((f) => f !== 'autofocus' || i === 0).map((f): AttrPair => [f, true]),
        ]),
        labelEl(rid, o.text),
      );
    });
    tree = [el('fieldset', [['title', t('title') === '' ? undefined : t('title')]], children)];
    accessibleName = { name: collapsed, from: 'the fieldset legend (HTML-AAM 4.1.5)' };
  } else if (control === 'checkbox') {
    tree = [el('input', common('checkbox', raw.value === '' ? undefined : raw.value, true)), labelEl(id, label)];
    accessibleName = { name: collapsed, from: 'the label element (HTML-AAM 4.1.7)' };
  } else if (control === 'submit' || control === 'reset' || control === 'button') {
    const text = raw.value !== '' ? raw.value : label;
    if (raw.value === '') {
      warnings.push(
        'The button text is the label text, so the text a visitor sees equals the accessible name (HTML-AAM 4.1.2).',
      );
    }
    tree = [labelEl(id, label), el('input', common(control, text, true))];
    accessibleName = { name: collapsed, from: 'the label element (HTML-AAM 4.1.2)' };
  } else if (control === 'image') {
    if (t('src') === '')
      throw new MarkupError(
        FIELD_LABELS.src,
        'missing; an image button needs the address of its image (WHATWG 4.10.5.1.19)',
      );
    if (t('alt') === '')
      throw new MarkupError(FIELD_LABELS.alt, 'missing; an image button needs non-empty alt text (WHATWG 4.10.5.1.19)');
    tree = [labelEl(id, label), el('input', common('image', undefined, true))];
    accessibleName = { name: collapsed, from: 'the label element (HTML-AAM 4.1.3)' };
  } else {
    const textLike = ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(control);
    tree = [labelEl(id, label), el('input', common(control, raw.value === '' ? undefined : raw.value, true))];
    accessibleName = { name: collapsed, from: `the label element (HTML-AAM ${textLike ? '4.1.1' : '4.1.7'})` };
  }

  return {
    tree,
    html: serialize(tree),
    preview: serialize(inert(tree)),
    warnings,
    accessibleName,
  };
}

/** The attributes a select element itself carries (the rest of the common list belongs to other controls). */
const selectAttributes: ReadonlySet<string> = new Set([
  'id',
  'name',
  'autocomplete',
  'size',
  'title',
  ...FLAG_ATTRIBUTES,
]);
