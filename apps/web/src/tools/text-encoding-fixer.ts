import {
  TextEncodingFixerError,
  changeBom,
  checkInputSize,
  convertLineEndingBytes,
  convertLineEndings,
  decodeBytes,
  looksLikeWideText,
  meta,
  parseHex,
  repairMojibake,
  utf8Bytes,
  type RepairFrom,
} from '@fodt/text-encoding-fixer';
import { bool, defineTool, files, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

type Mode = 'decode' | 'repair' | 'eol' | 'bom';

function modeOf(values: Values): Mode {
  const mode = str(values, 'mode', 'repair');
  return mode === 'decode' || mode === 'eol' || mode === 'bom' ? mode : 'repair';
}

/** The text of a count with English grouping. */
function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** How many characters (code points) a text holds. */
function charactersOf(text: string): number {
  let n = 0;
  for (const character of text) {
    void character;
    n++;
  }
  return n;
}

/** The most characters one text block shows; the whole text is offered as a download when it is longer. */
const DISPLAY_CHARACTERS = 1048576;

/** A text block, cut for display when very long, with the whole text as a download then. */
function textBlocks(label: string, text: string, fileName: string): OutputBlock[] {
  if (text.length <= DISPLAY_CHARACTERS) {
    return [{ kind: 'code', label, language: 'text', value: text, download: fileName }];
  }
  let end = DISPLAY_CHARACTERS;
  // Do not cut a surrogate pair in half.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return [
    { kind: 'code', label, language: 'text', value: text.slice(0, end) },
    {
      kind: 'note',
      tone: 'warn',
      value: `Showing the first ${count(end)} of ${count(text.length)} characters. The download holds all of it.`,
    },
    {
      kind: 'files',
      label: 'Whole text',
      files: [{ name: fileName, mime: 'text/plain', content: utf8Bytes(text) }],
    },
  ];
}

/** The line numbers of a list, the first 50 and a count of the rest. */
function lineList(lines: number[]): string {
  const shown = lines.slice(0, 50).join(', ');
  return lines.length > 50 ? `${shown} and ${count(lines.length - 50)} more` : shown;
}

/** The bytes to work on: the picked file (size checked before it is read), else the pasted hex, else nothing. */
async function pickedBytes(values: Values): Promise<{ bytes: Uint8Array; fromFile: boolean } | undefined> {
  const file = files(values, 'file')[0];
  if (file) {
    checkInputSize(file.size);
    return { bytes: new Uint8Array(await file.arrayBuffer()), fromFile: true };
  }
  const hexText = str(values, 'hex');
  if (hexText.trim() === '') return undefined;
  return { bytes: parseHex(hexText), fromFile: false };
}

async function decode(values: Values): Promise<ToolResult> {
  const picked = await pickedBytes(values);
  if (picked === undefined) return { outputs: [] };
  const { bytes } = picked;
  if (bytes.length === 0) {
    return { outputs: [{ kind: 'note', tone: 'info', value: 'There are no bytes to decode.' }] };
  }
  const label = str(values, 'encoding', 'windows-1252');
  const result = decodeBytes(bytes, label, { strictLatin1: bool(values, 'strictLatin1', false) });
  const outputs: OutputBlock[] = textBlocks('Decoded text', result.text, 'decoded.txt');
  const asked = label.trim().toLowerCase();
  if (result.encoding === 'iso-8859-1') {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `True ISO-8859-1 was used for the label ${asked}: bytes 80 to 9F are control characters. The WHATWG Encoding Standard would read them as Windows-1252 letters and symbols.`,
    });
  } else if (asked !== result.encoding) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `The label ${asked} means ${result.encoding} in the WHATWG Encoding Standard.`,
    });
  }
  if (result.text.charCodeAt(0) === 0xfeff) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value:
        'The bytes start with a byte order mark. It is kept as the character U+FEFF at the start of the text; use Byte order mark mode to remove it.',
    });
  }
  if (result.replacements > 0) {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: `The text holds ${count(result.replacements)} replacement character${result.replacements === 1 ? '' : 's'} (U+FFFD): bytes that are not valid in ${result.encoding}, or characters the bytes spell out.`,
    });
  }
  return {
    outputs,
    stats: [
      ['Encoding', result.encoding],
      ['Bytes', count(bytes.length)],
      ['Characters', count(charactersOf(result.text))],
    ],
  };
}

