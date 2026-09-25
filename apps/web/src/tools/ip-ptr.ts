import { meta, ptrNames, IpPtrError } from '@fodt/ip-ptr';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ip-ptr',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Addresses or CIDR blocks, one per line',
      type: 'textarea',
      rows: 4,
      mono: true,
      default: '192.0.2.1',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'hostname',
      label: 'Host name for PTR records',
      type: 'text',
      mono: true,
      help: 'Optional: the name each address should point to.',
    },
    { name: 'ttl', label: 'TTL', type: 'number', default: 0, min: 0 },
  ],
  examples: [
    { label: 'A single IPv4 address', values: { input: '192.0.2.1' } },
    { label: 'A single IPv6 address', values: { input: '2001:db8::1' } },
    { label: 'A /24 block', values: { input: '192.0.2.0/24' } },
    {
      label: 'An address with a PTR record',
      values: { input: '192.0.2.1', hostname: 'host.example.com', ttl: 3600 },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = ptrNames(input, { hostname: str(values, 'hostname'), ttl: num(values, 'ttl', 0) });

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Reverse names',
          table: {
            headers: ['Input', 'Reverse name', 'Reverse zone'],
            rows: result.rows.map((r) => [r.input, r.reverseName ?? '', r.zone ?? '']),
            mono: [0, 1, 2],
          },
        },
      ];

      if (result.records.length > 0) {
        outputs.push({
          kind: 'code',
          label: 'PTR records',
          value: result.records.join('\n'),
          download: 'ptr-records.txt',
        });
      }

      if (result.problems.length > 0) {
        outputs.push({
          kind: 'note',
          label: 'Problems',
          tone: 'warn',
          value: result.problems.map((p) => (p.line === 0 ? p.message : `Line ${p.line}: ${p.message}`)).join('\n'),
        });
      }

      return { outputs };
    } catch (err) {
      if (err instanceof IpPtrError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
