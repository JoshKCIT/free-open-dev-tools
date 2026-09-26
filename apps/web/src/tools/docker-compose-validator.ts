import { meta } from '@fodt/docker-compose-validator';
import { composeInWorker, ComposeRunError } from '../lib/run-docker-compose-in-worker';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const EXAMPLE = `services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    image: node:20
    environment:
      - PORT=3000
`;

export default defineTool({
  id: 'docker-compose-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Compose file',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [{ label: 'A two-service Compose file', values: { input: EXAMPLE } }],
  async run(values, ctx): Promise<ToolResult> {
    const text = str(values, 'input');
    if (!text.trim()) return { outputs: [] };

    try {
      const result = await composeInWorker({ type: 'compose-job', text }, ctx);
      return renderResult(result);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof ComposeRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This Compose file could not be validated.' }],
      };
    }
  },
});

function renderResult(result: {
  valid: boolean;
  findings: {
    line: number;
    column: number;
    path: string;
    pointer: string;
    keyword: string;
    severity: string;
    message: string;
  }[];
  services: string[];
  schemaCommit: string;
}): ToolResult {
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const shortSha = result.schemaCommit.slice(0, 7);

  const outputs: ToolResult['outputs'] = [];
  if (result.valid) {
    outputs.push({
      kind: 'note',
      tone: 'success',
      value: `No problems found against the Compose Specification schema at commit ${shortSha}.`,
    });
  }
  if (result.findings.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Findings',
      table: {
        headers: ['Line', 'Column', 'Key', 'Problem'],
        rows: result.findings.map((f) => [f.line, f.column, f.path || '(whole document)', f.message]),
        mono: [2],
      },
    });
  }

  return {
    outputs,
    errors: errors.map((f) => ({ message: f.message, line: f.line, column: f.column, path: f.path })),
    warnings: warnings.map((f) => `Line ${f.line}: ${f.message}`),
    stats: [
      ['Services', String(result.services.length)],
      ['Warnings', String(warnings.length)],
    ],
  };
}
