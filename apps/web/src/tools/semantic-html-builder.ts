import {
  meta,
  buildElement,
  MarkupError,
  SEMANTIC_ELEMENTS,
  FIELD_LABELS,
  type ElementSpec,
  type SemanticElement,
} from '@fodt/semantic-html-builder';
import { defineTool, bool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const ELEMENT_LABELS: Record<SemanticElement, string> = {
  details: 'details and summary',
  dialog: 'dialog',
  meter: 'meter',
  progress: 'progress',
  time: 'time',
};

/** Whether the chosen element uses a field, so a value typed before switching element never reaches a run. */
function whenElement(...elements: SemanticElement[]): (values: Values) => boolean {
  return (values) => elements.includes(str(values, 'element', 'details') as SemanticElement);
}

/** The text fields each element reads, in the order the page shows them. */
const READS: Record<SemanticElement, (keyof ElementSpec)[]> = {
  details: ['summary', 'paragraphs', 'group'],
  dialog: ['paragraphs', 'closedby', 'closeLabel', 'id'],
  meter: ['label', 'id', 'value', 'min', 'max', 'low', 'high', 'optimum', 'title', 'content'],
  progress: ['label', 'id', 'value', 'max', 'content'],
  time: ['content', 'datetime'],
};

export default defineTool({
  id: 'semantic-html-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'element',
      label: FIELD_LABELS.element,
      type: 'select',
      default: 'details',
      options: SEMANTIC_ELEMENTS.map((element) => ({ value: element, label: ELEMENT_LABELS[element] })),
    },
    {
      name: 'summary',
      label: FIELD_LABELS.summary,
      type: 'text',
      help: 'The text a visitor clicks to open the details.',
      visible: whenElement('details'),
    },
    {
      name: 'paragraphs',
      label: FIELD_LABELS.paragraphs,
      type: 'textarea',
      rows: 4,
      help: 'Blank lines separate paragraphs.',
      visible: whenElement('details', 'dialog'),
    },
    {
      name: 'open',
      label: FIELD_LABELS.open,
      type: 'checkbox',
      default: false,
      visible: whenElement('details', 'dialog'),
    },
    {
      name: 'group',
      label: FIELD_LABELS.group,
      type: 'text',
      mono: true,
      help: 'Optional. Details elements with the same name open one at a time.',
      visible: whenElement('details'),
    },
    {
      name: 'closedby',
      label: FIELD_LABELS.closedby,
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(not set)' },
        { value: 'any', label: 'any' },
        { value: 'closerequest', label: 'closerequest' },
        { value: 'none', label: 'none' },
      ],
      visible: whenElement('dialog'),
    },
    {
      name: 'closeLabel',
      label: FIELD_LABELS.closeLabel,
      type: 'text',
      placeholder: 'Close',
      help: 'Leave blank to write Close.',
      visible: whenElement('dialog'),
    },
    {
      name: 'label',
      label: FIELD_LABELS.label,
      type: 'text',
      help: 'The text tied to the gauge, which gives it its accessible name.',
      visible: whenElement('meter', 'progress'),
    },
    {
      name: 'id',
      label: FIELD_LABELS.id,
      type: 'text',
      mono: true,
      help: 'Optional. A dialog gets it as its id; a gauge uses it to tie its label. Leave blank to derive it from the label.',
      visible: whenElement('dialog', 'meter', 'progress'),
    },
    {
      name: 'value',
      label: FIELD_LABELS.value,
      type: 'text',
      mono: true,
      placeholder: '0.6',
      help: 'A number such as 0.6 or 70. A progress bar with no value is indeterminate.',
      visible: whenElement('meter', 'progress'),
    },
    {
      name: 'min',
      label: FIELD_LABELS.min,
      type: 'text',
      mono: true,
      help: 'Blank means 0.',
      visible: whenElement('meter'),
    },
    {
      name: 'max',
      label: FIELD_LABELS.max,
      type: 'text',
      mono: true,
      help: 'Blank means 1.',
      visible: whenElement('meter', 'progress'),
    },
    {
      name: 'low',
      label: FIELD_LABELS.low,
      type: 'text',
      mono: true,
      help: 'Where the low range ends.',
      visible: whenElement('meter'),
    },
    {
      name: 'high',
      label: FIELD_LABELS.high,
      type: 'text',
      mono: true,
      help: 'Where the high range starts.',
      visible: whenElement('meter'),
    },
    {
      name: 'optimum',
      label: FIELD_LABELS.optimum,
      type: 'text',
      mono: true,
      help: 'The best value.',
      visible: whenElement('meter'),
    },
    {
      name: 'title',
      label: FIELD_LABELS.title,
      type: 'text',
      help: 'Units, such as percent.',
      visible: whenElement('meter'),
    },
    {
      name: 'content',
      label: FIELD_LABELS.content,
      type: 'text',
      help: 'The words a visitor reads inside the element. For a meter or progress bar, the text shown where the gauge cannot be drawn.',
      visible: whenElement('meter', 'progress', 'time'),
    },
    {
      name: 'datetime',
      label: FIELD_LABELS.datetime,
      type: 'text',
      mono: true,
      placeholder: '2011-11-18T14:54:39.929Z',
      help: 'Machine-readable date or time (the datetime attribute). Two forms: a date such as 2011-11-18, or a global date and time such as 2011-11-18T14:54:39.929Z. Leave blank to use the text as the value.',
      visible: whenElement('time'),
    },
  ],
  examples: [
    {
      label: 'WHATWG 4.5.14: a global date and time',
      values: { element: 'time', content: '18 November 2011, 14:54 UTC', datetime: '2011-11-18T14:54:39.929Z' },
    },
    {
      label: 'WHATWG 4.10.14: a gauge with a label',
      values: { element: 'meter', label: 'Disk usage', value: '0.6', content: '60 percent' },
    },
    {
      label: 'WHATWG 4.11.1: details with a summary',
      values: { element: 'details', summary: 'More', paragraphs: 'Hidden text' },
    },
  ],
  run(values): ToolResult {
    try {
      const element = str(values, 'element', 'details') as SemanticElement;
      const spec: ElementSpec = { element };
      const typed: Record<string, string> = {};
      for (const name of READS[element]) typed[name] = str(values, name);
      Object.assign(spec, typed);
      if (element === 'details' || element === 'dialog') spec.open = bool(values, 'open');
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