function repair(values: Values): ToolResult {
  const text = str(values, 'text');
  if (text === '') return { outputs: [] };
  const from: RepairFrom = str(values, 'repairFrom', 'windows-1252') === 'iso-8859-1' ? 'iso-8859-1' : 'windows-1252';
  const perLine = bool(values, 'perLine', false);
  const readAs = from === 'windows-1252' ? 'Windows-1252' : 'ISO-8859-1';
  const result = repairMojibake(text, from, { perLine });
  const before = charactersOf(text);
  const after = charactersOf(result.text);
  const outputs: OutputBlock[] = textBlocks('Repaired text', result.text, 'repaired.txt');
  const hint = 'If only some lines are garbled, turn on Line by line.';
  if (result.changed) {
    outputs.push({
      kind: 'note',
      tone: 'success',
      value: `Repaired: ${count(before)} characters became ${count(after)}.`,
    });
  } else if (result.problem?.kind === 'outside-table') {
    const { position, character = '' } = result.problem;
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '';
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value:
        `Nothing was repaired. Character ${count(position)} (U+${code}) cannot come from UTF-8 read as ${readAs}, so the text is either already correct or garbled some other way. ${perLine ? '' : hint}`.trim(),
    });
  } else if (result.problem?.kind === 'not-utf8') {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value:
        `Nothing was repaired. The bytes behind the text stop being UTF-8 at character ${count(result.problem.position)}, so the text is either already correct or garbled some other way. ${perLine ? '' : hint}`.trim(),
    });
  } else if (result.unrepairedLines.length === 0) {
    outputs.push({ kind: 'note', tone: 'info', value: 'Nothing needed repair.' });
  } else {
    outputs.push({ kind: 'note', tone: 'warn', value: 'Nothing was repaired.' });
  }
  if (perLine && result.unrepairedLines.length > 0) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `Lines left as they were (already correct, or not garbled this way): ${lineList(result.unrepairedLines)}.`,
    });
  }
  return {
    outputs,
    stats: [
      ['Characters before', count(before)],
      ['Characters after', count(after)],
    ],
  };
}

async function lineEndings(values: Values): Promise<ToolResult> {
  const choice = str(values, 'eol', 'lf');
  const eol = choice === 'crlf' || choice === 'cr' ? choice : 'lf';
  // A picked file is converted byte for byte: a text box cannot hold a carriage return, because the browser turns every
  // line break typed or pasted into it into a line feed.
  const file = files(values, 'file')[0];
  if (file) {
    checkInputSize(file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) {
      return { outputs: [{ kind: 'note', tone: 'info', value: 'The file is empty, so nothing changed.' }] };
    }
    const converted = convertLineEndingBytes(bytes, eol);
    const total = converted.counts.lf + converted.counts.crlf + converted.counts.cr;
    const wide: OutputBlock[] = looksLikeWideText(bytes)
      ? [
          {
            kind: 'note',
            tone: 'warn',
            value:
              'Most line endings in this file sit next to zero bytes (00), which is how UTF-16 and UTF-32 write them when the file has no byte order mark. This page converts one byte at a time, so the result is not valid text in that encoding. Decode the file to text first.',
          },
        ]
      : [];
    return {
      outputs: [
        {
          kind: 'files',
          label: 'Download the bytes',
          files: [
            {
              name: file.name === '' ? 'converted.txt' : file.name,
              mime: 'application/octet-stream',
              content: converted.bytes,
            },
          ],
        },
        total === 0
          ? { kind: 'note', tone: 'info', value: 'The file has no line endings, so nothing changed.' }
          : { kind: 'note', tone: 'success', value: `Converted ${count(total)} line ending${total === 1 ? '' : 's'}.` },
        ...wide,
      ],
      stats: [
        ['LF found', count(converted.counts.lf)],
        ['CRLF found', count(converted.counts.crlf)],
        ['CR found', count(converted.counts.cr)],
        ['Bytes before', count(bytes.length)],
        ['Bytes after', count(converted.bytes.length)],
      ],
    };
  }
  const text = str(values, 'text');
  if (text === '') return { outputs: [] };
  const result = convertLineEndings(text, eol);
  const found = result.counts.lf + result.counts.crlf + result.counts.cr;
  const outputs: OutputBlock[] = textBlocks('Converted text', result.text, 'converted.txt');
  // The exact bytes (UTF-8) of the converted text, because a line ending is a bytes question.
  if (result.text.length <= DISPLAY_CHARACTERS) {
    outputs.push({
      kind: 'files',
      label: 'Download the bytes',
      files: [{ name: 'converted.txt', mime: 'text/plain', content: utf8Bytes(result.text) }],
    });
  }
  outputs.push(
    found === 0
      ? { kind: 'note', tone: 'info', value: 'The text has no line endings, so nothing changed.' }
      : { kind: 'note', tone: 'success', value: `Converted ${count(found)} line ending${found === 1 ? '' : 's'}.` },
  );
  return {
    outputs,
    stats: [
      ['LF found', count(result.counts.lf)],
      ['CRLF found', count(result.counts.crlf)],
      ['CR found', count(result.counts.cr)],
    ],
  };
}

