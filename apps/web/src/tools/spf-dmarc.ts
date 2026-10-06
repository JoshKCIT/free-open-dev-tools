import {
  meta,
  LOOKUP_LIMIT,
  MAX_TERMS_SHOWN,
  SpfDmarcError,
  buildSpf,
  checkSpf,
  countLookups,
  describeTerm,
  parseSpf,
  readTxtRecords,
  toTxtValue,
  visible,
  withCommas,
  type SpfEnding,
  type SpfNote,
  type SpfReport,
  type TreeCount,
} from '@fodt/spf-dmarc';
import { bool, defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: hosts are the reserved .example names and example.com (RFC 2606) and the
// records are the ones RFC 7208 prints.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_FIRST = 'This page never queries DNS: nothing is looked up or sent.';
const SHOWN_CELL = 200;

type Mode = 'check' | 'build-spf';

function readMode(values: Values): Mode {
  return str(values, 'mode', 'check') === 'build-spf' ? 'build-spf' : 'check';
}

const only =
  (mode: Mode) =>
  (values: Values): boolean =>
    readMode(values) === mode;

function readEnding(values: Values): SpfEnding {
  const chosen = str(values, 'spfEnding', '-all');
  return chosen === '~all' || chosen === '?all' || chosen === 'redirect' ? chosen : '-all';
}

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

function noteItem(note: SpfNote): string {
  return note.position === undefined ? note.message : `Position ${note.position}: ${note.message}`;
}

/** Whether a term counts toward the limit, said in the cell of the table. */
function countCell(report: SpfReport, index: number): string {
  if (report.lookups.some((lookup) => lookup.termIndex === index)) return 'Yes';
  if (report.neverTested.includes(index)) return 'No (never tested: it comes after the all)';
  const term = report.record.terms[index - 1];
  if (term !== undefined && term.kind === 'redirect' && report.redirectIgnored)
    return 'No (ignored: the record has an all)';
  return 'No';
}

/** The whole-tree count as the value of a row: exact, or a lower bound that says why. */
function treeValue(tree: TreeCount): string {
  if (tree.stopped) return `${tree.total} or more of ${LOOKUP_LIMIT} (counting stops at ${tree.total})`;
  if (tree.lowerBound) return `${tree.total} or more of ${LOOKUP_LIMIT} (a lower bound: see the list below)`;
  return `${tree.total} of ${LOOKUP_LIMIT}`;
}

function treeTable(tree: TreeCount): OutputBlock {
  return {
    kind: 'table',
    label: 'Lookup tree',
    table: {
      headers: ['Record', 'Reached from', 'Lookups', 'Note'],
      rows: tree.rows.map((row) => [
        row.label,
        row.reachedFrom === '' ? 'The first record' : row.reachedFrom,
        row.lookups,
        [row.times > 1 ? `Reached ${row.times} times, and counted each time.` : '', ...row.notes]
          .filter((n) => n !== '')
          .join(' '),
      ]),
      mono: [0, 1],
    },
  };
}

function treeNotes(tree: TreeCount): string[] {
  const items: string[] = [];
  for (const name of tree.missing) {
    items.push(
      `The name ${name} was not pasted, so what it adds is not counted and the whole-tree count is a lower bound.`,
    );
  }
  for (const name of tree.skipped) {
    items.push(`The name ${name} holds a macro, so it was not followed and the whole-tree count is a lower bound.`);
  }
  for (const loop of tree.loops) {
    items.push(
      `The record ${loop.from} leads back to ${loop.to}, which is already being followed, so that loop was cut.`,
    );
  }
  if (tree.stopped) items.push(`Counting stopped at ${tree.total}, which is over the limit of ${LOOKUP_LIMIT}.`);
  return items;
}

function checkBlocks(text: string): OutputBlock[] {
  const records = readTxtRecords(text, 'spf');
  const first = records[0];
  if (first === undefined) return [];
  const report = checkSpf(parseSpf(first.text), first.strings);
  const record = report.record;
  const tree = records.length > 1 ? countLookups(records, 0) : null;
  const blocks: OutputBlock[] = [verdict(report)];
  blocks.push({
    kind: 'keyvalue',
    label: 'The record',
    pairs: [
      ['Record', visible(record.text, SHOWN_CELL)],
      ['Length', `${withCommas(record.length)} characters, ${withCommas(report.octets)} octets`],
      ['Strings needed', `${report.stringsNeeded} (one string holds at most 255 octets)`],
      ['DNS lookups counted', `${report.lookupCount} of ${LOOKUP_LIMIT}`],
      ...(tree === null ? [] : ([['Whole tree', treeValue(tree)]] as [string, string][])),
    ],
  });
  if (record.terms.length > 0) {
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
          countCell(report, term.index),
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
  if (tree !== null) blocks.push(treeTable(tree));
  if (!record.isSpf) {
    blocks.push({
      kind: 'list',
      label: 'Problems',
      items: record.errors.map((e) => `Position ${e.position}: ${e.message}`),
    });
  }
  const worth = [...first.warnings, ...report.notes.map(noteItem), ...(tree === null ? [] : treeNotes(tree))];
  if (worth.length > 0) blocks.push({ kind: 'list', label: 'Worth a look', items: worth });
  return blocks;
}

function buildBlocks(values: Values): OutputBlock[] {
  const built = buildSpf({
    ip4: str(values, 'spfIp4'),
    ip6: str(values, 'spfIp6'),
    includes: str(values, 'spfIncludes'),
    a: bool(values, 'spfA'),
    mx: bool(values, 'spfMx'),
    ending: readEnding(values),
    redirect: str(values, 'spfRedirect'),
  });
  const blocks: OutputBlock[] = [
    {
      kind: 'note',
      tone: built.problems.length > 0 ? 'warn' : 'success',
      value:
        built.problems.length > 0
          ? `${NOTE_FIRST} ${built.problems.length === 1 ? 'One entry was' : `${built.problems.length} entries were`} left out of the record; see the list below.`
          : `${NOTE_FIRST} The record was read back by the same checker as a pasted record and has no syntax error.`,
    },
    { kind: 'code', label: 'SPF record', value: built.record },
    { kind: 'code', label: 'As the value of a TXT record', value: toTxtValue(built.record) },
    {
      kind: 'keyvalue',
      label: 'The record',
      pairs: [
        ['Length', `${withCommas(built.length)} characters, ${withCommas(built.octets)} octets`],
        ['Strings needed', `${built.report.stringsNeeded} (one string holds at most 255 octets)`],
        ['DNS lookups counted', `${built.lookups} of ${LOOKUP_LIMIT}`],
      ],
    },
  ];
  if (built.problems.length > 0) {
    blocks.push({
      kind: 'list',
      label: 'Left out',
      items: built.problems.map((problem) => `${problem.field}, line ${problem.line}: ${problem.message}`),
    });
  }
  if (built.report.notes.length > 0) {
    blocks.push({ kind: 'list', label: 'Worth a look', items: built.report.notes.map(noteItem) });
  }
  return blocks;
}

export default defineTool({
  id: 'spf-dmarc',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to do',
      type: 'radio',
      default: 'check',
      options: [
        { value: 'check', label: 'Check a record' },
        { value: 'build-spf', label: 'Build an SPF record' },
      ],
    },
    {
      name: 'spfText',
      label: 'SPF record',
      type: 'textarea',
      rows: 6,
      placeholder: PASTE_PLACEHOLDER,
      help: 'A bare record, or a zone-file line with one or more quoted strings. The first record is the one checked. Further lines are records with their names (name: v=spf1 ... or a zone-file line), used only to count lookups through include and redirect.',
      wide: true,
      visible: only('check'),
    },
    {
      name: 'spfIp4',
      label: 'IPv4 addresses or networks',
      type: 'textarea',
      rows: 3,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One per line, such as 192.0.2.10 or 198.51.100.0/24.',
      visible: only('build-spf'),
    },
    {
      name: 'spfIp6',
      label: 'IPv6 addresses or networks',
      type: 'textarea',
      rows: 3,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One per line, such as 2001:db8::/32.',
      visible: only('build-spf'),
    },
    {
      name: 'spfIncludes',
      label: 'Domains to include',
      type: 'textarea',
      rows: 3,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One per line. Each include adds a DNS lookup of its own.',
      visible: only('build-spf'),
    },
    {
      name: 'spfA',
      label: 'Allow the addresses of the domain itself (a)',
      type: 'checkbox',
      default: false,
      visible: only('build-spf'),
    },
    {
      name: 'spfMx',
      label: 'Allow the domain mail servers (mx)',
      type: 'checkbox',
      default: false,
      visible: only('build-spf'),
    },
    {
      name: 'spfEnding',
      label: 'How the record ends',
      type: 'select',
      default: '-all',
      options: [
        { value: '-all', label: '-all (fail for any other server)' },
        { value: '~all', label: '~all (softfail for any other server)' },
        { value: '?all', label: '?all (neutral for any other server)' },
        { value: 'redirect', label: 'redirect (use another domain record)' },
      ],
      visible: only('build-spf'),
    },
    {
      name: 'spfRedirect',
      label: 'Redirect to this domain',
      type: 'text',
      placeholder: '_spf.example.com',
      help: 'The domain whose SPF record takes over when no term above matched.',
      mono: true,
      visible: (values) => readMode(values) === 'build-spf' && readEnding(values) === 'redirect',
    },
  ],
  examples: [
    {
      label: 'RFC 7208 section 3: a record with mx, a and a closing -all',
      values: { mode: 'check', spfText: 'v=spf1 +mx a:colo.example.com/28 -all' },
    },
    {
      label: 'RFC 7208 section 4.6.4: a, mx and two includes are four terms that cause lookups',
      values: { mode: 'check', spfText: 'v=spf1 a mx include:example.com include:example.org -all' },
    },
    {
      label: 'RFC 7208 section 10.1.1: a zone-file line with one network and the mail servers',
      values: { mode: 'check', spfText: 'example.com. IN TXT "v=spf1 ip4:192.0.2.0/24 mx -all"' },
    },
    {
      label: 'Count the whole tree: a record and the record its include points to, pasted with its name',
      values: {
        mode: 'check',
        spfText: 'v=spf1 include:_spf.example.net -all\n_spf.example.net: v=spf1 a mx ip4:192.0.2.0/24 -all',
      },
    },
    {
      label: 'Build a record for two networks and one include',
      values: {
        mode: 'build-spf',
        spfIp4: '192.0.2.10\n198.51.100.0/24',
        spfIp6: '2001:db8::/32',
        spfIncludes: 'spf.protection.example',
        spfA: false,
        spfMx: true,
        spfEnding: '-all',
      },
    },
  ],
  run(values: Values): ToolResult {
    try {
      const blocks = readMode(values) === 'build-spf' ? buildBlocks(values) : checkBlocks(str(values, 'spfText'));
      return { outputs: blocks };
    } catch (err) {
      if (err instanceof SpfDmarcError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not read or build this record here.' }] };
    }
  },
});
