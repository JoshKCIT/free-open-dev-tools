import { it, expect } from 'vitest';
import {
  CONTROL_KINDS,
  MarkupError,
  allowedAttributes,
  buildField,
  deriveId,
  meta,
  parseAutocomplete,
  type ControlKind,
  type FieldSpec,
} from '../src/index';
import {
  AUTOFILL_CONTACT,
  AUTOFILL_NORMAL,
  INPUT_APPLICABILITY,
  INPUT_TYPES,
  SPEC_FETCHED,
  SPEC_LAST_UPDATED,
} from '../src/spec-data';
import { serialize, inert } from '../src/markup';
import { HOSTILE, accName, attrOf, findAll, parse, shape, textOf } from './parse';

function refusal(run: () => unknown): MarkupError {
  try {
    run();
  } catch (e) {
    if (e instanceof MarkupError) return e;
    throw e;
  }
  throw new Error('expected a MarkupError, but nothing was thrown');
}

it('has the catalog id and name and states its limits', () => {
  expect(meta.id).toBe('form-field-builder');
  expect(meta.name).toBe('HTML Form Field Builder');
  expect(meta.limits.length).toBeGreaterThan(0);
});

it('WHATWG 4.10.4 the label for value equals the control id, and the id is derived from the name', () => {
  // WHATWG 4.10.4: the for value must be the ID of a labelable element in the same tree.
  const field = buildField({ control: 'text', label: 'Full name:', name: 'fn' });
  expect(field).not.toBeNull();
  expect(field!.html).toContain('<label for="fn">Full name:</label>');
  expect(field!.html).toContain('name="fn"');
  const { frag } = parse(field!.html);
  const label = findAll(frag, 'label')[0]!;
  const input = findAll(frag, 'input')[0]!;
  expect(attrOf(label, 'for')).toBe(attrOf(input, 'id'));
  expect(attrOf(input, 'id')).toBe('fn');
  expect(attrOf(input, 'type')).toBe('text');
  // WHATWG 3.2.6: an id may not contain ASCII whitespace; each run of whitespace becomes one hyphen.
  expect(deriveId('first  name')).toBe('first-name');
  expect(deriveId('  a\tb\nc  ')).toBe('a-b-c');
  expect(buildField({ control: 'text', label: 'First name', name: 'first  name' })!.html).toContain('for="first-name"');
  // An explicit id wins, and an id with ASCII whitespace is refused naming Id.
  expect(buildField({ control: 'text', label: 'L', name: 'n', id: 'my-id' })!.html).toContain('for="my-id"');
  const bad = refusal(() => buildField({ control: 'text', label: 'L', name: 'n', id: 'has space' }));
  expect(bad.field).toBe('Id');
  expect(bad.message).toContain('3.2.6');
  // WHATWG 4.10.19.1: a name may not be isindex.
  expect(refusal(() => buildField({ control: 'text', label: 'L', name: 'isindex' })).field).toBe('Name');
});

it('the generated label and text input parse with parse5 with zero parse errors and the preview equals the inert markup', () => {
  const field = buildField({ control: 'text', label: 'Full name:', name: 'fn', value: 'Ada' })!;
  const { frag, errors } = parse(field.html);
  expect(errors).toEqual([]);
  expect(parse(field.preview).errors).toEqual([]);
  expect(field.preview).toBe(serialize(inert(field.tree)));
  // A text input has no address, so the preview is the same markup.
  expect(field.preview).toBe(field.html);
  expect(findAll(frag, 'input')[0]!.attrs.map((a) => a.name)).toEqual(['type', 'id', 'name', 'value']);
  // HTML-AAM 4.1.1: the accessible name of a text input comes from its label.
  expect(accName(frag, findAll(frag, 'input')[0]!)).toBe('Full name:');
  expect(field.accessibleName).toEqual({ name: 'Full name:', from: 'the label element (HTML-AAM 4.1.1)' });
  expect(field.warnings).toEqual([]);
});

