import { meta, type XPathNodeResult } from '@fodt/xpath-tester';
import { xpathInWorker, XPathRunError } from '../lib/run-xpath-tester-in-worker';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const MAX_MARKUP_PREVIEW = 20;

/** Reads `prefix=uri` lines, one per line; a line with no `=` is skipped and warned about. */
function parseNamespaces(text: string): { map: Record<string, string>; warnings: string[] } {
  const map: Record<string, string> = {};
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) {
      warnings.push(`"${line}" is not "prefix=uri" and was skipped.`);
      continue;
    }
    const prefix = line.slice(0, eq).trim();
    const uri = line.slice(eq + 1).trim();
    if (!prefix || !uri) {
      warnings.push(`"${line}" is not "prefix=uri" and was skipped.`);
      continue;
    }
    map[prefix] = uri;
  }
  return { map, warnings };
}

export default defineTool({
  id: 'xpath-tester',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'xml',
      label: 'XML document',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'expression',
      label: 'Expression',
      type: 'text',
      mono: true,
      default: '/',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'namespaces',
      label: 'Namespaces',
      type: 'textarea',
      rows: 4,
      mono: true,
      help: 'One prefix=uri per line.',
      placeholder: 'bk=urn:example:book',
    },
    {
      name: 'rootNamespaces',
      label: 'Also use namespaces declared on the root element',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [
    {
      label: 'Abbreviated syntax',
      values: {
        xml: '<catalog><book id="1"><title>Moby Dick</title></book><book id="2"><title>War and Peace</title></book></catalog>',
        expression: '//book[@id="2"]/title',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const xml = str(values, 'xml');
    const expression = str(values, 'expression', '/');
    if (!xml.trim() || !expression) return { outputs: [] };

    const { map: namespaces, warnings: namespaceWarnings } = parseNamespaces(str(values, 'namespaces'));
    const rootNamespaces = bool(values, 'rootNamespaces', true);

    try {
      const result = await xpathInWorker(
        { type: 'xpath-job', xml, expression, namespaces, maxNodes: 1000, rootNamespaces },
        ctx,
      );
      const rendered = renderResult(result);
      if (namespaceWarnings.length > 0) {
        rendered.outputs.push({ kind: 'note', tone: 'warn', value: namespaceWarnings.join('\n') });
      }
      return rendered;
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own
      // cancellation note already owns that message. Every other rejection -- including
      // the time-limit message the worker helper composes on its own -- is shown as an
      // input problem.
      if (ctx.signal.aborted) throw err;
      if (err instanceof XPathRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.kind === 'xml' ? err.line : 1, column: err.column }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This expression could not be evaluated.' }],
      };
    }
  },
});

function renderResult(result: {
  kind: string;
  value?: string | boolean;
  nodes?: XPathNodeResult[];
  total?: number;
}): ToolResult {
  if (result.kind === 'nodeset') {
    const nodes = result.nodes ?? [];
    const total = result.total ?? nodes.length;
    if (nodes.length === 0) {
      return {
        outputs: [{ kind: 'note', tone: 'info', value: 'No match.' }],
        stats: [
          ['Nodes', '0'],
          ['Type', 'node-set'],
        ],
      };
    }
    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Matches',
        table: {
          headers: ['#', 'Type', 'Name', 'Path', 'Value'],
          rows: nodes.map((n, i) => [i + 1, n.type, n.name, n.path, n.value]),
          mono: [3, 4],
        },
      },
      {
        kind: 'code',
        label: 'Markup (first ' + Math.min(MAX_MARKUP_PREVIEW, nodes.length) + ')',
        language: 'xml',
        value: nodes
          .slice(0, MAX_MARKUP_PREVIEW)
          .map((n) => n.markup)
          .join('\n'),
      },
    ];
    if (total > nodes.length) {
      outputs.push({ kind: 'note', tone: 'info', value: `${total - nodes.length} more node(s) not shown.` });
    }
    return {
      outputs,
      stats: [
        ['Nodes', String(total)],
        ['Type', 'node-set'],
      ],
    };
  }

  const valueText = result.kind === 'boolean' ? String(result.value) : String(result.value ?? '');
  return {
    outputs: [
      {
        kind: 'keyvalue',
        pairs: [
          ['Type', result.kind],
          ['Value', valueText],
        ],
      },
    ],
    stats: [
      ['Nodes', '-'],
      ['Type', result.kind],
    ],
  };
}
