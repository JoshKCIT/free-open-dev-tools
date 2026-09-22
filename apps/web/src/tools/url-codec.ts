import {
  meta,
  encode,
  decode,
  encodeAll,
  isAlreadyEncoded,
  UrlCodecError,
  type UrlEncodingMode,
} from '@fodt/url-codec';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

const MODE_NOTES: Record<UrlEncodingMode, string> = {
  component: 'For one piece of a URL: a path segment, a query value or a fragment. Escapes / ? & = #.',
  uri: 'For a whole URL. Leaves the structural characters alone so the URL still parses.',
  form: 'For an HTML form field. A space becomes a plus sign.',
};

export default defineTool({
  id: 'url-codec',
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
    { name: 'input', label: 'Input', type: 'textarea', rows: 8, placeholder: 'https://example.com/a path?q=1&r=2' },
    {
      name: 'mode',
      label: 'Encoding',
      type: 'radio',
      default: 'component',
      options: [
        { value: 'component', label: 'Component' },
        { value: 'uri', label: 'Whole URL' },
        { value: 'form', label: 'Form field' },
      ],
      help: 'Picking the wrong one here is the usual reason a value arrives corrupted.',
    },
    {
      name: 'strict',
      label: "Also escape ! ' ( ) * as RFC 3986 requires",
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'encode' && v.mode !== 'uri',
    },
    {
      name: 'lowercaseHex',
      label: 'Lowercase hex digits (%2f rather than %2F)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'lenient',
      label: 'Leave malformed escapes alone instead of reporting them',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'decode',
    },
  ],
  examples: [
    { label: 'Query value', values: { direction: 'encode', input: 'name=Ana & Co?', mode: 'component' } },
    {
      label: 'Whole URL',
      values: { direction: 'encode', input: 'https://example.com/a path/ü?q=1&r=a b', mode: 'uri' },
    },
    { label: 'Decode', values: { direction: 'decode', input: 'caf%C3%A9%20%F0%9F%91%8B', mode: 'component' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };
    const mode = str(values, 'mode', 'component') as UrlEncodingMode;

    if (values.direction === 'encode') {
      const primary = encode(input, {
        mode,
        strictRfc3986: bool(values, 'strict'),
        lowercaseHex: bool(values, 'lowercaseHex'),
      });
      const all = encodeAll(input, {
        strictRfc3986: bool(values, 'strict'),
        lowercaseHex: bool(values, 'lowercaseHex'),
      });
      return {
        outputs: [
          { kind: 'code', label: `Encoded (${mode})`, value: primary, download: 'encoded.txt' },
          { kind: 'note', tone: 'info', value: MODE_NOTES[mode] },
          {
            kind: 'table',
            label: 'All three encodings, for comparison',
            table: {
              headers: ['Mode', 'Result'],
              rows: all.map((r) => [r.mode, r.output]),
              mono: [1],
            },
          },
        ],
        stats: [
          ['Input', `${input.length} chars`],
          ['Output', `${primary.length} chars`],
        ],
        warnings: isAlreadyEncoded(input, mode)
          ? [
              'This text already looks percent-encoded. Encoding it again turns every % into %25, which is the classic double-encoding bug.',
            ]
          : undefined,
      };
    }

    try {
      const decoded = decode(input, { mode, onMalformed: bool(values, 'lenient') ? 'keep' : 'throw' });
      return {
        outputs: [
          { kind: 'code', label: 'Decoded', value: decoded, download: 'decoded.txt' },
          { kind: 'note', tone: 'info', value: MODE_NOTES[mode] },
        ],
        stats: [
          ['Input', `${input.length} chars`],
          ['Output', `${decoded.length} chars`],
        ],
      };
    } catch (err) {
      if (err instanceof UrlCodecError) {
        return { outputs: [], errors: [{ message: err.message, column: err.position + 1 }] };
      }
      throw err;
    }
  },
});