it('hostile text in the label, name and value comes out as text', () => {
  const benign = shape(parse(buildField({ control: 'text', label: 'Label', name: 'nm', value: 'v' })!.html).frag);
  for (const hostile of HOSTILE) {
    for (const spec of [
      { label: hostile, name: 'nm', value: 'v' },
      { label: 'Label', name: hostile, value: 'v' },
      { label: 'Label', name: 'nm', value: hostile },
    ]) {
      const field = buildField({ control: 'text', ...spec })!;
      const { frag, errors } = parse(field.html);
      expect(errors).toEqual([]);
      expect(shape(frag)).toBe(benign);
      expect(findAll(frag, 'script')).toHaveLength(0);
    }
  }
  // The text itself survives, as text.
  const field = buildField({ control: 'text', label: HOSTILE[0]!, name: 'nm' })!;
  expect(textOf(findAll(parse(field.html).frag, 'label')[0]!)).toBe(HOSTILE[0]);
  expect(field.html).toContain('&lt;script&gt;');
  // A control character in any field is refused naming that field.
  const control = 'a' + String.fromCharCode(1);
  expect(refusal(() => buildField({ control: 'text', label: control, name: 'n' })).field).toBe('Label text');
  expect(refusal(() => buildField({ control: 'text', label: 'L', name: control })).field).toBe('Name');
  expect(refusal(() => buildField({ control: 'text', label: 'L', name: 'n', value: control })).field).toBe(
    'Starting value',
  );
});

it('blank fields give no output, and a name without a label is reported naming the label', () => {
  expect(buildField({ control: 'text', label: '', name: '', id: '', value: '' })).toBeNull();
  expect(buildField({ control: 'text', label: '  ', name: ' ' })).toBeNull();
  const noLabel = refusal(() => buildField({ control: 'text', label: '', name: 'fn' }));
  expect(noLabel.field).toBe('Label text');
  expect(noLabel.message).toContain('missing');
  const noName = refusal(() => buildField({ control: 'text', label: 'Full name:', name: '' }));
  expect(noName.field).toBe('Name');
});

// ---- Task 2: all 24 controls ------------------------------------------------------------------------------------

/** The smallest valid spec for each control, with a label of Field label and a name of field1. */
function minimalSpec(control: ControlKind): FieldSpec {
  const base: FieldSpec = { control, label: 'Field label', name: 'field1' };
  if (control === 'select') return { ...base, options: 'a | Alpha\nb | Beta' };
  if (control === 'radio') return { ...base, options: 'a | Alpha\nb | Beta' };
  if (control === 'image') return { ...base, src: 'button.png', alt: 'Go' };
  return base;
}

it('WHATWG 4.10.5 the 22 input types plus textarea and select are the 24 controls offered', () => {
  expect(CONTROL_KINDS).toHaveLength(24);
  expect([...CONTROL_KINDS].slice(0, 22)).toEqual([...INPUT_TYPES]);
  expect([...CONTROL_KINDS].slice(22)).toEqual(['textarea', 'select']);
  // The standard's own table order starts with hidden and text and ends with reset and button.
  expect(INPUT_TYPES[0]).toBe('hidden');
  expect(INPUT_TYPES[1]).toBe('text');
  expect(INPUT_TYPES[20]).toBe('reset');
  expect(INPUT_TYPES[21]).toBe('button');
  // Every control builds, parses with zero parse errors and has a preview that parses too.
  for (const control of CONTROL_KINDS) {
    const field = buildField(minimalSpec(control));
    expect(field, control).not.toBeNull();
    expect(parse(field!.html).errors, control).toEqual([]);
    expect(parse(field!.preview).errors, control).toEqual([]);
    expect(field!.preview, control).toBe(serialize(inert(field!.tree)));
  }
  expect(refusal(() => buildField({ ...minimalSpec('text'), control: 'marquee' as ControlKind })).field).toBe(
    'Control',
  );
});