async function byteOrderMark(values: Values): Promise<ToolResult> {
  let bytes: Uint8Array;
  const picked = await pickedBytes(values);
  // A file is used first, then the hex, then the text box; when two of them hold something the page says which it used.
  let precedence: OutputBlock | undefined;
  if (picked) {
    bytes = picked.bytes;
    const text = str(values, 'text');
    if (picked.fromFile && (text !== '' || str(values, 'hex').trim() !== '')) {
      precedence = {
        kind: 'note',
        tone: 'info',
        value: 'A file is attached, so it was used; the text and the hex boxes were ignored.',
      };
    } else if (!picked.fromFile && text !== '') {
      precedence = {
        kind: 'note',
        tone: 'info',
        value:
          'Both the Text box and the Bytes as hex box hold something. The hex was used and the Text box was ignored.',
      };
    }
  } else {
    const text = str(values, 'text');
    if (text === '') return { outputs: [] };
    bytes = utf8Bytes(text);
  }
  const choice = str(values, 'bom', 'add-utf8');
  const action =
    choice === 'add-utf16le' || choice === 'add-utf16be' || choice === 'remove' ? choice : ('add-utf8' as const);
  const result = changeBom(bytes, action);
  const same = result.bytes.length === bytes.length && result.bytes.every((byte, i) => byte === bytes[i]);
  const outputs: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: 'First 8 bytes',
      pairs: [
        ['Before', result.before === '' ? '(no bytes)' : result.before],
        ['After', result.after === '' ? '(no bytes)' : result.after],
      ],
    },
    {
      kind: 'files',
      label: 'Download the bytes',
      files: [
        {
          name: action === 'remove' ? 'without-bom.txt' : 'with-bom.txt',
          mime: 'application/octet-stream',
          content: result.bytes,
        },
      ],
    },
  ];
  if (same) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value:
        action === 'remove'
          ? 'The bytes have no byte order mark, so nothing was removed.'
          : 'The bytes already start with that mark, so nothing was added.',
    });
  } else {
    outputs.push({
      kind: 'note',
      tone: 'success',
      value: action === 'remove' ? 'Removed the byte order mark.' : 'Wrote the byte order mark at the start.',
    });
  }
  if (precedence) outputs.push(precedence);
  if (action === 'add-utf16le' || action === 'add-utf16be') {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value:
        'A UTF-16 mark only fits bytes that are UTF-16. This adds the two bytes and does not convert the rest of the bytes.',
    });
  }
  return {
    outputs,
    stats: [
      ['Bytes before', count(bytes.length)],
      ['Bytes after', count(result.bytes.length)],
    ],
  };
}

