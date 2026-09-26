import { meta, parseEnv, convertEnv, readTarget, writeEnv, type EnvTarget } from '@fodt/dotenv-toolkit';
import { defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const TARGET_OPTIONS = [
  { value: 'compose', label: 'Compose environment' },
  { value: 'configmap', label: 'Kubernetes ConfigMap' },
  { value: 'secret', label: 'Kubernetes Secret' },
  { value: 'shell', label: 'shell export' },
  { value: 'json', label: 'JSON' },
];

const TARGET_LANGUAGE: Record<EnvTarget, string> = {
  compose: 'yaml',
  configmap: 'yaml',
  secret: 'yaml',
  shell: 'shell',
  json: 'json',
};

const TARGET_FILENAME: Record<EnvTarget, string> = {
  compose: 'compose.env.yaml',
  configmap: 'configmap.yaml',
  secret: 'secret.yaml',
  shell: 'env.sh',
  json: 'env.json',
};

export default defineTool({
  id: 'dotenv-toolkit',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'from-env',
      options: [
        { value: 'from-env', label: '.env to another format' },
        { value: 'to-env', label: 'Another format to .env' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'to',
      label: 'To',
      type: 'select',
      default: 'json',
      options: TARGET_OPTIONS,
      visible: (values: Values) => str(values, 'direction', 'from-env') === 'from-env',
    },
    {
      name: 'from',
      label: 'From',
      type: 'select',
      default: 'json',
      options: TARGET_OPTIONS,
      visible: (values: Values) => str(values, 'direction', 'from-env') === 'to-env',
    },
    {
      name: 'serviceName',
      label: 'Service name',
      type: 'text',
      default: 'app',
      visible: (values: Values) =>
        str(values, 'direction', 'from-env') === 'from-env' && str(values, 'to', 'json') === 'compose',
    },
    {
      name: 'resourceName',
      label: 'Resource name',
      type: 'text',
      default: 'app-config',
      visible: (values: Values) =>
        str(values, 'direction', 'from-env') === 'from-env' &&
        (str(values, 'to', 'json') === 'configmap' || str(values, 'to', 'json') === 'secret'),
    },
  ],
  examples: [{ label: '.env to JSON', values: { direction: 'from-env', input: 'BASIC=basic', to: 'json' } }],
  run(values): ToolResult {
    const direction = str(values, 'direction', 'from-env');
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    if (direction === 'to-env') {
      const from = str(values, 'from', 'json') as EnvTarget;
      const { entries, problems } = readTarget(input, from);
      const { output, unrepresentable } = writeEnv(entries);
      const outputs: OutputBlock[] = [
        { kind: 'code', label: '.env', language: undefined, value: output, download: '.env' },
      ];
      const warnings = [
        ...problems.map((p) => `Line ${p.line}: ${p.message}`),
        ...unrepresentable.map((u) => `"${u.key}" was left out: ${u.reason}`),
      ];
      return { outputs, warnings, stats: [['Keys', String(entries.length)]] };
    }

    const to = str(values, 'to', 'json') as EnvTarget;
    const serviceName = str(values, 'serviceName', 'app');
    const resourceName = str(values, 'resourceName', to === 'secret' ? 'app-secret' : 'app-config');

    const { entries, problems } = parseEnv(input);
    const { output, warnings } = convertEnv(input, { to, serviceName, resourceName });

    const outputs: OutputBlock[] = [
      { kind: 'code', label: 'Output', language: TARGET_LANGUAGE[to], value: output, download: TARGET_FILENAME[to] },
      {
        kind: 'table',
        label: 'Keys',
        table: {
          headers: ['Line', 'Key', 'Length', 'Quoted'],
          rows: entries.map((e) => [e.line, e.key, e.value.length, e.quote]),
          mono: [1],
        },
      },
    ];
    if (to === 'secret') {
      outputs.push({ kind: 'note', tone: 'info', value: 'Secret data is base64, which is encoding, not encryption.' });
    }

    const allWarnings = [...problems.map((p) => `Line ${p.line}: ${p.message}`), ...warnings];

    return { outputs, warnings: allWarnings, stats: [['Keys', String(entries.length)]] };
  },
});