it('WHATWG 4.10.4 every labelable control gets a label tied by for and id, and checkbox and radio put the control first', () => {
  for (const control of CONTROL_KINDS) {
    if (control === 'hidden' || control === 'radio') continue;
    const field = buildField(minimalSpec(control))!;
    const { frag, errors } = parse(field.html);
    expect(errors, control).toEqual([]);
    const labels = findAll(frag, 'label');
    expect(labels, control).toHaveLength(1);
    const target = [...findAll(frag, 'input'), ...findAll(frag, 'textarea'), ...findAll(frag, 'select')][0]!;
    expect(attrOf(labels[0]!, 'for'), control).toBe('field1');
    expect(attrOf(target, 'id'), control).toBe('field1');
    expect(textOf(labels[0]!), control).toBe('Field label');
    const controlFirst = field.html.indexOf('<' + target.tagName) < field.html.indexOf('<label');
    expect(controlFirst, control).toBe(control === 'checkbox');
  }
  // A radio group has one label per radio, each tied to its own id, with the radio first.
  const radio = buildField(minimalSpec('radio'))!;
  const { frag } = parse(radio.html);
  const radios = findAll(frag, 'input');
  const labels = findAll(frag, 'label');
  expect(radios).toHaveLength(2);
  expect(labels).toHaveLength(2);
  radios.forEach((r, i) => expect(attrOf(labels[i]!, 'for')).toBe(attrOf(r, 'id')));
  expect(radio.html.indexOf('<input')).toBeLessThan(radio.html.indexOf('<label'));
  // A textarea or select is labelable too, and the label comes first.
  expect(buildField(minimalSpec('textarea'))!.html.indexOf('<label')).toBe(0);
});

it('WHATWG 4.10.5 the hidden type is not labelable, so no label is written and a note says why', () => {
  const field = buildField({ control: 'hidden', name: 'token', value: 'abc' })!;
  expect(field.html).toBe('<input type="hidden" name="token" value="abc">');
  expect(field.html).not.toContain('<label');
  expect(field.warnings).toHaveLength(1);
  expect(field.warnings[0]).toContain('WHATWG 4.10.5');
  expect(field.warnings[0]).toContain('labelable');
  expect(field.accessibleName).toBeNull();
  expect(parse(field.html).errors).toEqual([]);
  // A hidden input still needs a name, and it describes a value, so on and off are refused for it.
  expect(refusal(() => buildField({ control: 'hidden', value: 'abc' })).field).toBe('Name');
  expect(refusal(() => buildField({ control: 'hidden', name: 'token', autocomplete: 'on' })).field).toBe(
    'Autocomplete',
  );
  // A typed id is written, and none is invented.
  expect(buildField({ control: 'hidden', name: 'token', id: 'tk' })!.html).toContain('id="tk"');
  expect(allowedAttributes('hidden')).not.toContain('title');
});

it('WHATWG 4.10.5 applicability table: pattern on number and min on text are refused naming the types that allow them', () => {
  const pattern = refusal(() => buildField({ ...minimalSpec('number'), pattern: '[0-9]+' }));
  expect(pattern.field).toBe('Pattern');
  for (const type of ['text', 'search', 'tel', 'url', 'email', 'password']) expect(pattern.message).toContain(type);
  expect(pattern.message).not.toContain('number,');
  const min = refusal(() => buildField({ ...minimalSpec('text'), min: '3' }));
  expect(min.field).toBe('Min');
  for (const type of ['date', 'month', 'week', 'time', 'datetime-local', 'number', 'range']) {
    expect(min.message).toContain(type);
  }
  // The rule comes from the standard's table, so it holds for the other attributes too.
  expect(refusal(() => buildField({ ...minimalSpec('text'), accept: 'image/*' })).message).toContain('file');
  expect(refusal(() => buildField({ ...minimalSpec('checkbox'), placeholder: 'x' })).field).toBe('Placeholder');
  expect(refusal(() => buildField({ ...minimalSpec('text'), rows: '3' })).message).toContain('textarea');
  expect(refusal(() => buildField({ ...minimalSpec('date'), maxlength: '4' })).message).toContain('text');
  expect(refusal(() => buildField({ ...minimalSpec('file'), value: 'x.png' })).field).toBe('Starting value');
  expect(refusal(() => buildField({ ...minimalSpec('image'), value: 'x' })).field).toBe('Starting value');
  // And the attributes that are allowed are written, in the order the page documents.
  const ok = buildField({
    ...minimalSpec('text'),
    placeholder: 'Ada',
    pattern: '[a-z]+',
    title: 'Letters',
    minlength: '1',
    maxlength: '9',
    size: '12',
  })!;
  expect(ok.html).toContain(
    '<input type="text" id="field1" name="field1" placeholder="Ada" minlength="1" maxlength="9" size="12" pattern="[a-z]+" title="Letters">',
  );
  expect(parse(ok.html).errors).toEqual([]);
  // minlength may not exceed maxlength, and the lengths and sizes are non-negative integers.
  expect(refusal(() => buildField({ ...minimalSpec('text'), minlength: '5', maxlength: '2' })).field).toBe('Minlength');
  expect(refusal(() => buildField({ ...minimalSpec('text'), maxlength: '-1' })).field).toBe('Maxlength');
  expect(refusal(() => buildField({ ...minimalSpec('text'), size: '0' })).field).toBe('Size');
  expect(refusal(() => buildField({ ...minimalSpec('textarea'), rows: '2.5' })).field).toBe('Rows');
});

