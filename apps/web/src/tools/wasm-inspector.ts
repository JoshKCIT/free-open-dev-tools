import {
  MAX_LARGEST_FUNCTIONS,
  MAX_MODULE_BYTES,
  MAX_ROWS,
  MAX_SHOWN_NAME,
  MAX_STRINGS,
  MAX_TREE_ITEMS,
  WasmInspectorError,
  checkModuleSize,
  inspect,
  meta,
  visible,
  withCommas,
  type Capped,
  type Report,
} from '@fodt/wasm-inspector';
import { bool, defineTool, files, type OutputBlock, type ToolResult, type TreeNode } from '../lib/tool-ui';

/** What the page says first: what it reads and what it never does. */
const FIRST_NOTE =
  "This page reads the bytes of the module. It never compiles, validates or runs it, and this page's policy does not let the browser compile one. Nothing is uploaded.";

/** What the page says last: the reading is of structure only. */
const LAST_NOTE =
  'The module is not validated: this page cannot tell you that it is valid or that a browser will accept it. Function bodies are measured, not decoded, so a fault inside a body is not reported. Names and addresses in the file come from the tools that wrote it; addresses are shown as text and never requested.';

/** A name or address from the file, safe to show: hidden and direction-changing characters are written out. */
const shown = (text: string): string => visible(text, MAX_SHOWN_NAME);

const count = (value: number): string => withCommas(value);

/** An info note when a list kept fewer rows than there were. */
function leftOutNote(label: string, list: Capped<unknown>): OutputBlock[] {
  if (list.leftOut <= 0) return [];
  return [
    {
      kind: 'note',
      tone: 'info',
      value: `${count(list.leftOut)} more ${label} are not listed; the table shows the first ${count(MAX_ROWS)}.`,
    },
  ];
}

function share(size: number, total: number): string {
  return total === 0 ? '0%' : `${((size / total) * 100).toFixed(1)}%`;
}

function moduleBlock(report: Report): OutputBlock {
  const pairs: [string, string][] = [
    ['Size', `${count(report.size)} bytes`],
    ['Binary version', '1'],
  ];
  if (report.names.moduleName !== null) pairs.push(['Module name', shown(report.names.moduleName)]);
  pairs.push(
    ['Sections', count(report.sectionCount)],
    ['Types', count(report.types.count)],
    ['Imported functions', count(report.functions.imported)],
    ['Defined functions', count(report.functions.defined)],
    ['Tables', count(report.tables.count)],
    ['Memories', count(report.memories.count)],
    ['Globals', count(report.globals.count)],
    ['Tags', count(report.tags.count)],
    ['Imports', count(report.imports.count)],
    ['Exports', count(report.exports.count)],
  );
  if (report.start !== null) pairs.push(['Start function', String(report.start)]);
  pairs.push(
    ['Element segments', count(report.elements.count)],
    ['Data segments', count(report.data.count)],
    ['Custom sections', count(report.customs.count)],
    ['Features used', report.features.length > 0 ? report.features.join(', ') : 'none that the sections show'],
  );
  if (report.producers.length > 0) {
    pairs.push([
      'Producers',
      report.producers
        .slice(0, 6)
        .map((p) => `${shown(p.field)}: ${p.values.slice(0, 4).map(shown).join(', ')}`)
        .join('; '),
    ]);
  }
  return { kind: 'keyvalue', label: 'Module', pairs };
}

