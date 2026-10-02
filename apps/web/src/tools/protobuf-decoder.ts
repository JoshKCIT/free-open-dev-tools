import {
  ProtobufDecoderError,
  checkInputSize,
  decodeProtobufInfo,
  formatDecodeRaw,
  meta,
  readInputBytes,
  type ProtoField,
} from '@fodt/protobuf-decoder';
import { bool, defineTool, files, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The most rows the table shows; the listing above it holds every kept field. */
const TABLE_ROWS = 500;

/** The fields one under another, each message's fields right after it, up to the row limit. */
function rowsOf(fields: ProtoField[], rows: string[][]): void {
  for (const field of fields) {
    if (rows.length >= TABLE_ROWS) return;
    rows.push([
      field.path,
      String(field.number),
      `${field.wireName} (${field.wireType})`,
      String(field.offset),
      field.readings.map((reading) => `${reading.label}: ${reading.value}`).join('\n'),
    ]);
    if (field.children !== undefined) rowsOf(field.children, rows);
  }
}

export default defineTool({
  id: 'protobuf-decoder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // The decoder is linear in the input and the input is capped at 5 MiB, so the decoding runs on the page.
  fields: [
    {
      name: 'file',
      label: 'File',
      type: 'file',
      help: 'Any file holding one Protocol Buffers message, up to 5 MiB, read in your browser. Used instead of the text below when both are given.',
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 8,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The message as hex or Base64, as chosen below. Up to 5 MiB.',
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
    },
    {
      name: 'nested',
      label: 'Nested messages',
      type: 'checkbox',
      default: true,
      help: 'Try to read each length-delimited field as a message of its own. It is a guess: text can look like one.',
    },
    {
      name: 'packed',
      label: 'Packed numbers',
      type: 'checkbox',
      default: false,
      help: 'Try to read each length-delimited field as a run of packed varints, such as 1 2 3 stored as 01 02 03.',
    },
  ],
  examples: [
    {
      // The encoding guide's Test3 message (field 3 holds a message whose field 1 is 150), then its Test2 message.
      label: 'Nested message',
      values: { input: '1a 03 08 96 01 12 07 74 65 73 74 69 6e 67', inputEncoding: 'hex', nested: true, packed: false },
    },
    {
      // The encoding guide's Test4 message: d is hello and e is the packed list 1, 2, 3.
      label: 'Packed numbers',
      values: { input: '22 05 68 65 6c 6c 6f 2a 03 01 02 03', inputEncoding: 'hex', nested: true, packed: true },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      let bytes: Uint8Array;
      const file = files(values, 'file')[0];
      if (file) {
        // A file over the limit is refused before a byte of it is read.
        checkInputSize(file.size);
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        const text = str(values, 'input');
        if (text.trim() === '') return { outputs: [] };
        bytes = readInputBytes(text, str(values, 'inputEncoding', 'hex') === 'base64' ? 'base64' : 'hex');
      }
      if (bytes.length === 0) return { outputs: [] };

      const info = decodeProtobufInfo(bytes, {
        nested: bool(values, 'nested', true),
        packed: bool(values, 'packed', false),
      });
      const rows: string[][] = [];
      rowsOf(info.fields, rows);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Decoded',
          language: 'text',
          value: formatDecodeRaw(info.fields),
          download: 'decoded.txt',
        },
      ];
      if (info.truncated) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: `The message holds ${info.total.toLocaleString('en-US')} fields. The first ${info.fields.length.toLocaleString('en-US')} are shown; the rest were read and checked but are not listed.`,
        });
      }
      outputs.push({
        kind: 'table',
        label: 'Fields',
        table: {
          headers: ['Path', 'Field', 'Wire type', 'Offset', 'Readings'],
          rows,
          mono: [0, 1, 3],
        },
      });
      if (rows.length >= TABLE_ROWS) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `Showing the first ${TABLE_ROWS} rows of the table. The listing above holds every field that was kept.`,
        });
      }
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'Without a schema the readings are guesses: the bytes do not say whether a varint is signed, a fixed value is an integer or a float, or a length-delimited field is text, bytes or a message.',
      });
      return {
        outputs,
        stats: [
          ['Bytes', bytes.length.toLocaleString('en-US')],
          ['Fields', info.total.toLocaleString('en-US')],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof ProtobufDecoderError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not decode that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
