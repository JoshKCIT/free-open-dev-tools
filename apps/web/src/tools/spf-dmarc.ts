import {
  meta,
  LOOKUP_LIMIT,
  MAX_TERMS_SHOWN,
  SpfDmarcError,
  buildDmarc,
  buildSpf,
  checkDmarc,
  checkSpf,
  countLookups,
  describeTerm,
  parseSpf,
  pickDmarcRecord,
  readTxtRecords,
  toTxtValue,
  toZoneForm,
  visible,
  withCommas,
  type DmarcPolicyChoice,
  type DmarcReport,
  type DmarcStatus,
  type DmarcTag,
  type SpfEnding,
  type SpfNote,
  type SpfReport,
  type TreeCount,
} from '@fodt/spf-dmarc';
import { bool, defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: hosts are the reserved .example names and example.com (RFC 2606) and the
// records are the ones RFC 7208 and RFC 9989 print.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_FIRST = 'This page never queries DNS: nothing is looked up or sent.';
const SHOWN_CELL = 200;

type Mode = 'check' | 'build-spf' | 'build-dmarc';

function readMode(values: Values): Mode {
  const chosen = str(values, 'mode', 'check');
  return chosen === 'build-spf' || chosen === 'build-dmarc' ? chosen : 'check';
}

function readPolicy(values: Values, name: string): DmarcPolicyChoice {
  const chosen = str(values, name, 'none');
  return chosen === 'quarantine' || chosen === 'reject' ? chosen : 'none';
}

/** The policy of a select that also offers inherit. */
function readInherit(values: Values, name: string): 'inherit' | DmarcPolicyChoice {
  const chosen = str(values, name, 'inherit');
  return chosen === 'none' || chosen === 'quarantine' || chosen === 'reject' ? chosen : 'inherit';
}

function readStrictness(values: Values, name: string): 'r' | 's' {
  return str(values, name, 'r') === 's' ? 's' : 'r';
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

function spfBlocks(text: string): OutputBlock[] {
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

/** What the Status cell of the tags table says. */
const STATUS_TEXT: Record<DmarcStatus, string> = {
  ok: 'Read',
  'default-used': 'Not in the record, default used',
  retired: 'retired in RFC 9989',
  unknown: 'Unknown tag, ignored',
  invalid: 'Not valid, default used',
  repeated: 'Repeated, first value used',
};

function statusCell(tag: DmarcTag): string {
  return STATUS_TEXT[tag.status];
}

/** How many tags and addresses of the record are not valid and are ignored. */
function problemCount(report: DmarcReport): number {
  let n = 0;
  for (const tag of report.record.tags) {
    if (tag.status === 'invalid') n++;
    else if (tag.status === 'ok') n += tag.uris.filter((uri) => uri.kind === 'invalid').length;
  }
  return n;
}

function dmarcVerdict(report: DmarcReport, first: boolean): OutputBlock {
  const lead = first ? `${NOTE_FIRST} ` : '';
  if (!report.record.isDmarc) {
    return {
      kind: 'note',
      tone: 'warn',
      value: `${lead}This text does not start with v=DMARC1, so a receiver ignores the whole record (RFC 9989 section 4.7).`,
    };
  }
  if (!report.valid) {
    const n = problemCount(report);
    return {
      kind: 'note',
      tone: 'warn',
      value: `${lead}The DMARC record has ${n} ${n === 1 ? 'tag or address' : 'tags or addresses'} that ${n === 1 ? 'is' : 'are'} not valid and ignored under RFC 9989 section 4.8; see the Tags table and the list below.`,
    };
  }
  return {
    kind: 'note',
    tone: 'success',
    value: `${lead}The DMARC record reads without a syntax error under RFC 9989. What a receiver decides for a message is not checked here.`,
  };
}

/** The lines of the "Reports and authorisation" list: every address as written, and the name another domain must publish. */
function reportItems(report: DmarcReport): string[] {
  const items: string[] = [];
  let next = 0;
  for (const address of report.addresses) {
    const written = `${address.tag}: ${visible(address.text, SHOWN_CELL)}`;
    if (address.uri.kind !== 'mailto') {
      items.push(`${written} (a scheme other than mailto:, kept as written)`);
      continue;
    }
    const authorisation = report.authorisations[next];
    next++;
    if (authorisation === undefined) {
      items.push(written);
      continue;
    }
    const name =
      authorisation.name === null || authorisation.value === null
        ? ''
        : ` The name to look for is ${authorisation.name} and its value is ${authorisation.value}`;
    items.push(`${written}. ${authorisation.message}${name}`);
  }
  if (report.needsDomain) {
    items.push(
      'Type the domain this record is published for, above, to see the exact name another domain must publish for an address outside it. Nothing is looked up.',
    );
  }
  return items;
}

function dmarcBlocks(text: string, domain: string, first: boolean): OutputBlock[] {
  const pick = pickDmarcRecord(readTxtRecords(text, 'dmarc'));
  if (pick === null) return [];
  const lead = first ? `${NOTE_FIRST} ` : '';
  if (pick.record === null) {
    return [
      { kind: 'note', tone: 'warn', value: `${lead}${pick.discarded ?? 'No DMARC record was chosen.'}` },
      {
        kind: 'list',
        label: 'Problems',
        items: [
          `The records that start on line ${pick.discardedLines.map(String).join(', ')} of the box were all discarded.`,
        ],
      },
    ];
  }
  const report = checkDmarc(pick.record, domain);
  const record = report.record;
  const blocks: OutputBlock[] = [dmarcVerdict(report, first)];
  if (!record.isDmarc) {
    blocks.push({ kind: 'list', label: 'Problems', items: [record.ignored ?? 'This text is not a DMARC record.'] });
    return blocks;
  }
  blocks.push({
    kind: 'keyvalue',
    label: 'The DMARC record',
    pairs: [
      ['Record', visible(record.text, SHOWN_CELL)],
      ['Effective policy for the domain', report.policy.domain],
      ['Effective policy for subdomains', report.policy.subdomains],
      ['Effective policy for non-existent subdomains', report.policy.nonExistent],
    ],
  });
  const shown = record.tags.slice(0, MAX_TERMS_SHOWN);
  blocks.push({
    kind: 'table',
    label: 'Tags',
    table: {
      headers: ['Tag', 'Value', 'Meaning', 'Default', 'Status'],
      rows: shown.map((tag) => [
        visible(tag.name, SHOWN_CELL),
        tag.value === null ? '(not in the record)' : visible(tag.value, SHOWN_CELL),
        tag.meaning,
        tag.default,
        statusCell(tag),
      ]),
      mono: [0, 1],
    },
  });
  if (record.tags.length > shown.length) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `The table shows the first ${withCommas(shown.length)} of ${withCommas(record.tags.length)} tags.`,
    });
  }
  const reports = reportItems(report);
  if (reports.length > 0) blocks.push({ kind: 'list', label: 'Reports and authorisation', items: reports });
  const worth = [
    ...(pick.source?.warnings ?? []),
    ...(pick.setAside > 0
      ? [
          `${pick.setAside} other ${pick.setAside === 1 ? 'record' : 'records'} in the box did not start with v=DMARC1 and ${pick.setAside === 1 ? 'was' : 'were'} set aside (RFC 9989 section 4.10).`,
        ]
      : []),
    ...report.notes.map((note) => note.message),
  ];
  if (worth.length > 0) blocks.push({ kind: 'list', label: 'Worth a look', items: worth });
  return blocks;
}

