import {
  MAX_SEGMENT_ROWS,
  SmsSegmentsError,
  analyseMessage,
  meta,
  visible,
  withCommas,
  type Analysis,
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
    },
  ],
  run(values): ToolResult {
    const message = str(values, 'message');
    if (message === '') return { outputs: [] };
    try {
      const analysis = analyseMessage(message);
      const outputs: OutputBlock[] = [summaryBlock(analysis), ...segmentsBlocks(analysis)];
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
