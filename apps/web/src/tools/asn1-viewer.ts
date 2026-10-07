import {
  Asn1Error,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_NODES,
  MAX_NOTES,
  TREE_DRAWN_NODES,
  checkFileSize,
  checkPasteSize,
  describeStructure,
  meta,
  withCommas,
  type Description,
  type InputFormat,
} from '@fodt/asn1-viewer';
import { bool, defineTool, files, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

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

const FORMATS: ReadonlySet<string> = new Set(['auto', 'pem', 'base64', 'hex']);

function plural(count: number, word: string): string {
  return `${withCommas(count)} ${word}${count === 1 ? '' : 's'}`;
}

/** How the encoding stands against the rules this page checks. It says nothing about what the data means. */
function encodingRules(description: Description): string {
  if (description.findings.some((finding) => finding.kind === 'problem'))
    return 'Not read completely: see the findings';
  return description.derClean ? 'DER, by every rule this page checks' : 'BER, or DER with notes';
}

function inputBlock(description: Description): OutputBlock {
  const pairs: [string, string][] = [['Form', description.form]];
  if (description.labels.length > 0) pairs.push(['PEM blocks', description.labels.join(', ')]);
  pairs.push(
    ['Bytes', withCommas(description.bytes)],
    ['Elements read', withCommas(description.elements)],
    ['Deepest level', String(description.deepest)],
    ['Encoding rules', encodingRules(description)],
  );
  return { kind: 'keyvalue', label: 'Input', pairs };
}

/** One warn note per way reading was cut short, each saying where and how much was left. */
function cutNotes(description: Description): OutputBlock[] {
  const { cut } = description;
  const notes: OutputBlock[] = [];
  if (cut.nodes !== null) {
    notes.push({
      kind: 'note',
      tone: 'warn',
      value: `Reading stopped after ${withCommas(MAX_NODES)} elements, at offset ${cut.nodes.offset}. ${withCommas(cut.nodes.bytesLeft)} bytes were not read.`,
    });
  }
  if (cut.depth !== null) {
    notes.push({
      kind: 'note',
      tone: 'warn',
      value: `${plural(cut.depth.count, 'element')} nested more than ${MAX_DEPTH} levels deep ${cut.depth.count === 1 ? 'was' : 'were'} not entered, the first at offset ${cut.depth.firstOffset}. Their contents are not shown.`,
    });
  }
  if (cut.stopped !== null && cut.depth === null) {
    notes.push({
      kind: 'note',
      tone: 'warn',
      value: `Reading stopped at offset ${cut.stopped.offset}, because the structure cannot be followed from there. ${withCommas(cut.stopped.bytesLeft)} bytes were not read.`,
    });
  }
  return notes;
}

function findingsBlocks(description: Description): OutputBlock[] {
  if (description.findings.length === 0) return [];
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Findings and notes',
      table: {
        headers: ['Offset', 'Kind', 'Text'],
        rows: description.findings.map((finding) => [
          finding.offset,
          finding.kind === 'problem' ? 'problem' : 'note: valid BER, not DER',
          finding.message,
        ]),
        mono: [0],
      },
    },
  ];
  if (description.findingsLeftOut > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(description.findingsLeftOut)} more findings and notes are not listed; the table holds at most ${MAX_NOTES}.`,
    });
  }
  return blocks;
}

function outputsOf(description: Description): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }, inputBlock(description)];
  outputs.push(...cutNotes(description));
  if (description.nodes.length === 0) {
    outputs.push({ kind: 'note', tone: 'warn', value: 'No element could be read from this data.' });
  } else {
    if (description.elements > TREE_DRAWN_NODES) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `The tree draws the first ${withCommas(TREE_DRAWN_NODES)} of ${withCommas(description.elements)} elements. Copy gives every element that was read.`,
      });
    }
    outputs.push({ kind: 'tree', label: 'Structure', nodes: description.tree, copyText: description.copyText });
  }
  outputs.push(...findingsBlocks(description));
  if (description.flat !== undefined) {
    outputs.push({
      kind: 'table',
      label: 'Elements',
      table: { headers: description.flat.headers, rows: description.flat.rows, mono: [0, 1, 2, 3, 5, 8] },
    });
    if (description.flat.leftOut > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `${withCommas(description.flat.leftOut)} elements are not in the table, which lists at most ${withCommas(description.flat.rows.length)}.`,
      });
    }
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
      help: `Up to ${MAX_FILE_BYTES / 1_048_576} MiB. The file is read on this device and nothing is uploaded.`,
      visible: (values) => values.source === 'file',
    },
    {
      name: 'inputFormat',
      label: 'Input form',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Detect: PEM, then hex, then Base64' },
        { value: 'pem', label: 'PEM' },
        { value: 'base64', label: 'Base64 or Base64url' },
        { value: 'hex', label: 'Hex' },
      ],
      help: 'A file that is not text is read as the bytes of the structure whatever is chosen here.',
    },
    {
      name: 'tryInside',
      label: 'Look inside OCTET STRING and BIT STRING contents',
      type: 'checkbox',
      default: true,
      help: 'Contents that read completely as ASN.1 are shown below the string, marked as a guess.',
    },
    {
      name: 'flat',
      label: 'Also list every element in a table',
      type: 'checkbox',
      default: false,
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
      const chosen = str(values, 'inputFormat', 'auto');
      const format = (FORMATS.has(chosen) ? chosen : 'auto') as InputFormat;
      return {
        outputs: outputsOf(
          describeStructure({ data, format, tryInside: bool(values, 'tryInside', true), flat: bool(values, 'flat') }),
        ),
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