function sectionsBlock(report: Report): OutputBlock[] {
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Sections',
      table: {
        headers: ['Id', 'Section', 'Offset', 'Size', 'Share of file'],
        rows: report.sections.map((s) => [
          s.id,
          s.id === 0 ? `custom: ${shown(s.customName)}` : s.name,
          s.offset,
          s.size,
          share(s.size + (s.bodyOffset - s.offset), report.size),
        ]),
        mono: [0, 2, 3],
      },
    },
  ];
  if (report.sectionCount > report.sections.length) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${count(report.sectionCount - report.sections.length)} more sections are not listed; the table shows the first ${count(MAX_ROWS)} and the first of each kind.`,
    });
  }
  return blocks;
}

function typesBlock(report: Report): OutputBlock[] {
  if (report.types.rows.length === 0) return [];
  return [
    {
      kind: 'table',
      label: 'Types',
      table: {
        headers: ['Index', 'Kind', 'Definition', 'Super types', 'Final', 'Group'],
        rows: report.types.rows.map((t) => [
          t.index,
          t.kind,
          t.text,
          t.supers.length > 0 ? t.supers.join(', ') : '',
          t.final ? 'yes' : 'no',
          t.group,
        ]),
        mono: [0, 2],
      },
    },
    ...leftOutNote('types', report.types),
  ];
}

function importsBlock(report: Report): OutputBlock[] {
  if (report.imports.rows.length === 0) return [];
  return [
    {
      kind: 'table',
      label: 'Imports',
      table: {
        headers: ['Module', 'Name', 'Kind', 'Index', 'Type'],
        rows: report.imports.rows.map((row) => [shown(row.module), shown(row.field), row.kind, row.index, row.detail]),
        mono: [0, 1, 3],
      },
    },
    ...leftOutNote('imports', report.imports),
  ];
}

function exportsBlock(report: Report): OutputBlock[] {
  if (report.exports.rows.length === 0) return [];
  return [
    {
      kind: 'table',
      label: 'Exports',
      table: {
        headers: ['Name', 'Kind', 'Index'],
        rows: report.exports.rows.map((row) => [shown(row.name), row.kind, row.index]),
        mono: [0, 2],
      },
    },
    ...leftOutNote('exports', report.exports),
  ];
}

function functionsBlock(report: Report): OutputBlock[] {
  const { largest, largestLeftOut, defined, bodyBytes } = report.functions;
  if (largest.length === 0) return [];
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Largest functions',
      table: {
        headers: ['Index', 'Name', 'Size (bytes)', 'Offset'],
        rows: largest.map((f) => [f.index, f.name === '' ? '' : shown(f.name), f.size, f.offset]),
        mono: [0, 1, 2, 3],
      },
    },
  ];
  blocks.push({
    kind: 'note',
    tone: 'info',
    value:
      largestLeftOut > 0
        ? `The ${count(MAX_LARGEST_FUNCTIONS)} largest of ${count(report.functions.imported + defined)} functions (${count(defined)} defined, ${count(bodyBytes)} bytes of bodies) are listed; ${count(largestLeftOut)} smaller bodies are not.`
        : `All ${count(defined)} defined functions are listed (${count(bodyBytes)} bytes of bodies).`,
  });
  return blocks;
}

function tablesBlocks(report: Report): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  if (report.tables.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Tables',
        table: {
          headers: ['Index', 'From', 'Type and limits', 'Initialiser'],
          rows: report.tables.rows.map((t) => [t.index, shown(t.source), t.text, t.init]),
          mono: [0, 3],
        },
      },
      ...leftOutNote('tables', report.tables),
    );
  }
  if (report.memories.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Memories',
        table: {
          headers: ['Index', 'From', 'Limits'],
          rows: report.memories.rows.map((m) => [m.index, shown(m.source), m.text]),
          mono: [0],
        },
      },
      ...leftOutNote('memories', report.memories),
    );
  }
  if (report.globals.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Globals',
        table: {
          headers: ['Index', 'From', 'Type', 'Mutable', 'Initial value'],
          rows: report.globals.rows.map((g) => [g.index, shown(g.source), g.type, g.mutable ? 'yes' : 'no', g.init]),
          mono: [0, 4],
        },
      },
      ...leftOutNote('globals', report.globals),
    );
  }
  if (report.tags.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Tags',
        table: {
          headers: ['Index', 'From', 'Type'],
          rows: report.tags.rows.map((t) => [t.index, shown(t.source), t.text]),
          mono: [0],
        },
      },
      ...leftOutNote('tags', report.tags),
    );
  }
  return blocks;
}

function segmentsBlocks(report: Report): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  if (report.elements.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Element segments',
        table: {
          headers: ['Index', 'Flag', 'Mode', 'Table', 'Offset', 'Type', 'Items'],
          rows: report.elements.rows.map((e) => [
            e.index,
            e.flag,
            e.mode,
            e.table === null ? '' : e.table,
            e.offset,
            e.type,
            e.count,
          ]),
          mono: [0, 1, 4],
        },
      },
      ...leftOutNote('element segments', report.elements),
    );
  }
  if (report.data.rows.length > 0) {
    blocks.push(
      {
        kind: 'table',
        label: 'Data segments',
        table: {
          headers: ['Index', 'Flag', 'Mode', 'Memory', 'Offset', 'Size', 'File offset', 'First bytes', 'As text'],
          rows: report.data.rows.map((d) => [
            d.index,
            d.flag,
            d.mode,
            d.memory === null ? '' : d.memory,
            d.offset,
            d.size,
            d.fileOffset,
            d.previewHex,
            shown(d.previewText),
          ]),
          mono: [0, 1, 4, 5, 6, 7, 8],
        },
      },
      ...leftOutNote('data segments', report.data),
    );
  }
  return blocks;
}

function stringsBlocks(report: Report): OutputBlock[] {
  const { items, total, truncated, scanned } = report.strings;
  if (total === 0 && !truncated) return [];
  const blocks: OutputBlock[] = [];
  if (items.length > 0) {
    blocks.push({
      kind: 'list',
      label: 'Text found in data',
      items: items.map((s) => `${s.offset}: ${shown(s.text)}`),
    });
  }
  const parts: string[] = [];
  if (total > items.length) {
    parts.push(
      `${count(total - items.length)} more pieces of text are not listed; the list shows the first ${count(MAX_STRINGS)}.`,
    );
  }
  if (truncated) {
    parts.push(`Only the first ${count(scanned)} bytes of data segments were searched for text.`);
  }
  if (parts.length > 0) blocks.push({ kind: 'note', tone: 'info', value: parts.join(' ') });
  return blocks;
}

function customBlocks(report: Report): OutputBlock[] {
  if (report.customs.rows.length === 0) return [];
  return [
    {
      kind: 'table',
      label: 'Custom sections',
      table: {
        headers: ['Name', 'Defined by', 'Size (bytes)', 'Offset', 'What it holds'],
        rows: report.customs.rows.map((c) => [shown(c.name), c.standard, c.size, c.offset, shown(c.summary)]),
        mono: [0, 2, 3],
      },
    },
    ...leftOutNote('custom sections', report.customs),
  ];
}

function nameBlocks(report: Report): OutputBlock[] {
  if (report.names.subsections.length === 0) return [];
  return [
    {
      kind: 'table',
      label: 'Name section',
      table: {
        headers: ['Subsection', 'Id', 'Defined by', 'Entries', 'Size (bytes)'],
        rows: report.names.subsections.map((s) => [s.label, s.id, s.source, s.entries, s.size]),
        mono: [1, 3, 4],
      },
    },
  ];
}

/** The module as nested entries: sections first, then what each one holds, up to `MAX_TREE_ITEMS` entries in all. */
function moduleTree(report: Report): { nodes: TreeNode[]; total: number } {
  let budget = MAX_TREE_ITEMS;
  let total = 0;
  const nodes: TreeNode[] = [];
  const leaf = (label: string): TreeNode | null => {
    total++;
    if (budget <= 0) return null;
    budget--;
    return { label };
  };
  const children = (labels: Iterable<string>): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const label of labels) {
      const node = leaf(label);
      if (node !== null) out.push(node);
    }
    return out;
  };
  const customByOffset = new Map(report.customs.rows.map((c) => [c.offset, c]));
  const defined = <T extends { source: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.source === 'defined');
  for (const section of report.sections) {
    total++;
    if (budget <= 0) continue;
    budget--;
    let kids: TreeNode[] = [];
    switch (section.id) {
      case 0:
        kids = children([shown(customByOffset.get(section.offset)?.summary ?? '')]);
        break;
      case 1:
        kids = children(report.types.rows.map((t) => `${t.index}: ${t.text}`));
        break;
      case 2:
        kids = children(report.imports.rows.map((i) => `${shown(i.module)}.${shown(i.field)}: ${i.kind} ${i.index}`));
        break;
      case 3:
        kids = children([`${count(report.functions.defined)} functions`]);
        break;
      case 4:
        kids = children(defined(report.tables.rows).map((t) => `${t.index}: ${t.text}`));
        break;
      case 5:
        kids = children(defined(report.memories.rows).map((m) => `${m.index}: ${m.text}`));
        break;
      case 6:
        kids = children(
          defined(report.globals.rows).map((g) => `${g.index}: ${g.mutable ? 'mut ' : ''}${g.type} = ${g.init}`),
        );
        break;
      case 7:
        kids = children(report.exports.rows.map((e) => `${shown(e.name)}: ${e.kind} ${e.index}`));
        break;
      case 8:
        kids = children([`function ${report.start ?? ''}`]);
        break;
      case 9:
        kids = children(report.elements.rows.map((e) => `${e.index}: ${e.mode}, ${e.count} items`));
        break;
      case 10:
        kids = children([`${count(report.functions.defined)} bodies, ${count(report.functions.bodyBytes)} bytes`]);
        break;
      case 11:
        kids = children(report.data.rows.map((d) => `${d.index}: ${d.mode}, ${count(d.size)} bytes`));
        break;
      case 12:
        kids = children([`${report.dataCount ?? ''} data segments`]);
        break;
      case 13:
        kids = children(defined(report.tags.rows).map((t) => `${t.index}: ${t.text}`));
        break;
      default:
        break;
    }
    const label = section.id === 0 ? `custom: ${shown(section.customName)}` : `${section.name} section`;
    const node: TreeNode = { label, detail: `offset ${section.offset}, ${count(section.size)} bytes` };
    if (kids.length > 0) node.children = kids;
    nodes.push(node);
  }
  return { nodes, total };
}

function findingsBlocks(report: Report): OutputBlock[] {
  if (report.findings.length === 0) return [];
  const blocks: OutputBlock[] = [
    {
      kind: 'note',
      tone: 'warn',
      value: `${count(report.findings.length + report.findingsLeftOut)} things could not be read or look odd. They are listed under Findings, each with its offset in the file. The rest of the module is shown as far as it could be read.`,
    },
    {
      kind: 'table',
      label: 'Findings',
      table: {
        headers: ['Offset', 'What was found'],
        rows: report.findings.map((f) => [f.offset, f.message]),
        mono: [0],
      },
    },
  ];
  if (report.findingsLeftOut > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${count(report.findingsLeftOut)} more findings are not listed; the table holds at most 200.`,
    });
  }
  return blocks;
}