it('WHATWG 4.10.19.7 autofill: the section-blue shipping examples of the standard are accepted', () => {
  // WHATWG 4.10.19.7.1 examples, with the control each is written on.
  const examples: [string, ControlKind][] = [
    ['section-blue shipping street-address', 'textarea'],
    ['section-blue shipping address-level2', 'text'],
    ['section-blue shipping postal-code', 'text'],
    ['section-red shipping street-address', 'textarea'],
    ['current-password webauthn', 'password'],
    ['transaction-currency', 'text'],
    ['cc-number', 'text'],
    ['cc-exp', 'month'],
  ];
  for (const [value, control] of examples) {
    expect(() => parseAutocomplete(value, control), value).not.toThrow();
  }
  const parsed = parseAutocomplete('section-blue shipping street-address', 'textarea');
  expect(parsed).toMatchObject({
    section: 'section-blue',
    addressType: 'shipping',
    field: 'street-address',
    webauthn: false,
  });
  expect(parseAutocomplete('section-child shipping home tel', 'tel')).toMatchObject({
    contactType: 'home',
    field: 'tel',
  });
  expect(parseAutocomplete('work email', 'email')).toMatchObject({ contactType: 'work', field: 'email' });
  expect(parseAutocomplete('on', 'text').keyword).toBe('on');
  expect(parseAutocomplete('OFF', 'select').keyword).toBe('off');
  // Tokens compare ASCII case-insensitively.
  expect(() => parseAutocomplete('SECTION-Blue SHIPPING Street-Address', 'textarea')).not.toThrow();
  expect(parseAutocomplete('  section-blue   shipping street-address ', 'textarea').value).toBe(
    'section-blue shipping street-address',
  );
  // The value is written exactly as typed (single spaces) on the control.
  const field = buildField({
    control: 'textarea',
    label: 'Address:',
    name: 'ba',
    autocomplete: 'section-blue shipping street-address',
  })!;
  expect(field.html).toContain('autocomplete="section-blue shipping street-address"');
  expect(field.html).toContain('<label for="ba">Address:</label>');
  expect(parse(field.html).errors).toEqual([]);
});

