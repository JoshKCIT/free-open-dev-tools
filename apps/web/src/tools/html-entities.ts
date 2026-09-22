import {
  meta,
  encode,
  decode,
  inspect,
  COMMON_ENTITIES,
  type EncodeStrategy,
  type DecodeStrategy,
} from '@fodt/html-entities';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'html-entities',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'encode',
      options: [
        { value: 'encode', label: 'Encode' },
        { value: 'decode', label: 'Decode' },
      ],
    },
    { name: 'input', label: 'Input', type: 'textarea', rows: 9, placeholder: '<a href="x">Tom & Jerry</a>' },
    {
      name: 'strategy',
      label: 'What to escape',
      type: 'select',
      default: 'minimal',
      options: [
        { value: 'minimal', label: 'Minimal — only & < > " and the apostrophe' },
        { value: 'attribute', label: 'Attribute value — only & and the double quote' },
        { value: 'non-ascii', label: 'Everything above ASCII as well' },
        { value: 'all-named', label: 'Every character that has a name' },
        { value: 'xml', label: 'XML — the five predefined entities only' },
      ],
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'numeric',
      label: 'Use numeric references (&#38;) rather than names (&amp;)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'hexadecimal',
      label: 'Hexadecimal numeric references (&#x26;)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'encode' && v.numeric === true,
    },
    {
      name: 'decodeStrategy',
      label: 'Decoding rules',
      type: 'select',
      default: 'html',
      options: [
        { value: 'html', label: 'HTML5 — accepts references without a semicolon' },
        { value: 'strict', label: 'Strict — a semicolon is required' },
        { value: 'xml', label: 'XML — the five predefined entities only' },
      ],
      visible: (v) => v.direction === 'decode',
    },
  ],
  examples: [
    { label: 'Markup', values: { direction: 'encode', input: '<a href="x">Tom & Jerry</a>' } },
    { label: 'Accents', values: { direction: 'encode', input: 'café © 2026', strategy: 'non-ascii' } },
    { label: 'Decode', values: { direction: 'decode', input: '&lt;p&gt;caf&eacute; &copy; &#128075;&lt;/p&gt;' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) {
      return {
        outputs: [
          {
            kind: 'table',
            label: 'Common entities',
            table: {
              headers: ['Character', 'Named', 'Numeric', 'Name'],
              rows: COMMON_ENTITIES.map((e) => [e.character, e.named, e.decimal, e.name]),
              mono: [0, 1, 2],
            },
          },
        ],
      };
    }

    const outputs: OutputBlock[] = [];

    if (values.direction === 'encode') {
      const encoded = encode(input, {
        strategy: str(values, 'strategy', 'minimal') as EncodeStrategy,
        numeric: bool(values, 'numeric'),
        hexadecimal: bool(values, 'hexadecimal'),
      });
      outputs.push({ kind: 'code', label: 'Encoded', value: encoded, download: 'encoded.html' });
      if (decode(encoded) !== input) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: 'This does not decode back to exactly what you typed. Please report it as a bug.',
        });
      }
      return {
        outputs,
        stats: [
          ['Input', `${input.length} chars`],
          ['Output', `${encoded.length} chars`],
        ],
      };
    }

    const decoded = decode(input, str(values, 'decodeStrategy', 'html') as DecodeStrategy);
    const report = inspect(input);

    outputs.push({ kind: 'code', label: 'Decoded', value: decoded, download: 'decoded.txt' });
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value:
        'Decoded text can contain a script tag, because decoding is the inverse of escaping. Never insert this output into a page as HTML.',
    });

    if (report.found.length > 0) {
      outputs.push({
        kind: 'table',
        label: `${report.found.length} distinct reference${report.found.length === 1 ? '' : 's'} found`,
        table: {
          headers: ['Reference', 'Kind', 'Character', 'Code points'],
          rows: report.found.map((f) => [f.reference, f.kind, f.decoded, f.codePoints]),
          mono: [0, 2, 3],
        },
      });
    }
    if (report.unrecognised.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Not recognised, so left as written: ${report.unrecognised.join(', ')}`,
      });
    }
    if (report.missingSemicolon.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `These have no closing semicolon. HTML5 accepts them, XML does not: ${report.missingSemicolon.join(', ')}`,
      });
    }

    return {
      outputs,
      stats: [
        ['References', String(report.found.length)],
        ['Unrecognised', String(report.unrecognised.length)],
      ],
    };
  },
});
