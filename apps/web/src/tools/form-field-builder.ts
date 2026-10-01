import {
  meta,
  buildField,
  MarkupError,
  CONTROL_KINDS,
  FIELD_LABELS,
  visibleFields,
  type ControlKind,
  type FieldSpec,
} from '@fodt/form-field-builder';
import { defineTool, str, type Field, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

/** Whether the chosen control uses a field, so a value typed before switching control never reaches a run. */
function shows(name: string): (values: Values) => boolean {
  return (values) => visibleFields(str(values, 'control', 'text') as ControlKind).includes(name);
}

const SINGLE_LINE_FIELDS: Field[] = [
  {
    name: 'autocomplete',
    label: FIELD_LABELS.autocomplete,
    type: 'text',
    mono: true,
    placeholder: 'section-blue shipping street-address',
  },
  { name: 'placeholder', label: FIELD_LABELS.placeholder, type: 'text' },
  { name: 'pattern', label: FIELD_LABELS.pattern, type: 'text', mono: true, placeholder: '[A-Za-z]+' },
  { name: 'title', label: FIELD_LABELS.title, type: 'text' },
  { name: 'minlength', label: FIELD_LABELS.minlength, type: 'text', mono: true },
  { name: 'maxlength', label: FIELD_LABELS.maxlength, type: 'text', mono: true },
  { name: 'size', label: FIELD_LABELS.size, type: 'text', mono: true },
  { name: 'min', label: FIELD_LABELS.min, type: 'text', mono: true },
  { name: 'max', label: FIELD_LABELS.max, type: 'text', mono: true },
  { name: 'step', label: FIELD_LABELS.step, type: 'text', mono: true },
  { name: 'accept', label: FIELD_LABELS.accept, type: 'text', mono: true, placeholder: 'image/*, .pdf' },
  { name: 'src', label: FIELD_LABELS.src, type: 'text', mono: true },
  { name: 'alt', label: FIELD_LABELS.alt, type: 'text' },
  { name: 'width', label: FIELD_LABELS.width, type: 'text', mono: true },
  { name: 'height', label: FIELD_LABELS.height, type: 'text', mono: true },
  { name: 'rows', label: FIELD_LABELS.rows, type: 'text', mono: true },
  { name: 'cols', label: FIELD_LABELS.cols, type: 'text', mono: true },
].map((f) => ({ ...f, type: 'text', visible: shows(f.name) }) as Field);

export default defineTool({
  id: 'form-field-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'control',
      label: FIELD_LABELS.control,
      type: 'select',
      default: 'text',
      options: CONTROL_KINDS.map((kind) => ({ value: kind, label: kind })),
    },
    { name: 'label', label: FIELD_LABELS.label, type: 'text', placeholder: 'Full name:', visible: shows('label') },
    { name: 'name', label: FIELD_LABELS.name, type: 'text', mono: true, placeholder: 'fn', visible: shows('name') },
    {
      name: 'id',
      label: FIELD_LABELS.id,
      type: 'text',
      mono: true,
      help: 'Leave blank to derive it from the name.',
      visible: shows('id'),
    },
    {
      name: 'value',
      label: FIELD_LABELS.value,
      type: 'textarea',
      rows: 2,
      help: 'For a textarea this is its starting text; for other controls one line.',
      visible: shows('value'),
    },
    {
      name: 'options',
      label: FIELD_LABELS.options,
      type: 'textarea',
      rows: 4,
      help: 'One option per line: value | label. A line starting with | has an empty value.',
      visible: shows('options'),
    },
    {
      name: 'flags',
      label: FIELD_LABELS.flags,
      type: 'text',
      mono: true,
      help: 'Space-separated: required, readonly, disabled, multiple, checked, autofocus, where this control allows them.',
      visible: shows('flags'),
    },
    ...SINGLE_LINE_FIELDS,
  ],
  examples: [
    {
      label: 'WHATWG 4.10.4 example: a full name field',
      values: { control: 'text', label: 'Full name:', name: 'fn' },
    },
    {
      label: 'WHATWG 4.10.19.7 example: the blue shipping address',
      values: {
        control: 'textarea',
        label: 'Address:',
        name: 'ba',
        autocomplete: 'section-blue shipping street-address',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const control = str(values, 'control', 'text') as ControlKind;
      const shown = new Set(visibleFields(control));
      const read = (name: string): string => (shown.has(name) ? str(values, name) : '');
      const spec: FieldSpec = { control };
      for (const name of Object.keys(FIELD_LABELS)) {
        if (name === 'control') continue;
        (spec as unknown as Record<string, string>)[name] = read(name);
      }
      const field = buildField(spec);
      if (field === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: field.html, download: 'form-field-builder.html' },
        { kind: 'sandboxed-html', label: 'Preview (addresses replaced, nothing is loaded)', html: field.preview },
      ];
      if (field.accessibleName) {
        outputs.push({
          kind: 'keyvalue',
          label: 'Accessible name',
          pairs: [
            ['Name', field.accessibleName.name],
            ['Comes from', field.accessibleName.from],
          ],
        });
      }
      if (field.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: field.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof MarkupError) return { outputs: [], errors: [{ message: `${err.field}: ${err.message}` }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
