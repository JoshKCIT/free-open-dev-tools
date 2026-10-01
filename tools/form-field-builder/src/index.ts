import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, serialize, type El } from './markup';

export { meta };
export { MarkupError } from './markup';

export type ControlKind = 'text';

export interface FieldSpec {
  control: ControlKind;
  /** The text a visitor reads next to the control. */
  label?: string;
  /** The name the form sends the value under. */
  name?: string;
  /** The control id; worked out from the name when blank. */
  id?: string;
  /** The starting value. */
  value?: string;
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

/** WHATWG 3.2.6: an id may not contain ASCII whitespace, so each run of it becomes one hyphen. */
export function deriveId(name: string): string {
  return name.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').replace(/[\t\n\f\r ]+/g, '-');
}

const LABEL_FIELD = 'Label text';

/**
 * Builds one form field: a label tied to its control by a for value that equals
 * the control id. Returns null when every field it reads is blank.
 */
export function buildField(spec: FieldSpec): BuiltField | null {
  const labelRaw = spec.label ?? '';
  const nameRaw = spec.name ?? '';
  const idRaw = spec.id ?? '';
  const value = spec.value ?? '';
  if ([labelRaw, nameRaw, idRaw, value].every((s) => s.trim() === '')) return null;

  assertSafeText(labelRaw, LABEL_FIELD);
  assertSafeText(nameRaw, 'Name');
  assertSafeText(idRaw, 'Id');
  assertSafeText(value, 'Starting value');

  const label = labelRaw.trim();
  const name = nameRaw.trim();
  if (label === '') throw new MarkupError(LABEL_FIELD, 'missing, type the text a visitor reads next to the control');
  if (name === '') {
    throw new MarkupError(
      'Name',
      'missing, type the name the form sends this value under; the id is worked out from it',
    );
  }
  if (name === 'isindex') {
    throw new MarkupError('Name', 'a name may not be isindex (WHATWG 4.10.19.1); choose another name');
  }
  const typedId = idRaw.trim();
  if (/[\t\n\f\r ]/.test(typedId)) {
    throw new MarkupError('Id', 'contains whitespace, which an id may not (WHATWG 3.2.6); use a hyphen instead');
  }
  const id = typedId !== '' ? typedId : deriveId(name);

  const tree: El[] = [
    el('label', [['for', id]], [label]),
    el('input', [
      ['type', 'text'],
      ['id', id],
      ['name', name],
      ['value', value === '' ? undefined : value],
    ]),
  ];
  return {
    tree,
    html: serialize(tree),
    preview: serialize(inert(tree)),
    warnings: [],
    accessibleName: { name: label.replace(/\s+/g, ' '), from: 'the label element (HTML-AAM 4.1.1)' },
  };
}
