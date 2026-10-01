/**
 * Tables copied from the WHATWG HTML Living Standard (last updated 2026-09-29), fetched on the date in
 * SPEC_FETCHED. A later edition of the standard may differ.
 *
 * - INPUT_TYPES: table id attr-input-type-keywords, https://html.spec.whatwg.org/multipage/input.html#attr-input-type-keywords
 * - INPUT_APPLICABILITY: the content attribute rows of table id input-type-attr-summary,
 *   https://html.spec.whatwg.org/multipage/input.html#input-type-attr-summary
 * - AUTOFILL_NORMAL, AUTOFILL_CONTACT and AUTOFILL_GROUP_CONTROLS: the field name table and the control group list
 *   of 4.10.19.7.1, https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 */
export const SPEC_LAST_UPDATED = '2026-09-29';
export const SPEC_FETCHED = '2026-10-01';

/** The 22 values of the input type attribute, in the order of the standard's table. */
export const INPUT_TYPES = [
  'hidden',
  'text',
  'search',
  'tel',
  'url',
  'email',
  'password',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'number',
  'range',
  'color',
  'checkbox',
  'radio',
  'file',
  'submit',
  'image',
  'reset',
  'button',
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

/** Each content attribute of input and the input types it applies to, as the standard's table prints it. */
export const INPUT_APPLICABILITY: Readonly<Record<string, readonly InputType[]>> = {
  accept: ['file'],
  alpha: ['color'],
  alt: ['image'],
  autocomplete: [
    'hidden',
    'text',
    'search',
    'tel',
    'url',
    'email',
    'password',
    'date',
    'month',
    'week',
    'time',
    'datetime-local',
    'number',
    'range',
    'color',
  ],
  checked: ['checkbox', 'radio'],
  colorspace: ['color'],
  dirname: ['hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit'],
  formaction: ['submit', 'image'],
  formenctype: ['submit', 'image'],
  formmethod: ['submit', 'image'],
  formnovalidate: ['submit', 'image'],
  formtarget: ['submit', 'image'],
  height: ['image'],
  list: [
    'text',
    'search',
    'tel',
    'url',
    'email',
    'date',
    'month',
    'week',
    'time',
    'datetime-local',
    'number',
    'range',
    'color',
  ],
  max: ['date', 'month', 'week', 'time', 'datetime-local', 'number', 'range'],
  maxlength: ['text', 'search', 'tel', 'url', 'email', 'password'],
  min: ['date', 'month', 'week', 'time', 'datetime-local', 'number', 'range'],
  minlength: ['text', 'search', 'tel', 'url', 'email', 'password'],
  multiple: ['email', 'file'],
  pattern: ['text', 'search', 'tel', 'url', 'email', 'password'],
  placeholder: ['text', 'search', 'tel', 'url', 'email', 'password', 'number'],
  popovertarget: ['submit', 'image', 'reset', 'button'],
  popovertargetaction: ['submit', 'image', 'reset', 'button'],
  readonly: [
    'text',
    'search',
    'tel',
    'url',
    'email',
    'password',
    'date',
    'month',
    'week',
    'time',
    'datetime-local',
    'number',
  ],
  required: [
    'text',
    'search',
    'tel',
    'url',
    'email',
    'password',
    'date',
    'month',
    'week',
    'time',
    'datetime-local',
    'number',
    'checkbox',
    'radio',
    'file',
  ],
  size: ['text', 'search', 'tel', 'url', 'email', 'password'],
  src: ['image'],
  step: ['date', 'month', 'week', 'time', 'datetime-local', 'number', 'range'],
  width: ['image'],
};

export type AutofillGroup =
  'Text' | 'Multiline' | 'Password' | 'URL' | 'Username' | 'Tel' | 'Numeric' | 'Month' | 'Date';

/** The 44 normal autofill field names, each with its control group. */
export const AUTOFILL_NORMAL: Readonly<Record<string, AutofillGroup>> = {
  name: 'Text',
  'honorific-prefix': 'Text',
  'given-name': 'Text',
  'additional-name': 'Text',
  'family-name': 'Text',
  'honorific-suffix': 'Text',
  nickname: 'Text',
  'organization-title': 'Text',
  username: 'Username',
  'new-password': 'Password',
  'current-password': 'Password',
  'one-time-code': 'Password',
  organization: 'Text',
  'street-address': 'Multiline',
  'address-line1': 'Text',
  'address-line2': 'Text',
  'address-line3': 'Text',
  'address-level4': 'Text',
  'address-level3': 'Text',
  'address-level2': 'Text',
  'address-level1': 'Text',
  country: 'Text',
  'country-name': 'Text',
  'postal-code': 'Text',
  'cc-name': 'Text',
  'cc-given-name': 'Text',
  'cc-additional-name': 'Text',
  'cc-family-name': 'Text',
  'cc-number': 'Text',
  'cc-exp': 'Month',
  'cc-exp-month': 'Numeric',
  'cc-exp-year': 'Numeric',
  'cc-csc': 'Text',
  'cc-type': 'Text',
  'transaction-currency': 'Text',
  'transaction-amount': 'Numeric',
  language: 'Text',
  bday: 'Date',
  'bday-day': 'Numeric',
  'bday-month': 'Numeric',
  'bday-year': 'Numeric',
  sex: 'Text',
  url: 'URL',
  photo: 'URL',
};

/** The 10 contact autofill field names, each with its control group. */
export const AUTOFILL_CONTACT: Readonly<Record<string, AutofillGroup>> = {
  tel: 'Tel',
  'tel-country-code': 'Text',
  'tel-national': 'Text',
  'tel-area-code': 'Text',
  'tel-local': 'Text',
  'tel-local-prefix': 'Text',
  'tel-local-suffix': 'Text',
  'tel-extension': 'Text',
  email: 'Username',
  impp: 'URL',
};

/** The optional contact types that may come before a contact field name. */
export const AUTOFILL_CONTACT_TYPES = ['home', 'work', 'mobile', 'fax', 'pager'] as const;

/** The controls that belong to each group: input type keywords, textarea and select. */
export const AUTOFILL_GROUP_CONTROLS: Readonly<Record<AutofillGroup, readonly string[]>> = {
  Text: ['hidden', 'text', 'search', 'textarea', 'select'],
  Multiline: ['hidden', 'textarea', 'select'],
  Password: ['hidden', 'text', 'search', 'password', 'textarea', 'select'],
  URL: ['hidden', 'text', 'search', 'url', 'textarea', 'select'],
  Username: ['hidden', 'text', 'search', 'email', 'textarea', 'select'],
  Tel: ['hidden', 'text', 'search', 'tel', 'textarea', 'select'],
  Numeric: ['hidden', 'text', 'search', 'number', 'textarea', 'select'],
  Month: ['hidden', 'text', 'search', 'month', 'textarea', 'select'],
  Date: ['hidden', 'text', 'search', 'date', 'textarea', 'select'],
};
