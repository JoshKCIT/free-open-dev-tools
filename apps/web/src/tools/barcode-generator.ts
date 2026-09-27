import { meta, generateBarcode, BarcodeError, type Symbology } from '@fodt/barcode-generator';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default defineTool({
  id: 'barcode-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'symbology',
      label: 'Symbology',
      type: 'select',
      default: 'code128',
      options: [
        { value: 'code128', label: 'Code 128' },
        { value: 'ean13', label: 'EAN-13' },
        { value: 'ean8', label: 'EAN-8' },
        { value: 'upca', label: 'UPC-A' },
      ],
    },
    {
      name: 'data',
      label: 'Data',
      type: 'text',
      mono: true,
      default: '',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'showText', label: 'Show human-readable text', type: 'checkbox', default: true },
    { name: 'moduleWidth', label: 'Module width (pixels)', type: 'number', default: 2, min: 1, max: 10, step: 1 },
    { name: 'height', label: 'Bar height (pixels)', type: 'number', default: 100, min: 20, max: 400, step: 1 },
    { name: 'dark', label: 'Dark colour', type: 'color', default: '#000000' },
    { name: 'light', label: 'Light colour', type: 'color', default: '#ffffff' },
  ],
  examples: [
    { label: 'A Code 128 code', values: { symbology: 'code128', data: 'Hello, World!' } },
    { label: "GS1's own worked UPC-A example", values: { symbology: 'upca', data: '03600024145' } },
  ],
  run(values): ToolResult {
    const symbology = str(values, 'symbology', 'code128') as Symbology;
    const data = str(values, 'data');
    if (!data) return { outputs: [] };
    const showText = bool(values, 'showText', true);
    const moduleWidth = num(values, 'moduleWidth', 2);
    const height = num(values, 'height', 100);
    const dark = str(values, 'dark', '#000000');
    const light = str(values, 'light', '#ffffff');

    try {
      const result = generateBarcode({ symbology, data, moduleWidth, height, showText, dark, light });

      const outputs: OutputBlock[] = [
        {
          kind: 'image',
          label: 'Barcode',
          src: `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(result.svg))}`,
          alt: 'Barcode',
        },
        { kind: 'code', label: 'SVG', language: 'xml', value: result.svg, download: 'barcode.svg' },
        {
          kind: 'keyvalue',
          label: 'Detail',
          pairs: [
            ['Symbology', symbology === 'code128' ? 'Code 128' : symbology.toUpperCase()],
            ['Encoded', result.text],
            [symbology === 'code128' ? 'Check value' : 'Check digit', result.check],
          ],
        },
      ];

      const warnings = [...result.warnings];
      if (result.checkComputed) {
        warnings.push(
          symbology === 'code128' ? 'The check value was computed for you.' : 'The check digit was computed for you.',
        );
      }

      return { outputs, warnings };
    } catch (err) {
      if (err instanceof BarcodeError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.position === undefined ? undefined : 1, column: err.position }],
        };
      }
      throw err;
    }
  },
});