export default defineTool({
  id: 'text-encoding-fixer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'repair',
      options: [
        { value: 'decode', label: 'Decode bytes' },
        { value: 'repair', label: 'Repair garbled text' },
        { value: 'eol', label: 'Line endings' },
        { value: 'bom', label: 'Byte order mark' },
      ],
    },
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The text to work on, up to 20 MiB. A text box keeps every line break as LF; open a file to work with CRLF or CR.',
      visible: (v) => modeOf(v) !== 'decode',
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      help: 'Any file, up to 20 MiB, read in your browser. It is used instead of anything typed or pasted below.',
      visible: (v) => modeOf(v) !== 'repair',
    },
    {
      name: 'hex',
      label: 'Bytes as hex',
      type: 'textarea',
      rows: 4,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Used only when no file is attached above. Pairs of hex digits; spaces and line breaks are allowed. In Byte order mark mode, when this box and the Text box both hold something, this one is used.',
      visible: (v) => modeOf(v) === 'decode' || modeOf(v) === 'bom',
    },
    {
      name: 'encoding',
      label: 'Encoding label',
      type: 'text',
      default: 'windows-1252',
      placeholder: 'windows-1252',
      help: 'A WHATWG label such as windows-1252, windows-1251, koi8-r, iso-8859-2, shift_jis, gbk or utf-16le.',
      visible: (v) => modeOf(v) === 'decode',
    },
    {
      name: 'strictLatin1',
      label: 'True ISO-8859-1',
      type: 'checkbox',
      default: false,
      help: 'For the labels latin1 and iso-8859-1 only: keep bytes 80 to 9F as control characters, not the Windows-1252 letters and symbols the WHATWG standard gives them.',
      visible: (v) => modeOf(v) === 'decode',
    },
    {
      name: 'repairFrom',
      label: 'Repair from',
      type: 'select',
      default: 'windows-1252',
      options: [
        { value: 'windows-1252', label: 'Windows-1252' },
        { value: 'iso-8859-1', label: 'ISO-8859-1' },
      ],
      help: 'The encoding the UTF-8 bytes were wrongly read as.',
      visible: (v) => modeOf(v) === 'repair',
    },
    {
      name: 'perLine',
      label: 'Line by line',
      type: 'checkbox',
      default: false,
      help: 'Repair each line on its own and leave lines that cannot be repaired as they are.',
      visible: (v) => modeOf(v) === 'repair',
    },
    {
      name: 'eol',
      label: 'Line ending',
      type: 'select',
      default: 'lf',
      options: [
        { value: 'lf', label: 'LF (Linux, macOS)' },
        { value: 'crlf', label: 'CRLF (Windows)' },
        { value: 'cr', label: 'CR (old Mac)' },
      ],
      visible: (v) => modeOf(v) === 'eol',
    },
    {
      name: 'bom',
      label: 'Byte order mark',
      type: 'select',
      default: 'add-utf8',
      options: [
        { value: 'add-utf8', label: 'Add UTF-8 mark (EF BB BF)' },
        { value: 'add-utf16le', label: 'Add UTF-16LE mark (FF FE)' },
        { value: 'add-utf16be', label: 'Add UTF-16BE mark (FE FF)' },
        { value: 'remove', label: 'Remove the mark' },
      ],
      visible: (v) => modeOf(v) === 'bom',
    },
  ],
  examples: [
    {
      label: 'Repair cafÃ© and quotes',
      values: {
        mode: 'repair',
        text: 'The cafÃ© said â€œhello, naÃ¯ve worldâ€\u009d and Ã¼ber â€™quotedâ€™ text',
        repairFrom: 'windows-1252',
        perLine: false,
      },
    },
    {
      label: 'Decode Windows-1252 bytes',
      values: { mode: 'decode', hex: '80 81 9f e9', encoding: 'windows-1252', strictLatin1: false },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const mode = modeOf(values);
      if (mode === 'decode') return await decode(values);
      if (mode === 'eol') return await lineEndings(values);
      if (mode === 'bom') return await byteOrderMark(values);
      return repair(values);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof TextEncodingFixerError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
