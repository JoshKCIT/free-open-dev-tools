import {
  meta,
  buildElement,
  MarkupError,
  SEMANTIC_ELEMENTS,
  FIELD_LABELS,
  type ElementSpec,
  type SemanticElement,
} from '@fodt/semantic-html-builder';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const ELEMENT_LABELS: Record<SemanticElement, string> = {
  time: 'time',
};

export default defineTool({
  id: 'semantic-html-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'element',
      label: FIELD_LABELS.element,
      type: 'select',
      default: 'time',
      options: SEMANTIC_ELEMENTS.map((element) => ({ value: element, label: ELEMENT_LABELS[element] })),
    },
    {
      name: 'content',
      label: FIELD_LABELS.content,
      type: 'text',
      help: 'The words a visitor reads inside the element.',
    },
    {
      name: 'datetime',
      label: FIELD_LABELS.datetime,
      type: 'text',
      mono: true,
      placeholder: '2011-11-18T14:54:39.929Z',
      help: 'Machine-readable date or time (the datetime attribute). Two forms: a date such as 2011-11-18, or a global date and time such as 2011-11-18T14:54:39.929Z. Leave blank to use the text as the value.',
    },
  ],
  examples: [
    {
      label: 'WHATWG 4.5.14: a global date and time',
      values: { element: 'time', content: '18 November 2011, 14:54 UTC', datetime: '2011-11-18T14:54:39.929Z' },
    },
  ],
  run(values): ToolResult {
    try {
      const spec: ElementSpec = { element: str(values, 'element', 'time') as SemanticElement };
      spec.content = str(values, 'content');
      spec.datetime = str(values, 'datetime');
      const built = buildElement(spec);
      if (built === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: built.html, download: 'semantic-html-builder.html' },
        { kind: 'sandboxed-html', label: 'Preview (addresses replaced, nothing is loaded)', html: built.preview },
      ];
      if (built.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: built.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof MarkupError) return { outputs: [], errors: [{ message: `${err.field}: ${err.message}` }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
