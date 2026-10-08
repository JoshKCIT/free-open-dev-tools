import {
  MAX_COPY_CHARACTERS,
  MAX_FORCED_ROWS,
  MAX_SEGMENT_ROWS,
  MAX_SHOWN_CHARACTERS,
  SmsSegmentsError,
  analyseMessage,
  codePointLabel,
  describeForced,
  gsmSafeCopy,
  meta,
  visible,
  withCommas,
  type Analysis,
  type SafeCopy,
} from '@fodt/sms-segments';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** How many characters of a part's text a table cell shows. */
const MAX_SHOWN_PART = 200;

function unitsLabel(analysis: Analysis): string {
  return analysis.encoding === 'gsm7' ? 'septets' : 'UTF-16 units';
}

function summaryBlock(analysis: Analysis): OutputBlock {
  const unit = unitsLabel(analysis);
  const last = analysis.segments[analysis.segments.length - 1];
  return {
    kind: 'keyvalue',
    label: 'Summary',
    pairs: [
      ['Encoding', analysis.encoding === 'gsm7' ? 'GSM 7-bit default alphabet' : 'UCS-2 (16-bit)'],
      ['Characters', withCommas(analysis.characters)],
      [analysis.encoding === 'gsm7' ? 'Septets' : 'UTF-16 units', withCommas(analysis.units)],
      ['Segments', withCommas(analysis.segments.length)],
      ['One message holds', `${analysis.single} ${unit}`],
      ['Each part of a long message holds', `${analysis.part} ${unit}`],
      ['Left in the last segment', `${last ? last.capacity - last.used : 0} ${unit}`],
    ],
  };
}

/** What to write in the "Try instead" column, said in words where the replacement itself would be invisible. */
function replacementLabel(suggestion: string | undefined): string {
  if (suggestion === undefined) return 'No replacement is listed';
  if (suggestion === '') return 'Leave it out';
  if (suggestion === ' ') return 'A plain space';
  if (suggestion === '\n') return 'A line break';
  return suggestion;
}

function forcedBlocks(analysis: Analysis): OutputBlock[] {
  if (analysis.forced.length === 0) return [];
  const shown = analysis.forced.slice(0, MAX_FORCED_ROWS);
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Characters that forced Unicode',
      table: {
        headers: ['Character', 'Code point', 'What it is', 'Try instead', 'Count'],
        rows: shown.map((f) => {
          const known = describeForced(f.codePoint);
          return [
            visible(f.character, MAX_SHOWN_CHARACTERS),
            codePointLabel(f.codePoint),
            known.name,
            replacementLabel(known.suggestion),
            f.count,
          ];
        }),
        mono: [0, 1, 3],
      },
    },
  ];
  const rest = analysis.forced.length - shown.length;
  if (rest > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(rest)} more ${rest === 1 ? 'character is' : 'characters are'} not listed: the table stops at ${MAX_FORCED_ROWS} rows.`,
    });
  }
  return blocks;
}

function segmentsBlocks(analysis: Analysis): OutputBlock[] {
  const shown = analysis.segments.slice(0, MAX_SEGMENT_ROWS);
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Segments',
      table: {
        headers: ['Part', 'Used of capacity', 'Text'],
        rows: shown.map((s) => [s.index, `${s.used} of ${s.capacity}`, visible(s.text, MAX_SHOWN_PART)]),
        mono: [1, 2],
      },
    },
  ];
  const rest = analysis.segments.length - shown.length;
  if (rest > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(rest)} more ${rest === 1 ? 'part is' : 'parts are'} not listed: the table stops at ${MAX_SEGMENT_ROWS} rows.`,
    });
  }
  return blocks;
}

/** The copy with replacements, shown only when it differs from the message and only for a message that needs UCS-2. */
function copyBlocks(analysis: Analysis, message: string): OutputBlock[] {
  if (analysis.encoding !== 'ucs2') return [];
  const copy: SafeCopy = gsmSafeCopy(message);
  if (copy.text === message) return [];
  // Characters that are not on the list stay in the copy; when there are any, hidden ones are shown as escapes.
  const characters = [...copy.text];
  const cut = characters.length > MAX_COPY_CHARACTERS;
  const value =
    copy.remaining === 0 ? characters.slice(0, MAX_COPY_CHARACTERS).join('') : visible(copy.text, MAX_COPY_CHARACTERS);
  const blocks: OutputBlock[] = [{ kind: 'code', label: 'A copy with GSM-safe replacements', value }];
  const sentences: string[] = [];
  if (cut) {
    sentences.push(`The copy is shown up to ${withCommas(MAX_COPY_CHARACTERS)} characters; the rest is left out.`);
  }
  if (copy.remaining > 0) {
    sentences.push(
      `${withCommas(copy.remaining)} ${copy.remaining === 1 ? 'character is' : 'characters are'} not on the list of replacements and stay${copy.remaining === 1 ? 's' : ''} in this copy, so it may still need UCS-2. Hidden characters in it are shown as escapes.`,
    );
  }
  if (sentences.length > 0) blocks.push({ kind: 'note', tone: 'info', value: sentences.join(' ') });
  return blocks;
}

export default defineTool({
  id: 'sms-segments',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'message',
      label: 'Message',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste the message. Nothing leaves your browser.',
      help: 'Counted exactly as typed. A line break counts as one character here.',
    },
  ],
  examples: [
    {
      label: 'Plain text',
      values: { message: 'Your table is booked for Friday at 7:30. Reply YES to confirm or NO to cancel.' },
    },
    {
      label: 'A curly apostrophe and an emoji',
      values: { message: 'We’ll see you at the café 😀' },
    },
    {
      label: 'Characters that count twice',
      values: { message: 'Price: €5 {limited offer} [today] ~ 50% | save ^ more' },
    },
  ],
  run(values): ToolResult {
    const message = str(values, 'message');
    if (message === '') return { outputs: [] };
    try {
      const analysis = analyseMessage(message);
      const outputs: OutputBlock[] = [summaryBlock(analysis)];
      if (analysis.warnings.length > 0) outputs.push({ kind: 'list', label: 'Warnings', items: analysis.warnings });
      outputs.push(...forcedBlocks(analysis), ...segmentsBlocks(analysis), ...copyBlocks(analysis, message));
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'Counts follow 3GPP TS 23.038 and TS 23.040 for one text message with a standard concatenation header. A sending service can change the text, choose another encoding or bill differently, and this page sends nothing.',
      });
      return { outputs };
    } catch (err) {
      if (err instanceof SmsSegmentsError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not count this message.' }] };
    }
  },
});
