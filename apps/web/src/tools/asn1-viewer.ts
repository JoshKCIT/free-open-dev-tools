import {
  Asn1Error,
  checkFileSize,
  checkPasteSize,
  describeStructure,
  meta,
  withCommas,
  type Description,
} from '@fodt/asn1-viewer';
import { defineTool, files, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the page says first: what it reads and what it never does. */
const FIRST_NOTE =
  'This is read on this device and nothing is uploaded or kept. The page shows structure and values only: it never checks a certificate, a signature or a key, so a structure shown here may be forged or meant for nothing at all. A private key pasted here is shown on screen in full and is sent nowhere.';

/** The personnel record of ITU-T X.690 (02/2021) annex A.3, as hex. */
const EXAMPLE_PERSONNEL =
  '60818561101a044a6f686e1a01501a05536d697468a00a1a084469726563746f72420133a10a43083139373130393137' +
  'a21261101a044d6172791a01541a05536d697468a342311f61111a0552616c70681a01541a05536d697468a00a43083139353731313131' +
  '311f61111a05537573616e1a01421a054a6f6e6573a00a43083139353930373137';

/** A time-stamp request for the SHA-256 of a short text, as Base64. */
const EXAMPLE_TIMESTAMP_REQUEST = 'MDYCAQEwMTANBglghkgBZQMEAgEFAAQgQSfHxCHS9gex5URTmbdlfzZruVLc8d4biaywCoSjV2w=';

function plural(count: number, word: string): string {
  return `${withCommas(count)} ${word}${count === 1 ? '' : 's'}`;
}

function inputBlock(description: Description): OutputBlock {
  const pairs: [string, string][] = [['Form', description.form]];
  if (description.labels.length > 0) pairs.push(['PEM blocks', description.labels.join(', ')]);
  pairs.push(
    ['Bytes', withCommas(description.bytes)],
    ['Elements read', withCommas(description.elements)],
    ['Deepest level', String(description.deepest)],
  );
  return { kind: 'keyvalue', label: 'Input', pairs };
}

function outputsOf(description: Description): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  outputs.push(inputBlock(description));
  if (description.nodes.length === 0) {
    outputs.push({ kind: 'note', tone: 'warn', value: 'No element could be read from this data.' });
  } else {
    outputs.push({ kind: 'tree', label: 'Structure', nodes: description.tree, copyText: description.copyText });
  }
  if (description.findings.length > 0) {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: `${plural(description.findings.length + description.findingsLeftOut, 'finding')} while reading. The first is at offset ${description.findings[0]!.offset}.`,
    });
  }
  return outputs;
}

function failure(err: unknown): ToolResult {
  if (err instanceof Asn1Error) return { outputs: [], errors: [{ message: err.message }] };
  return { outputs: [], errors: [{ message: 'This could not be read as an ASN.1 structure.' }] };
}

export default defineTool({
  id: 'asn1-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Read from',
      type: 'radio',
      default: 'paste',
      options: [
        { value: 'paste', label: 'Pasted text' },
        { value: 'file', label: 'An opened file' },
      ],
    },
    {
      name: 'input',
      label: 'PEM, Base64 or hex',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (values) => values.source !== 'file',
    },
    {
      name: 'file',
      label: 'Open a file',
      type: 'file',
      help: 'Up to 10 MiB. The file is read on this device and nothing is uploaded.',
      visible: (values) => values.source === 'file',
    },
  ],
  examples: [
    { label: 'The personnel record of X.690 annex A.3 (hex)', values: { source: 'paste', input: EXAMPLE_PERSONNEL } },
    { label: 'A time-stamp request (Base64)', values: { source: 'paste', input: EXAMPLE_TIMESTAMP_REQUEST } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      let data: string | Uint8Array;
      if (str(values, 'source', 'paste') === 'file') {
        const picked = files(values, 'file');
        if (picked.length === 0) return { outputs: [] };
        const file = picked[0]!;
        // The size comes from the file object, so an oversized file is refused before any of it is read.
        checkFileSize(file.size);
        data = new Uint8Array(await file.arrayBuffer());
        // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
        if (ctx.signal.aborted) return { outputs: [] };
      } else {
        const pasted = str(values, 'input');
        if (pasted.trim() === '') return { outputs: [] };
        checkPasteSize(pasted.length);
        data = pasted;
      }
      return { outputs: outputsOf(describeStructure({ data })) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