function checkBlocks(values: Values): OutputBlock[] {
  const spf = spfBlocks(str(values, 'spfText'));
  return [...spf, ...dmarcBlocks(str(values, 'dmarcText'), str(values, 'domain').trim(), spf.length === 0)];
}

function buildDmarcBlocks(values: Values): OutputBlock[] {
  const built = buildDmarc({
    policy: readPolicy(values, 'dmarcPolicy'),
    subPolicy: readInherit(values, 'dmarcSubPolicy'),
    nonExistent: readInherit(values, 'dmarcNonexistent'),
    adkim: readStrictness(values, 'dmarcAdkim'),
    aspf: readStrictness(values, 'dmarcAspf'),
    rua: str(values, 'dmarcRua'),
    ruf: str(values, 'dmarcRuf'),
    fo: str(values, 'dmarcFo', '0'),
    test: bool(values, 'dmarcTest'),
  });
  const problems = built.problems.length;
  const blocks: OutputBlock[] = [
    {
      kind: 'note',
      tone: problems > 0 ? 'warn' : 'success',
      value:
        problems > 0
          ? `${NOTE_FIRST} ${problems === 1 ? 'One entry was' : `${problems} entries were`} left out of the record; see the list below.`
          : `${NOTE_FIRST} The record was read back by the same checker as a pasted record and has no syntax error under RFC 9989.`,
    },
    { kind: 'code', label: 'DMARC record', value: built.record },
    { kind: 'code', label: 'In zone file form', value: toZoneForm('_dmarc', built.record) },
    {
      kind: 'keyvalue',
      label: 'The DMARC record',
      pairs: [
        ['Length', `${withCommas(built.length)} characters, ${withCommas(built.octets)} octets`],
        ['Strings needed', `${Math.max(1, Math.ceil(built.octets / 255))} (one string holds at most 255 octets)`],
        ['Effective policy for the domain', built.report.policy.domain],
        ['Effective policy for subdomains', built.report.policy.subdomains],
        ['Effective policy for non-existent subdomains', built.report.policy.nonExistent],
      ],
    },
  ];
  if (problems > 0) {
    blocks.push({
      kind: 'list',
      label: 'Left out',
      items: built.problems.map((problem) => `${problem.field}, line ${problem.line}: ${problem.message}`),
    });
  }
  if (built.advice.length > 0) blocks.push({ kind: 'list', label: 'Worth a look', items: built.advice });
  return blocks;
}

