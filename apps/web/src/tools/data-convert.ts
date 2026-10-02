import { meta, convertData, DataConvertError, type ConvertOptions, type DataFormat } from '@fodt/data-convert';
import { dataConvertInWorker, DataConvertRunError } from '../lib/run-data-convert-in-worker';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const LANGUAGE: Record<string, string | undefined> = {
  json: 'json',
  yaml: 'yaml',
  toml: undefined,
  xml: 'xml',
  csv: undefined,
  tsv: undefined,
};

/** True when the source is CSV or TSV, so the header and type settings matter. */
function readsTable(values: Record<string, unknown>): boolean {
  const from = str(values, 'from', 'json');
  return from === 'csv' || from === 'tsv';
}

/** True when either side of the conversion is XML, so the two XML key settings matter. */
function involvesXml(values: Record<string, unknown>): boolean {
  return str(values, 'from', 'json') === 'xml' || str(values, 'to', 'yaml') === 'xml';
}

/** The rules for the formats that need some, shown under the output so the choices made for nesting, attributes and headers are never silent. */
function rulesNote(from: DataFormat, to: DataFormat, options: ConvertOptions): string | null {
  const lines: string[] = [];
  if (from === 'xml' || to === 'xml') {
    const prefix = options.attributePrefix ?? '@_';
    const textKey = options.textKey ?? '#text';
    lines.push(
      `XML: an attribute becomes a key starting with ${prefix === '' ? '(no prefix)' : prefix}, the text of an element that also has attributes or children sits under ${textKey}, repeated elements become an array and every value is text. A DOCTYPE is refused. Comments, processing instructions and the XML declaration are dropped.`,
    );
  }
  if (from === 'csv' || from === 'tsv' || to === 'csv' || to === 'tsv') {
    lines.push(
      'CSV and TSV: nested objects flatten into dotted column names. An array inside a record, a key containing a dot, or rows of unequal length are refused with their path. Records with different keys share one header of every key in order of first appearance, and a missing value is an empty cell. Values are text unless Infer types is on.',
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

export default defineTool({
  id: 'data-convert',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // A YAML source runs in a background worker with a 1.5 second time limit
  // (checking duplicate mapping keys grows quadratically with a flat
  // mapping's key count, the same risk any YAML parse here carries), so that run
  // can be cancelled. The other sources (JSON, TOML, XML, CSV, TSV) stay synchronous.
  cancellable: true,
  fields: [
    {
      name: 'from',
      label: 'From',
      type: 'select',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
        { value: 'xml', label: 'XML' },
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
      ],
    },
    {
      name: 'to',
      label: 'To',
      type: 'select',
      default: 'yaml',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
        { value: 'xml', label: 'XML' },
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'indent',
      label: 'Indent',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
    },
    {
      name: 'attributePrefix',
      label: 'Attribute prefix',
      type: 'text',
      default: '@_',
      help: 'XML attributes become keys that start with this. It can be empty.',
      visible: involvesXml,
    },
    {
      name: 'textKey',
      label: 'Text key',
      type: 'text',
      default: '#text',
      help: 'Where an element text goes when the element also has attributes or children.',
      visible: involvesXml,
    },
    {
      name: 'rootName',
      label: 'Root element',
      type: 'text',
      default: 'root',
      help: 'XML needs one root element; several top-level keys, or a list, are wrapped in this one.',
      visible: (values) => str(values, 'to', 'yaml') === 'xml',
    },
    {
      name: 'rowName',
      label: 'Row element',
      type: 'text',
      default: 'row',
      help: 'Each item of a list is written as an element with this name.',
      visible: (values) => str(values, 'to', 'yaml') === 'xml',
    },
    {
      name: 'headerRow',
      label: 'Header row',
      type: 'checkbox',
      default: true,
      help: 'The first row names the columns. Turn it off to read every row as plain data.',
      visible: readsTable,
    },
    {
      name: 'inferTypes',
      label: 'Infer types',
      type: 'checkbox',
      default: false,
      help: 'Read true, false, null and numbers as typed values. Otherwise every value stays text.',
      visible: readsTable,
    },
  ],
  examples: [
    { label: 'JSON to YAML', values: { from: 'json', to: 'yaml', input: '{"name":"Ada","tags":["a","b"]}' } },
    { label: 'YAML to TOML', values: { from: 'yaml', to: 'toml', input: 'name: Ada\ntags:\n  - a\n  - b\n' } },
    { label: 'TOML to JSON', values: { from: 'toml', to: 'json', input: 'name = "Ada"\n' } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const from = str(values, 'from', 'json') as DataFormat;
    const to = str(values, 'to', 'yaml') as DataFormat;
    const indent = Number(str(values, 'indent', '2')) === 4 ? 4 : 2;
    const options: ConvertOptions = { from, to, indent };
    if (from === 'xml' || to === 'xml') {
      options.attributePrefix = str(values, 'attributePrefix', '@_');
      options.textKey = str(values, 'textKey', '#text');
    }
    if (to === 'xml') {
      options.rootName = str(values, 'rootName', 'root');
      options.rowName = str(values, 'rowName', 'row');
    }
    if (from === 'csv' || from === 'tsv') {
      options.headerRow = bool(values, 'headerRow', true);
      options.inferTypes = bool(values, 'inferTypes', false);
    }

    try {
      // Only a YAML source carries the quadratic duplicate-key risk (the
      // same yaml package that every YAML page here already time-limits), so only it
      // is routed through the worker; the other sources stay
      // synchronous, as JSON and TOML always were.
      const result =
        from === 'yaml'
          ? await dataConvertInWorker({ type: 'data-convert-job', source: input, options }, ctx)
          : convertData(input, options);
      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Output', language: LANGUAGE[to], value: result.output }];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      const rules = rulesNote(from, to, options);
      if (rules !== null) {
        outputs.push({ kind: 'note', label: 'Rules for these formats', tone: 'info', value: rules });
      }
      return {
        outputs,
        stats: [
          ['Input bytes', String(new TextEncoder().encode(input).length)],
          ['Output bytes', String(new TextEncoder().encode(result.output).length)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof DataConvertError || err instanceof DataConvertRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
