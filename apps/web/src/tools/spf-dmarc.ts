import {
  meta,
  LOOKUP_LIMIT,
  MAX_TERMS_SHOWN,
  SpfDmarcError,
  checkSpf,
  describeTerm,
  parseSpf,
  readTxtRecords,
  visible,
  withCommas,
  type SpfReport,
} from '@fodt/spf-dmarc';
import { defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: hosts are the reserved .example names and example.com (RFC 2606) and the
// records are the ones RFC 7208 prints.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_FIRST = 'This page never queries DNS: nothing is looked up or sent.';
const SHOWN_CELL = 200;

function verdict(report: SpfReport): OutputBlock {
  if (!report.record.isSpf) {
    return {
      kind: 'note',
      tone: 'warn',
      value: `${NOTE_FIRST} This text does not start with v=spf1 followed by a space or the end, so it is not read as an SPF record.`,
    };
  }
  if (report.record.errors.length > 0) {
    const n = report.record.errors.length;
    return {
      kind: 'note',
      tone: 'warn',
      value: `${NOTE_FIRST} The record has ${n} syntax ${n === 1 ? 'error' : 'errors'}, and a receiver that finds one gives the result permerror (RFC 7208 section 4.6).`,
    };
  }
  if (!report.withinLimit) {
    return {
      kind: 'note',
      tone: 'warn',
      value: `${NOTE_FIRST} The record reads without a syntax error, but ${report.lookupCount} terms cause lookups and the limit is ${LOOKUP_LIMIT}.`,
    };
  }
  return {
    kind: 'note',
    tone: 'success',
    value: `${NOTE_FIRST} The record reads without a syntax error and has ${report.lookupCount} of ${LOOKUP_LIMIT} terms that cause DNS lookups. What a receiver decides for a message is not checked here.`,
  };
}

function checkBlocks(text: string): OutputBlock[] {
  const records = readTxtRecords(text, 'spf');
  const first = records[0];
  if (first === undefined) return [];
  const report = checkSpf(parseSpf(first.text));
  const record = report.record;
  const blocks: OutputBlock[] = [verdict(report)];
  blocks.push({
    kind: 'keyvalue',
    label: 'The record',
    pairs: [
      ['Record', visible(record.text, SHOWN_CELL)],
      ['Length', `${withCommas(record.length)} characters, ${withCommas(record.octets)} octets`],
      ['DNS lookups counted', `${report.lookupCount} of ${LOOKUP_LIMIT}`],
    ],
  });
  if (record.terms.length > 0) {
    const counted = new Set(report.lookups.map((lookup) => lookup.termIndex));
    const shown = record.terms.slice(0, MAX_TERMS_SHOWN);
    blocks.push({
      kind: 'table',
      label: 'Terms',
      table: {
        headers: ['#', 'Term', 'Meaning', `Counts toward ${LOOKUP_LIMIT}`, 'Problem'],
        rows: shown.map((term) => [
          `${term.index} (position ${term.start})`,
          visible(term.text, SHOWN_CELL),
          describeTerm(term),
          counted.has(term.index) ? 'Yes' : 'No',
          term.problems.map((problem) => `Position ${problem.position}: ${problem.message}`).join(' '),
        ]),
        mono: [1],
      },
    });
    if (record.terms.length > shown.length) {
      blocks.push({
        kind: 'note',
        tone: 'info',
        value: `The table shows the first ${withCommas(shown.length)} of ${withCommas(record.terms.length)} terms.`,
      });
    }
  }
  if (!record.isSpf) {
    blocks.push({
      kind: 'list',
      label: 'Problems',
      items: record.errors.map((e) => `Position ${e.position}: ${e.message}`),
    });
  }
  return blocks;
}

export default defineTool({
  id: 'spf-dmarc',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'spfText',
      label: 'SPF record',
      type: 'textarea',
      rows: 6,
      placeholder: PASTE_PLACEHOLDER,
      help: 'A bare record, or a zone-file line with one or more quoted strings. The first record is the one checked.',
      wide: true,
    },
  ],
  examples: [
    {
      label: 'RFC 7208 section 3: a record with mx, a and a closing -all',
      values: { spfText: 'v=spf1 +mx a:colo.example.com/28 -all' },
    },
    {
      label: 'RFC 7208 section 4.6.4: a, mx and two includes are four terms that cause lookups',
      values: { spfText: 'v=spf1 a mx include:example.com include:example.org -all' },
    },
  ],
  run(values: Values): ToolResult {
    try {
      const blocks = checkBlocks(str(values, 'spfText'));
      return { outputs: blocks };
    } catch (err) {
      if (err instanceof SpfDmarcError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not read this record here.' }] };
    }
  },
});
