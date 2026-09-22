import { meta, generate, parse, NAMESPACES, type UuidVersion } from '@fodt/uuid';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'uuid',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'generate',
      options: [
        { value: 'generate', label: 'Generate' },
        { value: 'inspect', label: 'Inspect an existing UUID' },
      ],
    },
    {
      name: 'version',
      label: 'Version',
      type: 'select',
      default: '4',
      options: [
        { value: '4', label: 'v4 — random (the usual default)' },
        { value: '7', label: 'v7 — time-ordered, sorts by creation' },
        { value: '1', label: 'v1 — time-based, random node id' },
        { value: '5', label: 'v5 — deterministic from a name, SHA-1' },
        { value: '3', label: 'v3 — deterministic from a name, MD5 (legacy)' },
      ],
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'count',
      label: 'How many',
      type: 'number',
      default: 5,
      min: 1,
      max: 10000,
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'namespace',
      label: 'Namespace',
      type: 'select',
      default: NAMESPACES.dns,
      options: [
        { value: NAMESPACES.dns, label: 'DNS' },
        { value: NAMESPACES.url, label: 'URL' },
        { value: NAMESPACES.oid, label: 'OID' },
        { value: NAMESPACES.x500, label: 'X.500' },
      ],
      visible: (v) => v.mode === 'generate' && (v.version === '3' || v.version === '5'),
    },
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      default: 'www.example.com',
      placeholder: 'The name to hash into a UUID',
      visible: (v) => v.mode === 'generate' && (v.version === '3' || v.version === '5'),
    },
    { name: 'uppercase', label: 'Uppercase', type: 'checkbox', default: false, visible: (v) => v.mode === 'generate' },
    { name: 'hyphens', label: 'Keep hyphens', type: 'checkbox', default: true, visible: (v) => v.mode === 'generate' },
    {
      name: 'wrapper',
      label: 'Wrap as',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'Plain' },
        { value: 'braces', label: 'Braces {…}' },
        { value: 'urn', label: 'URN urn:uuid:…' },
      ],
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'toInspect',
      label: 'UUID to inspect',
      type: 'text',
      mono: true,
      placeholder: '2ed6657d-e927-568b-95e1-2665a8aea6a2',
      visible: (v) => v.mode === 'inspect',
    },
  ],
  examples: [
    { label: 'Ten v7', values: { mode: 'generate', version: '7', count: 10 } },
    { label: 'Deterministic v5', values: { mode: 'generate', version: '5', name: 'www.example.com' } },
    { label: 'Inspect', values: { mode: 'inspect', toInspect: '2ed6657d-e927-568b-95e1-2665a8aea6a2' } },
  ],
  run(values): ToolResult {
    if (values.mode === 'inspect') {
      const input = str(values, 'toInspect');
      if (!input.trim()) return { outputs: [] };
      const parsed = parse(input);
      if (!parsed.valid) {
        return { outputs: [], errors: parsed.problems.map((message) => ({ message })) };
      }
      const pairs: [string, string][] = [
        ['Canonical', parsed.canonical],
        ['Version', parsed.isNil ? 'nil UUID' : parsed.isMax ? 'max UUID' : String(parsed.version)],
        ['Variant', parsed.variant],
        ['Hex', parsed.hex],
        ['URN', parsed.urn],
        ['Base64url', parsed.base64url],
      ];
      if (parsed.timestamp) {
        pairs.push(['Created', `${parsed.timestamp.iso} (epoch ms ${parsed.timestamp.ms})`]);
      }
      if (parsed.clockSequence !== undefined) pairs.push(['Clock sequence', String(parsed.clockSequence)]);
      if (parsed.node) {
        pairs.push([
          'Node id',
          `${parsed.node}${parsed.nodeIsRandom ? ' (random, not a MAC address)' : ' (looks like a real MAC address)'}`,
        ]);
      }

      const outputs: OutputBlock[] = [{ kind: 'keyvalue', label: 'Fields', pairs }];
      for (const p of parsed.problems) outputs.push({ kind: 'note', tone: 'warn', value: p });
      if (parsed.version === 1 && parsed.nodeIsRandom === false) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value:
            'The node identifier has the multicast bit clear, which suggests a real network card address is embedded in this id.',
        });
      }
      return { outputs };
    }

    const version = Number(str(values, 'version', '4')) as UuidVersion;
    const count = Math.min(Math.max(num(values, 'count', 5), 1), 10000);
    const wrapper = str(values, 'wrapper', 'none');

    const ids = generate({
      version,
      count,
      namespace: str(values, 'namespace', NAMESPACES.dns),
      name: str(values, 'name'),
      uppercase: bool(values, 'uppercase'),
      hyphens: bool(values, 'hyphens', true),
      braces: wrapper === 'braces',
      urn: wrapper === 'urn',
    });

    const outputs: OutputBlock[] = [
      { kind: 'code', label: `${count} UUID${count === 1 ? '' : 's'}`, value: ids.join('\n'), download: 'uuids.txt' },
    ];

    if (version === 3) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value:
          'Version 3 uses MD5, which is cryptographically broken. It exists for compatibility with systems that already use it. Choose version 5 for anything new.',
      });
    }
    if (version === 1 || version === 7) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This version embeds the time it was created, so anyone holding the id can read roughly when it was made. Use version 4 if that matters.',
      });
    }
    if (version === 3 || version === 5) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This version is deterministic: the same namespace and name always produce the same id, which is the point of it.',
      });
    }

    return {
      outputs,
      stats: [
        ['Generated', String(count)],
        ['Source of randomness', version === 3 || version === 5 ? 'none, deterministic' : 'crypto.getRandomValues'],
      ],
    };
  },
});
