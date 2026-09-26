import { meta, lintDockerfile, RULES } from '@fodt/dockerfile-lint';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const EXAMPLE = `FROM node:latest
WORKDIR /app
COPY package.json /app
RUN npm install
COPY . /app
EXPOSE 3000
CMD npm start
`;

export default defineTool({
  id: 'dockerfile-lint',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Dockerfile',
      type: 'textarea',
      rows: 18,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [{ label: 'An image with a deliberate latest tag', values: { input: EXAMPLE } }],
  run(values): ToolResult {
    const text = str(values, 'input');
    if (!text.trim()) return { outputs: [] };

    try {
      const result = lintDockerfile(text);
      return renderResult(result);
    } catch (err) {
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This Dockerfile could not be linted.' }],
      };
    }
  },
});

interface RenderableFinding {
  line: number;
  column?: number;
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

function renderResult(result: {
  findings: RenderableFinding[];
  stages: { index: number; line: number; name?: string; baseImage: string }[];
}): ToolResult {
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');

  const outputs: OutputBlock[] = [];

  if (result.findings.length === 0) {
    outputs.push({ kind: 'note', tone: 'success', value: 'No syntax problems or common mistakes found.' });
  } else {
    outputs.push({
      kind: 'table',
      label: 'Findings',
      table: {
        headers: ['Line', 'Key', 'Problem'],
        rows: result.findings.map((f) => [f.line, f.path, f.message]),
        mono: [1],
      },
    });
  }

  if (result.stages.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Stages',
      table: {
        headers: ['#', 'Line', 'Base image', 'Name'],
        rows: result.stages.map((s) => [s.index, s.line, s.baseImage, s.name ?? '']),
      },
    });
  }

  outputs.push({
    kind: 'list',
    label: 'Rules checked',
    items: RULES.map((r) => `${r.id}: ${r.title} (${r.docsUrl})`),
  });

  return {
    outputs,
    errors: errors.map((f) => ({ message: f.message, line: f.line, column: f.column, path: f.path })),
    warnings: warnings.map((f) => `Line ${f.line}: ${f.path}: ${f.message}`),
    stats: [
      ['Stages', String(result.stages.length)],
      ['Findings', String(result.findings.length)],
    ],
  };
}