it('WHATWG 4.10.19.7 autofill: a field name inappropriate for the control, on or off on hidden, home name and a sixth token are handled as the standard says', () => {
  // WHATWG 4.10.19.7.1 lists only the appropriate names in its grammar, so an inappropriate one is refused,
  // naming the group the standard assigns to it.
  const inappropriate = refusal(() => parseAutocomplete('street-address', 'text'));
  expect(inappropriate.field).toBe('Autocomplete');
  expect(inappropriate.message).toContain('Multiline');
  expect(() => parseAutocomplete('bday', 'month')).toThrow(/inappropriate/);
  expect(() => parseAutocomplete('new-password', 'email')).toThrow(/inappropriate/);
  expect(() => parseAutocomplete('name', 'range')).toThrow(/inappropriate/);
  // on and off are not allowed on a hidden input, and stand alone everywhere else.
  expect(() => parseAutocomplete('on', 'hidden')).toThrow(/hidden/);
  expect(() => parseAutocomplete('off', 'hidden')).toThrow(/hidden/);
  expect(() => parseAutocomplete('on name', 'text')).toThrow(/out of place/);
  expect(() => parseAutocomplete('name off', 'text')).toThrow(/stands alone/);
  // The order of the grammar: home belongs only before a contact field name, and name cannot precede tel.
  expect(() => parseAutocomplete('home name', 'text')).toThrow(/out of place/);
  expect(() => parseAutocomplete('name tel', 'tel')).toThrow(/out of place/);
  expect(() => parseAutocomplete('shipping', 'text')).toThrow(/not an autofill field name/);
  expect(() => parseAutocomplete('billing shipping name', 'text')).toThrow(/out of place/);
  // Five tokens are the most the grammar allows; a sixth is out of place.
  expect(() => parseAutocomplete('section-a shipping home tel webauthn', 'tel')).not.toThrow();
  expect(() => parseAutocomplete('extra section-a shipping home tel webauthn', 'tel')).toThrow(/out of place/);
  expect(() => parseAutocomplete('section-a shipping home tel webauthn extra', 'tel')).toThrow(
    /not an autofill field name/,
  );
  // webauthn needs a field name before it and is only valid for input and textarea.
  expect(() => parseAutocomplete('webauthn', 'text')).toThrow(/field name/);
  expect(() => parseAutocomplete('current-password webauthn', 'select')).toThrow(/webauthn/);
  expect(() => parseAutocomplete('section- name', 'text')).toThrow(/after the hyphen/);
  expect(() => parseAutocomplete('', 'text')).toThrow(/empty/);
  expect(() => parseAutocomplete('nickname-x', 'text')).toThrow(/not an autofill field name/);
  // Through the builder: the refusal names the Autocomplete field, and checkbox does not take the attribute at all.
  expect(refusal(() => buildField({ ...minimalSpec('text'), autocomplete: 'street-address' })).field).toBe(
    'Autocomplete',
  );
  expect(refusal(() => buildField({ ...minimalSpec('checkbox'), autocomplete: 'name' })).message).toContain(
    'text, search',
  );
});

it('WHATWG 4.10.7 a required single select needs a placeholder option and the page says how to add one', () => {
  const missing = refusal(() => buildField({ ...minimalSpec('select'), flags: 'required' }));
  expect(missing.field).toBe('Options');
  expect(missing.message).toContain('| Choose one');
  expect(missing.message).toContain('Alpha');
  expect(missing.message).toContain('4.10.7');
  const fixed = buildField({
    ...minimalSpec('select'),
    options: '| Choose one\na | Alpha\nb | Beta',
    flags: 'required',
  })!;
  expect(fixed.html).toBe(
    [
      '<label for="field1">Field label</label>',
      '<select id="field1" name="field1" required>',
      '  <option value="">Choose one</option>',
      '  <option value="a">Alpha</option>',
      '  <option value="b">Beta</option>',
      '</select>',
    ].join('\n'),
  );
  expect(parse(fixed.html).errors).toEqual([]);
  // The rule does not apply to a select that is not required, is multiple, or shows several rows.
  expect(() => buildField({ ...minimalSpec('select'), flags: 'multiple required' })).not.toThrow();
  expect(() => buildField({ ...minimalSpec('select'), flags: 'required', size: '3' })).not.toThrow();
  expect(() => buildField({ ...minimalSpec('select') })).not.toThrow();
  // A select with exactly one option is accepted; a line with no bar is text only; a value marks its option selected.
  const one = buildField({ ...minimalSpec('select'), options: 'Only one' })!;
  expect(one.html).toContain('<option>Only one</option>');
  const selected = buildField({ ...minimalSpec('select'), value: 'b' })!;
  expect(selected.html).toContain('<option value="b" selected>Beta</option>');
  expect(selected.html).not.toContain('<option value="a" selected>');
  // Two bars on a line are refused naming the line number; no options at all are refused naming the options field.
  const twoBars = refusal(() => buildField({ ...minimalSpec('select'), options: 'a | Alpha\nb | Be | ta' }));
  expect(twoBars.field).toBe('Options');
  expect(twoBars.message).toContain('line 2');
  expect(refusal(() => buildField({ ...minimalSpec('select'), options: '' })).field).toBe('Options');
  expect(refusal(() => buildField({ ...minimalSpec('select'), value: 'zzz' })).field).toBe('Starting value');
  const many = Array.from({ length: 201 }, (_, i) => 'o' + i).join('\n');
  expect(refusal(() => buildField({ ...minimalSpec('select'), options: many })).message).toContain('200');
});

