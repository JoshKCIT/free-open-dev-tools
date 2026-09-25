import {
  meta,
  buildRequest,
  parseCurl,
  emitAll,
  CurlConverterError,
  type BuildRequestFields,
  type RequestSpec,
} from '@fodt/curl-converter';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => ({
  value: m,
  label: m,
}));

const BODY_KIND_OPTIONS: { value: BuildRequestFields['bodyKind']; label: string }[] = [
  { value: 'none', label: '(no body)' },
  { value: 'raw', label: 'Raw text' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form (application/x-www-form-urlencoded)' },
  { value: 'multipart', label: 'Multipart form' },
];

const BODY_HELP =
  'Raw text is sent exactly as typed. JSON must be a valid document (Content-Type: application/json is written for you). ' +
  'Form and multipart both read one name=value pair per line; for multipart, write name=@filename for a placeholder file field.';

const AUTH_OPTIONS: { value: BuildRequestFields['authKind']; label: string }[] = [
  { value: 'none', label: '(no authentication)' },
  { value: 'basic', label: 'Basic (username and password)' },
  { value: 'bearer', label: 'Bearer token' },
];

function outputBlocksForRequest(
  request: RequestSpec,
  redactSecrets: boolean,
): { outputs: OutputBlock[]; warnings: string[] } {
  const { snippets, secrets, warnings } = emitAll(request, { redactSecrets });

  const outputs: OutputBlock[] = [
    { kind: 'code', label: 'cURL', language: 'bash', value: snippets.curl },
    { kind: 'code', label: 'JavaScript fetch', language: 'javascript', value: snippets.fetch },
    { kind: 'code', label: 'Python requests', language: 'python', value: snippets.python },
    { kind: 'code', label: 'Go net/http', language: 'go', value: snippets.go },
    { kind: 'code', label: 'PHP curl', language: 'php', value: snippets.php },
    { kind: 'code', label: 'HTTPie', language: 'bash', value: snippets.httpie },
  ];

  if (secrets.length > 0 && !redactSecrets) {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: 'This code contains the password or token you entered. Do not paste it anywhere public.',
    });
  }
  outputs.push({ kind: 'note', tone: 'info', value: 'This page never sends the request.' });

  return { outputs, warnings };
}

export default defineTool({
  id: 'curl-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Start from',
      type: 'radio',
      default: 'build',
      options: [
        { value: 'build', label: 'Build a request' },
        { value: 'paste', label: 'Paste a curl command' },
      ],
    },
    {
      name: 'command',
      label: 'curl command',
      type: 'textarea',
      rows: 6,
      mono: true,
      placeholder: "curl -X POST 'https://example.com/api' -H 'Content-Type: application/json' -d '{\"a\":1}'",
      visible: (v) => v.mode === 'paste',
    },
    {
      name: 'method',
      label: 'Method',
      type: 'select',
      default: 'GET',
      options: METHOD_OPTIONS,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'url',
      label: 'URL',
      type: 'text',
      mono: true,
      placeholder: 'https://example.com/path',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'headers',
      label: 'Headers (one Name: value per line)',
      type: 'textarea',
      rows: 3,
      mono: true,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'query',
      label: 'Query parameters (one name=value per line)',
      type: 'textarea',
      rows: 3,
      mono: true,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'bodyKind',
      label: 'Body',
      type: 'select',
      default: 'none',
      options: BODY_KIND_OPTIONS,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'body',
      label: 'Body text',
      type: 'textarea',
      rows: 4,
      mono: true,
      help: BODY_HELP,
      visible: (v) => v.mode === 'build' && v.bodyKind !== 'none',
    },
    {
      name: 'auth',
      label: 'Authentication',
      type: 'select',
      default: 'none',
      options: AUTH_OPTIONS,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'username',
      label: 'Username',
      type: 'text',
      visible: (v) => v.mode === 'build' && v.auth === 'basic',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      visible: (v) => v.mode === 'build' && v.auth === 'basic',
    },
    {
      name: 'token',
      label: 'Bearer token',
      type: 'text',
      visible: (v) => v.mode === 'build' && v.auth === 'bearer',
    },
    {
      name: 'followRedirects',
      label: 'Follow redirects',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'redactSecrets',
      label: 'Replace passwords and tokens with placeholders',
      type: 'checkbox',
      default: false,
    },
  ],
  examples: [
    {
      label: 'Paste: POST with a JSON body',
      values: {
        mode: 'paste',
        command: "curl -X POST 'https://example.com/api' -H 'Content-Type: application/json' -d '{\"a\":1}'",
      },
    },
    {
      label: 'Build: bearer-authenticated GET',
      values: { mode: 'build', url: 'https://example.com/api', auth: 'bearer', token: 'YOUR_TOKEN' },
    },
  ],
  run(values): ToolResult {
    try {
      const mode = str(values, 'mode', 'build');
      const redactSecrets = bool(values, 'redactSecrets', false);

      if (mode === 'paste') {
        const command = str(values, 'command');
        if (!command.trim()) return { outputs: [] };

        const { request, warnings: parseWarnings, ignored } = parseCurl(command);

        const readBack: OutputBlock = {
          kind: 'keyvalue',
          label: 'Request read from the command',
          pairs: [
            ['Method', request.method],
            ['URL', request.url],
            [
              'Headers',
              request.headers.length > 0 ? request.headers.map(([n, v]) => `${n}: ${v}`).join('\n') : '(none)',
            ],
            ['Body kind', request.body.kind],
            ['Auth kind', request.auth.kind],
          ],
        };

        const { outputs: codeOutputs, warnings: emitWarnings } = outputBlocksForRequest(request, redactSecrets);

        const outputs: OutputBlock[] = [readBack];
        if (ignored.length > 0) outputs.push({ kind: 'list', label: 'Ignored options', items: ignored });
        outputs.push(...codeOutputs);

        const allWarnings = [...parseWarnings, ...emitWarnings];
        return { outputs, warnings: allWarnings.length > 0 ? allWarnings : undefined };
      }

      const url = str(values, 'url');
      if (!url.trim()) return { outputs: [] };

      const fields: BuildRequestFields = {
        method: str(values, 'method', 'GET'),
        url,
        headersText: str(values, 'headers'),
        queryText: str(values, 'query'),
        bodyKind: str(values, 'bodyKind', 'none') as BuildRequestFields['bodyKind'],
        bodyText: str(values, 'body'),
        authKind: str(values, 'auth', 'none') as BuildRequestFields['authKind'],
        username: str(values, 'username'),
        password: str(values, 'password'),
        token: str(values, 'token'),
        followRedirects: bool(values, 'followRedirects', false),
      };

      const { request, problems } = buildRequest(fields);
      if (problems.length > 0) {
        return { outputs: [], errors: problems.map((p) => ({ message: p.message, line: p.line })) };
      }

      const { outputs, warnings } = outputBlocksForRequest(request, redactSecrets);
      return { outputs, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (err) {
      if (err instanceof CurlConverterError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
