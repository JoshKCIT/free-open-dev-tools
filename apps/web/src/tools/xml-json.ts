import { meta, xmlToJson, jsonToXml, XmlJsonError } from '@fodt/xml-json';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'xml-json',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'xml-to-json',
      options: [
        { value: 'xml-to-json', label: 'XML to JSON' },
        { value: 'json-to-xml', label: 'JSON to XML' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'attributePrefix', label: 'Attribute prefix', type: 'text', default: '@_' },
    { name: 'textKey', label: 'Text key', type: 'text', default: '#text' },
    {
      name: 'alwaysArray',
      label: 'Always array',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'xml-to-json') === 'xml-to-json',
    },
    {
      name: 'keepOrder',
      label: 'Keep element order',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'xml-to-json') === 'xml-to-json',
    },
    {
      name: 'parseValues',
      label: 'Parse values (numbers and booleans)',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'xml-to-json') === 'xml-to-json',
    },
    {
      name: 'declaration',
      label: 'Include XML declaration',
      type: 'checkbox',
      default: true,
      visible: (values) => str(values, 'direction', 'xml-to-json') === 'json-to-xml',
    },
  ],
  examples: [
    {
      label: 'XML to JSON',
      values: { direction: 'xml-to-json', input: '<book id="1"><title>Moby Dick</title></book>' },
    },
    {
      label: 'JSON to XML',
      values: { direction: 'json-to-xml', input: '{"book":{"@_id":"1","title":"Moby Dick"}}' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const direction = str(values, 'direction', 'xml-to-json');
    const attributePrefix = str(values, 'attributePrefix', '@_');
    const textKey = str(values, 'textKey', '#text');

    try {
      const result =
        direction === 'json-to-xml'
          ? jsonToXml(input, { attributePrefix, textKey, declaration: bool(values, 'declaration', true) })
          : xmlToJson(input, {
              attributePrefix,
              textKey,
              alwaysArray: bool(values, 'alwaysArray'),
              keepOrder: bool(values, 'keepOrder'),
              parseValues: bool(values, 'parseValues'),
            });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Output', language: direction === 'json-to-xml' ? 'xml' : 'json', value: result.output },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      return { outputs, stats: [['Elements', String(result.elements)]] };
    } catch (err) {
      if (err instanceof XmlJsonError) {
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
