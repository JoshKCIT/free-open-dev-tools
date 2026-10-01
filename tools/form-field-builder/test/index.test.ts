import { it, expect } from 'vitest';
import { MarkupError, buildField, deriveId, meta } from '../src/index';
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
