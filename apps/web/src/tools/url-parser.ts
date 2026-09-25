import { meta, parseUrl, parseQuery, UrlParserError } from '@fodt/url-parser';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'url-parser',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to parse',
      type: 'radio',
      default: 'url',
      options: [
        { value: 'url', label: 'Full URL' },
        { value: 'query', label: 'Query string only' },
      ],
    },
    {
      name: 'input',
      label: 'URL or query string',
      type: 'textarea',
      rows: 3,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'base',
      label: 'Base URL',
      type: 'text',
      mono: true,
      help: 'Only needed for a relative URL.',
      visible: (v) => v.mode === 'url',
    },
  ],
  examples: [
    {
      label: 'A URL with credentials, a port and a repeated query key',
      values: { mode: 'url', input: 'https://user:pw@example.com:8080/a/b?x=1&x=2#frag' },
    },
    { label: 'A query string on its own', values: { mode: 'query', input: 'a=1&a=2&b=hello%20world' } },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'url');
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      if (mode === 'query') {
        const { query, queryObject } = parseQuery(input);
        const outputs: OutputBlock[] = [
          {
            kind: 'table',
            label: 'Query parameters',
            table: { headers: ['#', 'Name', 'Value'], rows: query.map((q, i) => [String(i + 1), q.name, q.value]) },
          },
          {
            kind: 'code',
            label: 'Query as JSON',
            language: 'json',
            value: JSON.stringify(queryObject, null, 2),
            download: 'query.json',
          },
        ];
        return { outputs };
      }

      const base = str(values, 'base');
      const result = parseUrl(input, { base });

      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Parts',
          pairs: [
            ['href', result.href],
            ['origin', result.origin],
            ['protocol', result.protocol],
            ['username', result.username],
            ['password', result.password],
            ['host', result.host],
            ['hostname', result.hostname],
            ['port', result.port || '(default for the scheme)'],
            ['pathname', result.pathname],
            ['search', result.search],
            ['hash', result.hash],
          ],
        },
        {
          kind: 'table',
          label: 'Query parameters',
          table: {
            headers: ['#', 'Name', 'Value'],
            rows: result.query.map((q, i) => [String(i + 1), q.name, q.value]),
          },
        },
        {
          kind: 'code',
          label: 'Query as JSON',
          language: 'json',
          value: JSON.stringify(result.queryObject, null, 2),
          download: 'query.json',
        },
        {
          kind: 'list',
          label: 'Path segments',
          items: result.pathSegments.map((s) =>
            s.decoded !== null && s.decoded !== s.raw ? `${s.raw} (${s.decoded})` : s.raw,
          ),
        },
      ];

      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
      }

      return { outputs };
    } catch (err) {
      if (err instanceof UrlParserError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