it('WHATWG 4.10.5 a radio field is a group of at least two radios in a fieldset with a legend', () => {
  const field = buildField({
    control: 'radio',
    label: 'Size',
    name: 'size',
    options: 'sm | Small\nlg | Large',
    value: 'lg',
    flags: 'required',
  })!;
  expect(field.html).toBe(
    [
      '<fieldset>',
      '  <legend>Size</legend>',
      '  <input type="radio" id="size-1" name="size" value="sm" required>',
      '  <label for="size-1">Small</label>',
      '  <input type="radio" id="size-2" name="size" value="lg" checked required>',
      '  <label for="size-2">Large</label>',
      '</fieldset>',
    ].join('\n'),
  );
  const { frag, errors } = parse(field.html);
  expect(errors).toEqual([]);
  expect(findAll(frag, 'fieldset')).toHaveLength(1);
  expect(textOf(findAll(frag, 'legend')[0]!)).toBe('Size');
  expect(findAll(frag, 'input').every((i) => attrOf(i, 'name') === 'size')).toBe(true);
  // A label alone means the same text for the value and the label; blank lines are skipped.
  const plain = buildField({ ...minimalSpec('radio'), options: 'Yes\n\nNo' })!;
  expect(plain.html).toContain('value="Yes"');
  expect(plain.html).toContain('<label for="field1-2">No</label>');
  // One radio is not a group (WHATWG 4.10.5.1.16), and a group has at most 50.
  const one = refusal(() => buildField({ ...minimalSpec('radio'), options: 'a | Alpha' }));
  expect(one.field).toBe('Options');
  expect(one.message).toContain('4.10.5.1.16');
  expect(refusal(() => buildField({ ...minimalSpec('radio'), options: '' })).field).toBe('Options');
  const fifty = Array.from({ length: 50 }, (_, i) => 'o' + i).join('\n');
  expect(refusal(() => buildField({ ...minimalSpec('radio'), options: fifty + '\nextra' })).message).toContain('50');
  expect(() => buildField({ ...minimalSpec('radio'), options: fifty })).not.toThrow();
  expect(refusal(() => buildField({ ...minimalSpec('radio'), options: '| Alpha\nb | Beta' })).message).toContain(
    'line 1',
  );
  expect(refusal(() => buildField({ ...minimalSpec('radio'), value: 'nope' })).field).toBe('Starting value');
  // The legend names the group in the accessible name computation (HTML-AAM 4.1.5).
  expect(field.accessibleName).toEqual({ name: 'Size', from: 'the fieldset legend (HTML-AAM 4.1.5)' });
});

it('WHATWG 4.10.5 an image button needs a non-empty alt and a file input accepts only valid accept tokens', () => {
  const noAlt = refusal(() => buildField({ control: 'image', label: 'Search', name: 'go', src: 'go.png' }));
  expect(noAlt.field).toBe('Alt text (alt)');
  expect(noAlt.message).toContain('4.10.5.1.19');
  expect(
    refusal(() => buildField({ control: 'image', label: 'Search', name: 'go', src: 'go.png', alt: '  ' })).field,
  ).toBe('Alt text (alt)');
  expect(refusal(() => buildField({ control: 'image', label: 'Search', name: 'go', alt: 'Go' })).field).toBe(
    'Image address (src)',
  );
  const image = buildField({
    control: 'image',
    label: 'Search',
    name: 'go',
    src: 'https://example.invalid/go.png',
    alt: 'Go',
    width: '40',
    height: '20',
  })!;
  expect(image.html).toContain(
    '<input type="image" id="go" name="go" src="https://example.invalid/go.png" alt="Go" width="40" height="20">',
  );
  // The preview carries a data placeholder sized from the width and height, and never the typed address.
  expect(image.preview).not.toContain('example.invalid');
  expect(image.preview).toContain('src="data:image/svg+xml,');
  expect(decodeURIComponent(image.preview)).toContain('width="40" height="20"');
  expect(parse(image.preview).errors).toEqual([]);
  expect(
    refusal(() => buildField({ control: 'image', label: 'S', name: 'go', src: 'a.png', alt: 'Go', width: '4x' })).field,
  ).toBe('Width');
  // File input accept tokens (WHATWG 4.10.5.1.17).
  const file = buildField({ ...minimalSpec('file'), accept: 'image/*,  .pdf, application/pdf' })!;
  expect(file.html).toContain('accept="image/*, .pdf, application/pdf"');
  expect(() => buildField({ ...minimalSpec('file'), accept: 'audio/*,video/*,.PNG' })).not.toThrow();
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: 'image/*, image/*' })).message).toContain('twice');
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: 'image/*, IMAGE/*' })).message).toContain('twice');
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: 'pdf' })).field).toBe('Accept');
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: 'text/plain;charset=utf-8' })).field).toBe(
    'Accept',
  );
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: 'image/*,,.pdf' })).message).toContain('empty');
  expect(refusal(() => buildField({ ...minimalSpec('file'), accept: '.' })).field).toBe('Accept');
});

