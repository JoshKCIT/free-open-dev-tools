import { meta } from '@fodt/github-actions-validator';
import { githubActionsInWorker, GithubActionsRunError } from '../lib/run-github-actions-in-worker';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const EXAMPLE = `name: node.js CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: \${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
`;

export default defineTool({
  id: 'github-actions-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Workflow file',
      type: 'textarea',
      rows: 18,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [{ label: 'A Node.js CI workflow', values: { input: EXAMPLE } }],
  async run(values, ctx): Promise<ToolResult> {
    const text = str(values, 'input');
    if (!text.trim()) return { outputs: [] };

    try {
      const result = await githubActionsInWorker({ type: 'workflow-job', text }, ctx);
      return renderResult(result);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof GithubActionsRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This workflow file could not be validated.' }],
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
  jobs: string[];
  events: string[];
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
      value: `No problems found against the GitHub Actions workflow schema at commit ${shortSha}.`,
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
      ['Jobs', String(result.jobs.length)],
      ['Triggers', String(result.events.length)],
      ['Warnings', String(warnings.length)],
    ],
  };
}
