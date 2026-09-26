import { meta } from '@fodt/k8s-validator';
import { k8sInWorker, K8sRunError } from '../lib/run-k8s-in-worker';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const EXAMPLE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.14.2
          ports:
            - containerPort: 80
`;

export default defineTool({
  id: 'k8s-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Kubernetes manifest(s)',
      type: 'textarea',
      rows: 18,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [{ label: 'A Deployment with a matching selector', values: { input: EXAMPLE } }],
  async run(values, ctx): Promise<ToolResult> {
    const text = str(values, 'input');
    if (!text.trim()) return { outputs: [] };

    try {
      const result = await k8sInWorker({ type: 'k8s-job', text }, ctx);
      return renderResult(result);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof K8sRunError) {
        return {
          outputs: [],
          errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This manifest could not be validated.' }],
      };
    }
  },
});

interface RenderableFinding {
  line: number;
  column: number;
  path: string;
  severity: string;
  message: string;
}

interface RenderableDocument {
  index: number;
  line: number;
  apiVersion?: string;
  kind?: string;
  name?: string;
  checked: boolean;
}

function renderResult(result: {
  valid: boolean;
  findings: RenderableFinding[];
  documents: RenderableDocument[];
  schemaVersion: string;
  schemaCommit: string;
}): ToolResult {
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const notChecked = result.documents.filter((d) => !d.checked);
  const shortSha = result.schemaCommit.slice(0, 7);

  const outputs: ToolResult['outputs'] = [];
  if (result.valid) {
    outputs.push({
      kind: 'note',
      tone: 'success',
      value: `No problems found against the Kubernetes ${result.schemaVersion} schema subset at commit ${shortSha}.`,
    });
  }
  if (notChecked.length > 0) {
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: `${notChecked.length} of ${result.documents.length} resource(s) named a kind this tool does not bundle a schema for, so they were not checked.`,
    });
  }
  if (result.documents.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Documents',
      table: {
        headers: ['#', 'Line', 'Kind', 'apiVersion', 'Name', 'Checked'],
        rows: result.documents.map((d) => [
          d.index + 1,
          d.line,
          d.kind ?? '(unknown)',
          d.apiVersion ?? '(unknown)',
          d.name ?? '(none)',
          d.checked ? 'Yes' : 'No',
        ]),
      },
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
      ['Resources', String(result.documents.length)],
      ['Not checked', String(notChecked.length)],
    ],
  };
}