function buildSpfBlocks(values: Values): OutputBlock[] {
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
    { kind: 'code', label: 'In zone file form', value: toZoneForm('@', built.record) },
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
  const worth = [
    ...built.adjusted.map((entry) => `${entry.field}, line ${entry.line}: ${entry.message}`),
    ...built.report.notes.map(noteItem),
  ];
  if (worth.length > 0) blocks.push({ kind: 'list', label: 'Worth a look', items: worth });
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
        { value: 'build-dmarc', label: 'Build a DMARC record' },
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
      name: 'dmarcText',
      label: 'DMARC record',
      type: 'textarea',
      rows: 5,
      placeholder: PASTE_PLACEHOLDER,
      help: 'A bare record, or a zone-file line with one or more quoted strings, the parenthesis form and comment lines included.',
      wide: true,
      visible: only('check'),
    },
    {
      name: 'domain',
      label: 'Domain the DMARC record is published for (optional)',
      type: 'text',
      placeholder: 'example.com',
      help: 'Used to write the name a report address in another domain needs. Nothing is looked up.',
      mono: true,
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
      help: 'One domain per line, such as _spf.example.com: the builder writes include: itself. Each include adds a DNS lookup of its own.',
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
      help: 'The domain whose SPF record takes over when no term above matched. The builder writes redirect= itself.',
      mono: true,
      visible: (values) => readMode(values) === 'build-spf' && readEnding(values) === 'redirect',
    },
    {
      name: 'dmarcPolicy',
      label: 'Policy for the domain (p)',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'none (monitor only, no action requested)' },
        { value: 'quarantine', label: 'quarantine (treat failing mail as suspicious)' },
        { value: 'reject', label: 'reject (treat failing mail as not valid)' },
      ],
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcSubPolicy',
      label: 'Policy for existing subdomains (sp)',
      type: 'select',
      default: 'inherit',
      options: [
        { value: 'inherit', label: 'same as the domain (leave sp out)' },
        { value: 'none', label: 'none' },
        { value: 'quarantine', label: 'quarantine' },
        { value: 'reject', label: 'reject' },
      ],
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcNonexistent',
      label: 'Policy for non-existent subdomains (np)',
      type: 'select',
      default: 'inherit',
      options: [
        { value: 'inherit', label: 'same as sp, or else the domain (leave np out)' },
        { value: 'none', label: 'none' },
        { value: 'quarantine', label: 'quarantine' },
        { value: 'reject', label: 'reject' },
      ],
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcAdkim',
      label: 'DKIM alignment (adkim)',
      type: 'select',
      default: 'r',
      options: [
        { value: 'r', label: 'relaxed (the default, not written)' },
        { value: 's', label: 'strict' },
      ],
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcAspf',
      label: 'SPF alignment (aspf)',
      type: 'select',
      default: 'r',
      options: [
        { value: 'r', label: 'relaxed (the default, not written)' },
        { value: 's', label: 'strict' },
      ],
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcRua',
      label: 'Aggregate report addresses (rua)',
      type: 'textarea',
      rows: 3,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One per line. A bare address such as dmarc-feedback@example.com is written as mailto:dmarc-feedback@example.com.',
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcRuf',
      label: 'Failure report addresses (ruf)',
      type: 'textarea',
      rows: 3,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One per line. Receivers are free not to send failure reports.',
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcFo',
      label: 'Failure reporting options (fo)',
      type: 'text',
      default: '0',
      placeholder: '0',
      help: 'Values 0, 1, d and s separated by colons, such as 1:d. It is written only with a ruf address.',
      mono: true,
      visible: only('build-dmarc'),
    },
    {
      name: 'dmarcTest',
      label: 'Testing: ask receivers to apply the policy one level below (t=y)',
      type: 'checkbox',
      default: false,
      visible: only('build-dmarc'),
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
      label: 'RFC 9989 Appendix B.2.2: monitoring mode with an aggregate and a failure report address',
      values: {
        mode: 'check',
        spfText: 'v=spf1 a mx include:example.com include:example.org -all',
        dmarcText:
          '_dmarc  IN TXT ( "v=DMARC1; p=none; "\n "rua=mailto:dmarc-feedback@example.com; "\n "ruf=mailto:auth-reports@example.com" )',
        domain: 'example.com',
      },
    },
    {
      label:
        'RFC 9989 Appendix B.2.3: failure reports sent to a third party, with the domain to name the record it must publish',
      values: {
        mode: 'check',
        dmarcText:
          '_dmarc IN TXT ( "v=DMARC1; p=none; "\n "rua=mailto:dmarc-feedback@example.com; "\n "ruf=mailto:auth-reports@thirdparty.example.net" )',
        domain: 'example.com',
      },
    },
    {
      label: 'RFC 9989 Appendix C.5.2: a record from the RFC 7489 days, with the tags RFC 9989 retired',
      values: {
        mode: 'check',
        dmarcText: 'v=DMARC1; p=quarantine; pct=50; rf=afrf; ri=86400; rua=mailto:reports@example.net',
      },
    },
    {
      label: 'Build a DMARC record like RFC 9989 Appendix B.2.5: quarantine, two aggregate addresses and testing',
      values: {
        mode: 'build-dmarc',
        dmarcPolicy: 'quarantine',
        dmarcRua: 'dmarc-feedback@example.com\nmailto:tld-test@thirdparty.example.net',
        dmarcTest: true,
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
      const mode = readMode(values);
      const blocks =
        mode === 'build-spf'
          ? buildSpfBlocks(values)
          : mode === 'build-dmarc'
            ? buildDmarcBlocks(values)
            : checkBlocks(values);
      return { outputs: blocks };
    } catch (err) {
      if (err instanceof SpfDmarcError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not read or build this record here.' }] };
    }
  },
});
