import { meta, buildField, MarkupError, type ControlKind } from '@fodt/form-field-builder';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'form-field-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'control',
      label: 'Control',
      type: 'select',
      default: 'text',
      options: [{ value: 'text', label: 'text' }],
    },
    { name: 'label', label: 'Label text', type: 'text', placeholder: 'Full name:' },
    { name: 'name', label: 'Name', type: 'text', mono: true, placeholder: 'fn' },
    { name: 'id', label: 'Id', type: 'text', mono: true, help: 'Leave blank to derive it from the name.' },
    { name: 'value', label: 'Starting value', type: 'text' },
  ],
  examples: [
    {
      label: 'WHATWG 4.10.4 example: a full name field',
      values: { control: 'text', label: 'Full name:', name: 'fn' },
    },
  ],
  run(values): ToolResult {
    try {
      const field = buildField({
        control: str(values, 'control', 'text') as ControlKind,
        label: str(values, 'label'),
        name: str(values, 'name'),
        id: str(values, 'id'),
        value: str(values, 'value'),
      });
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