it('HTML-AAM 4.1.1 and Accname 1.2: the accessible name of every labelable control comes from its label', () => {
  for (const control of CONTROL_KINDS) {
    if (control === 'hidden') continue;
    const field = buildField(minimalSpec(control))!;
    const { frag, errors } = parse(field.html);
    expect(errors, control).toEqual([]);
    if (control === 'radio') {
      expect(accName(frag, findAll(frag, 'fieldset')[0]!), control).toBe('Field label');
      const names = findAll(frag, 'input').map((r) => accName(frag, r));
      expect(names, control).toEqual(['Alpha', 'Beta']);
      expect(field.accessibleName!.name).toBe('Field label');
      continue;
    }
    const target = [...findAll(frag, 'input'), ...findAll(frag, 'textarea'), ...findAll(frag, 'select')][0]!;
    expect(accName(frag, target), control).toBe('Field label');
    expect(field.accessibleName!.name, control).toBe('Field label');
    expect(field.accessibleName!.from, control).toMatch(/^the label element \(HTML-AAM 4\.1\.[1-7]\)$/);
  }
  // A submit button's text equals its label unless a value is typed, and the label still names it (HTML-AAM 4.1.2).
  const submit = buildField({ control: 'submit', label: 'Send', name: 'go' })!;
  expect(submit.html).toContain('<input type="submit" id="go" name="go" value="Send">');
  const { frag } = parse(submit.html);
  expect(accName(frag, findAll(frag, 'input')[0]!)).toBe('Send');
  expect(buildField({ control: 'reset', label: 'Clear', id: 'rs', value: 'Reset all' })!.html).toContain(
    'value="Reset all"',
  );
  // The test-only name function follows the order of HTML-AAM: a label beats a title and a placeholder.
  const both = parse(
    '<label for="x">Real</label><input id="x" title="T" placeholder="P"><input id="y" title="T" placeholder="P"><input id="z" placeholder="P">',
  );
  const inputs = findAll(both.frag, 'input');
  expect(accName(both.frag, inputs[0]!)).toBe('Real');
  expect(accName(both.frag, inputs[1]!)).toBe('T');
  expect(accName(both.frag, inputs[2]!)).toBe('P');
});

