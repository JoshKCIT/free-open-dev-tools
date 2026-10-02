import { MsgpackCborError, checkInputSize, convert, meta, type ConvertResult } from '@fodt/msgpack-cbor';
import { defineTool, files, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'msgpack-cbor',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Both codecs are linear in the input and the input is capped at 5 MiB, so the conversion runs on the page.
  fields: [
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'msgpack',
      options: [
        { value: 'msgpack', label: 'MessagePack' },
        { value: 'cbor', label: 'CBOR' },
      ],
    },
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'to-json',
      options: [
        { value: 'to-json', label: 'To JSON' },
        { value: 'from-json', label: 'From JSON' },
      ],
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      help: 'Any MessagePack or CBOR file, up to 5 MiB, read in your browser. Used instead of the text below when both are given.',
      visible: (v) => str(v, 'direction', 'to-json') === 'to-json',
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Hex or Base64 for To JSON, JSON for From JSON. Up to 5 MiB.',
    },
    {
      name: 'inputEncoding',
      label: 'Input is',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      visible: (v) => str(v, 'direction', 'to-json') === 'to-json',
    },
    {
      name: 'outputEncoding',
      label: 'Output as',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      visible: (v) => str(v, 'direction', 'to-json') === 'from-json',
    },
    {
      name: 'show',
      label: 'Show as',
      type: 'select',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'diagnostic', label: 'Diagnostic notation' },
      ],
      help: 'Diagnostic notation is the text form RFC 8949 prints CBOR in.',
      visible: (v) => str(v, 'format', 'msgpack') === 'cbor' && str(v, 'direction', 'to-json') === 'to-json',
    },
  ],
  examples: [
    {
      // A map holding a byte string: the bytes 01 02 become the $bytes marker.
      label: 'CBOR map with a byte string',
      values: {
        format: 'cbor',
        direction: 'to-json',
        input: 'a2 64 6e616d65 62 6f6b 64 64617461 42 0102',
        inputEncoding: 'hex',
        show: 'json',
      },
    },
    {
      // The timestamp extension in its 64 bit layout: seconds and nanoseconds stay apart.
      label: 'MessagePack timestamp',
      values: {
        format: 'msgpack',
        direction: 'to-json',
        input: 'd7 ff a1 dc d7 c8 5a 4a f6 a5',
        inputEncoding: 'hex',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const format = str(values, 'format', 'msgpack') === 'cbor' ? 'cbor' : 'msgpack';
      const direction = str(values, 'direction', 'to-json') === 'from-json' ? 'from-json' : 'to-json';
      const show = format === 'cbor' && str(values, 'show', 'json') === 'diagnostic' ? 'diagnostic' : 'json';

      let input: string | Uint8Array;
      const file = direction === 'to-json' ? files(values, 'file')[0] : undefined;
      if (file) {
        // A file over the limit is refused before a byte of it is read.
        checkInputSize(file.size);
        input = new Uint8Array(await file.arrayBuffer());
      } else {
        input = str(values, 'input');
        if (input.trim() === '') return { outputs: [] };
      }

      const result: ConvertResult = convert({
        format,
        direction,
        input,
        inputEncoding: str(values, 'inputEncoding', 'hex') === 'base64' ? 'base64' : 'hex',
        outputEncoding: str(values, 'outputEncoding', 'hex') === 'base64' ? 'base64' : 'hex',
        show,
      });

      const outputs: OutputBlock[] = [
        direction === 'to-json'
          ? {
              kind: 'code',
              label: show === 'diagnostic' ? 'Diagnostic notation' : 'JSON',
              language: show === 'diagnostic' ? 'text' : 'json',
              value: result.text,
              download: show === 'diagnostic' ? 'decoded.txt' : 'decoded.json',
            }
          : { kind: 'code', label: 'Encoded', language: 'text', value: result.text, download: 'encoded.txt' },
      ];
      if (result.widths !== undefined) {
        const listed = result.widths.map(([name, count]) => `${name} ${count === 1 ? 'once' : `${count} times`}`);
        outputs.push({
          kind: 'note',
          tone: 'info',
          label: 'Integer and float widths',
          value: `This input used ${listed.join(', ')}. JSON has no widths, so converting back writes the shortest form of each.`,
        });
      }
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', tone: 'warn', value: result.warnings.join(' ') });
      }
      return {
        outputs,
        stats: [
          ['Bytes in', result.bytesIn.toLocaleString('en-US')],
          ['Bytes out', result.bytesOut.toLocaleString('en-US')],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof MsgpackCborError) {
        // The message already says where: a byte offset for binary input, a line and column for JSON.
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not convert that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
