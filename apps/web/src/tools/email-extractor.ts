import { meta, extractPatterns, PATTERN_KINDS, type PatternKind } from '@fodt/email-extractor';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const KIND_LABELS: Record<PatternKind, string> = {
  email: 'Email address',
  url: 'URL',
  ipv4: 'IPv4 address',
  ipv6: 'IPv6 address',
  phone: 'Phone number',
};

export default defineTool({
  id: 'email-extractor',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Text',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'find-email', label: 'Find email addresses', type: 'checkbox', default: true },
    { name: 'find-url', label: 'Find URLs', type: 'checkbox', default: true },
    { name: 'find-ipv4', label: 'Find IPv4 addresses', type: 'checkbox', default: true },
    { name: 'find-ipv6', label: 'Find IPv6 addresses', type: 'checkbox', default: true },
    { name: 'find-phone', label: 'Find phone numbers', type: 'checkbox', default: true },
    { name: 'dedupe', label: 'Collapse duplicates into one entry with a count', type: 'checkbox', default: true },
  ],
  examples: [
    {
      label: 'Contact details in a log line',
      values: { input: 'Contact ops@example.com or https://example.com/status from 192.0.2.10.' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const kinds: PatternKind[] = [];
    if (bool(values, 'find-email', true)) kinds.push('email');
    if (bool(values, 'find-url', true)) kinds.push('url');
    if (bool(values, 'find-ipv4', true)) kinds.push('ipv4');
    if (bool(values, 'find-ipv6', true)) kinds.push('ipv6');
    if (bool(values, 'find-phone', true)) kinds.push('phone');
    const dedupe = bool(values, 'dedupe', true);

    if (kinds.length === 0) {
      return { outputs: [{ kind: 'note', tone: 'warn', value: 'Choose at least one kind to look for.' }] };
    }

    const results = extractPatterns(input, { kinds, dedupe });

    if (results.length === 0) {
      return { outputs: [{ kind: 'note', tone: 'info', value: 'No matches found.' }] };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Matches',
        table: {
          headers: ['Kind', 'Value', 'Count'],
          rows: results.map((r) => [KIND_LABELS[r.kind], r.value, r.count]),
          mono: [1],
        },
      },
    ];

    for (const kind of PATTERN_KINDS) {
      const found = results.filter((r) => r.kind === kind).map((r) => r.value);
      if (found.length > 0) {
        outputs.push({ kind: 'list', label: `${KIND_LABELS[kind]}s found`, items: found });
      }
    }

    return { outputs };
  },
});
