import {
  DockerRunError,
  convertDockerRun,
  meta,
  validateComposeDocument,
  type ConversionResult,
} from '@fodt/docker-run-to-compose';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

// The schema check is compiled once, and compiling takes about a tenth of a second. Doing it now, while the page loads,
// means the first answer a visitor waits for is as quick as every later one.
validateComposeDocument({ services: {} });

/** The first example: a web server with a port, a bind mount of the current folder and a restart policy. */
const WEB_EXAMPLE =
  'docker run -d --name web -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro --restart unless-stopped nginx:1.27';

/** The second example: a database with variables, a named volume and a port on the loopback address only. */
const DATABASE_EXAMPLE = [
  'docker run -d --name db \\',
  '  -e POSTGRES_PASSWORD=example \\',
  '  -e POSTGRES_DB=app \\',
  '  -v pgdata:/var/lib/postgresql/data \\',
  '  -p 127.0.0.1:5432:5432 \\',
  '  postgres:16',
].join('\n');

/** How many rows of the options table are shown; the counts above it cover every option read. */
const MAX_ROWS_SHOWN = 1_000;
/** How many items of each list are shown. */
const MAX_LIST_ITEMS = 200;

/** A list block, cut at the most items shown, with a note saying how many were left out. */
function listBlocks(label: string, items: string[]): OutputBlock[] {
  if (items.length === 0) return [];
  const blocks: OutputBlock[] = [{ kind: 'list', label, items: items.slice(0, MAX_LIST_ITEMS) }];
  if (items.length > MAX_LIST_ITEMS) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `Showing the first ${MAX_LIST_ITEMS} of ${items.length} items in this list.`,
    });
  }
  return blocks;
}

function outputsFor(result: ConversionResult): OutputBlock[] {
  const outputs: OutputBlock[] = [
    { kind: 'code', label: 'Compose service', language: 'yaml', value: result.yaml, download: 'compose.yaml' },
  ];
  if (result.rows.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Options read',
      table: {
        headers: ['Option', 'Value', 'Compose key'],
        rows: result.rows.slice(0, MAX_ROWS_SHOWN).map((row) => [row.option, row.value, row.key]),
        mono: [0, 1, 2],
      },
    });
    if (result.rows.length > MAX_ROWS_SHOWN) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing the first ${MAX_ROWS_SHOWN} of ${result.rows.length} options read; the counts above cover every option.`,
      });
    }
  }
  outputs.push(
    ...listBlocks(
      'Options with no Compose equivalent',
      result.noEquivalent.map((entry) => `${entry.option}: ${entry.reason}`),
    ),
    ...listBlocks(
      'Options that need another service',
      result.needsAnotherService.map((entry) => `${entry.option} (${entry.key}): ${entry.reason}`),
    ),
    ...listBlocks(
      'Unknown options',
      result.unknown.map((entry) =>
        entry.closest === null
          ? `${entry.name}: no known option is close to it`
          : `${entry.name}: did you mean ${entry.closest}?`,
      ),
    ),
  );
  if (result.validation.valid) {
    outputs.push({
      kind: 'note',
      tone: 'success',
      value: 'The service is valid against the Compose Specification schema.',
    });
  } else {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: 'The Compose Specification schema does not accept this document. Each problem is listed with its path.',
    });
    outputs.push(
      ...listBlocks(
        'Compose Specification schema problems',
        result.validation.errors.map((problem) => `${problem.path}: ${problem.message}`),
      ),
    );
  }
  for (const hint of result.hints) outputs.push({ kind: 'note', tone: 'info', value: hint });
  return outputs;
}

export default defineTool({
  id: 'docker-run-to-compose',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'command',
      label: 'docker run command',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A docker run command, with backslash line breaks if you like. It is read as text and never run.',
    },
    {
      name: 'serviceName',
      label: 'Service name',
      type: 'text',
      placeholder: 'web',
      help: 'Optional. Left empty, the name comes from --name or the image.',
      mono: true,
    },
  ],
  examples: [
    {
      label: 'A web server with a port and a volume',
      values: { command: WEB_EXAMPLE, serviceName: '' },
    },
    {
      label: 'A database with environment and a named volume',
      values: { command: DATABASE_EXAMPLE, serviceName: '' },
    },
  ],
  run(values): ToolResult {
    const command = str(values, 'command');
    if (command.trim() === '') return { outputs: [] };
    try {
      const result = convertDockerRun(command, str(values, 'serviceName'));
      return {
        outputs: outputsFor(result),
        stats: [
          ['Options read', String(result.rows.length)],
          ['No Compose equivalent', String(result.noEquivalent.length)],
          ['Need another service', String(result.needsAnotherService.length)],
        ],
      };
    } catch (error) {
      if (error instanceof DockerRunError) {
        return { outputs: [], errors: [{ message: error.message, line: error.line, column: error.column }] };
      }
      return { outputs: [], errors: [{ message: 'Could not read this command.' }] };
    }
  },
});