function outputsOf(report: Report, showStrings: boolean): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  if (report.kind !== 'module') {
    outputs.push({ kind: 'note', tone: 'info', value: report.sentence ?? 'This file is not a WebAssembly module.' });
    return outputs;
  }
  outputs.push(moduleBlock(report));
  outputs.push(...findingsBlocks(report));
  if (report.sections.length > 0) outputs.push(...sectionsBlock(report));
  outputs.push(...typesBlock(report));
  outputs.push(...importsBlock(report));
  outputs.push(...exportsBlock(report));
  outputs.push(...functionsBlock(report));
  outputs.push(...tablesBlocks(report));
  outputs.push(...segmentsBlocks(report));
  if (showStrings) outputs.push(...stringsBlocks(report));
  outputs.push(...customBlocks(report));
  outputs.push(...nameBlocks(report));
  if (report.sections.length > 0) {
    const tree = moduleTree(report);
    if (tree.total > MAX_TREE_ITEMS) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `The module tree shows the first ${count(MAX_TREE_ITEMS)} of ${count(tree.total)} entries.`,
      });
    }
    outputs.push({ kind: 'tree', label: 'Module structure', nodes: tree.nodes });
  }
  outputs.push({ kind: 'note', tone: 'info', value: LAST_NOTE });
  return outputs;
}

function failure(err: unknown): ToolResult {
  if (err instanceof WasmInspectorError) return { outputs: [], errors: [{ message: err.message }] };
  return { outputs: [], errors: [{ message: 'This file could not be read as a WebAssembly module.' }] };
}

export default defineTool({
  id: 'wasm-inspector',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'file',
      label: 'Open a .wasm file',
      type: 'file',
      accept: '.wasm,application/wasm',
      help: `Up to ${MAX_MODULE_BYTES / 1_048_576} MiB. The file is read here, never run, and nothing is uploaded.`,
    },
    {
      name: 'showStrings',
      label: 'List printable text found in data segments',
      type: 'checkbox',
      default: true,
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const picked = files(values, 'file');
      if (picked.length === 0) return { outputs: [] };
      const file = picked[0]!;
      // The size comes from the file object, so an oversized file is refused before any of it is read.
      checkModuleSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
      if (ctx.signal.aborted) return { outputs: [] };
      return { outputs: outputsOf(inspect(bytes), bool(values, 'showStrings', true)) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