it('boolean attributes are written exactly as chosen and refused where the standard does not allow them', () => {
  // Written in the order typed, lowercase, and nothing is added that was not chosen.
  const email = buildField({ ...minimalSpec('email'), flags: 'required readonly' })!;
  expect(email.html).toContain('name="field1" required readonly>');
  expect(buildField({ ...minimalSpec('email'), flags: 'readonly  REQUIRED' })!.html).toContain('readonly required>');
  expect(buildField(minimalSpec('email'))!.html).toBe(
    '<label for="field1">Field label</label>\n<input type="email" id="field1" name="field1">',
  );
  expect(buildField({ ...minimalSpec('textarea'), flags: 'autofocus disabled required readonly' })!.html).toContain(
    'autofocus disabled required readonly></textarea>',
  );
  expect(buildField({ ...minimalSpec('checkbox'), flags: 'checked' })!.html).toContain('name="field1" checked>');
  expect(buildField({ ...minimalSpec('file'), flags: 'multiple required' })!.html).toContain('multiple required>');
  expect(buildField({ ...minimalSpec('select'), flags: 'multiple' })!.html).toContain(
    '<select id="field1" name="field1" multiple>',
  );
  expect(buildField({ ...minimalSpec('button'), flags: 'disabled' })!.html).toContain('disabled>');
  // Refused where the table does not allow them, naming the controls that do.
  const checked = refusal(() => buildField({ ...minimalSpec('email'), flags: 'checked' }));
  expect(checked.field).toBe('Flags');
  expect(checked.message).toContain('checkbox');
  expect(checked.message).toContain('radio');
  expect(refusal(() => buildField({ ...minimalSpec('range'), flags: 'required' })).message).toContain('text');
  expect(refusal(() => buildField({ ...minimalSpec('checkbox'), flags: 'readonly' })).field).toBe('Flags');
  expect(refusal(() => buildField({ ...minimalSpec('text'), flags: 'multiple' })).message).toContain('email');
  expect(refusal(() => buildField({ ...minimalSpec('radio'), flags: 'checked' })).message).toContain('option value');
  // A repeated flag and an unknown token are refused.
  expect(refusal(() => buildField({ ...minimalSpec('text'), flags: 'required required' })).message).toContain('twice');
  expect(refusal(() => buildField({ ...minimalSpec('text'), flags: 'required REQUIRED' })).message).toContain('twice');
  const unknown = refusal(() => buildField({ ...minimalSpec('text'), flags: 'hidden' }));
  expect(unknown.message).toContain('allows: ');
  // Each radio of a group carries the group flags, but autofocus only the first.
  const radio = buildField({ ...minimalSpec('radio'), flags: 'required autofocus' })!;
  expect(radio.html.match(/required/g)).toHaveLength(2);
  expect(radio.html.match(/autofocus/g)).toHaveLength(1);
  // The allowed list is what the page offers.
  expect(allowedAttributes('number')).toEqual(
    expect.arrayContaining(['min', 'max', 'step', 'placeholder', 'required', 'readonly']),
  );
  expect(allowedAttributes('number')).not.toContain('pattern');
  expect(allowedAttributes('select')).toEqual(expect.arrayContaining(['multiple', 'required', 'size']));
});

it('the copied list of input types and autofill field names matches the counts of the standard: 22 types and 54 field names', () => {
  expect(INPUT_TYPES).toHaveLength(22);
  expect(Object.keys(AUTOFILL_NORMAL)).toHaveLength(44);
  expect(Object.keys(AUTOFILL_CONTACT)).toHaveLength(10);
  expect(Object.keys(AUTOFILL_NORMAL).length + Object.keys(AUTOFILL_CONTACT).length).toBe(54);
  expect(Object.keys(INPUT_APPLICABILITY)).toHaveLength(29);
  // Names from the standard's own table, with the control group it prints for each.
  expect(AUTOFILL_NORMAL['street-address']).toBe('Multiline');
  expect(AUTOFILL_NORMAL['cc-exp']).toBe('Month');
  expect(AUTOFILL_NORMAL['bday']).toBe('Date');
  expect(AUTOFILL_NORMAL['username']).toBe('Username');
  expect(AUTOFILL_CONTACT['tel']).toBe('Tel');
  expect(AUTOFILL_CONTACT['email']).toBe('Username');
  expect(AUTOFILL_CONTACT['impp']).toBe('URL');
  // The applicability table as the standard prints it, including its dirname row and the types that take required.
  expect(INPUT_APPLICABILITY['pattern']).toEqual(['text', 'search', 'tel', 'url', 'email', 'password']);
  expect(INPUT_APPLICABILITY['dirname']).toEqual([
    'hidden',
    'text',
    'search',
    'tel',
    'url',
    'email',
    'password',
    'submit',
  ]);
  expect(INPUT_APPLICABILITY['required']).toContain('file');
  expect(INPUT_APPLICABILITY['checked']).toEqual(['checkbox', 'radio']);
  // The copy is dated, so a reader can tell how old it is.
  expect(SPEC_FETCHED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(SPEC_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(meta.about).toContain(SPEC_LAST_UPDATED);
  expect(meta.about).toContain(SPEC_FETCHED);
});
