import { meta, parseUserAgent } from '@fodt/user-agent';
import { defineTool, str, type OutputBlock, type ToolResult, type Tone } from '../lib/tool-ui';

const CONFIDENCE_TONE: Record<string, Tone> = { low: 'error', medium: 'warn', high: 'success' };

export default defineTool({
  id: 'user-agent',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'User-Agent string',
      type: 'textarea',
      rows: 3,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'A desktop Chrome string',
      values: {
        input:
          'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/30.0.1599.17 Safari/537.36',
      },
    },
    {
      label: 'A reduced Chromium string',
      values: {
        input:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
    },
    { label: "RFC 9110's own product-token example", values: { input: 'CERN-LineMode/2.15 libwww/2.17b3' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = parseUserAgent(input);

      const outputs: OutputBlock[] = [
        {
          kind: 'note',
          tone: CONFIDENCE_TONE[result.confidence] ?? 'info',
          value: `Confidence: ${result.confidence}`,
        },
        {
          kind: 'keyvalue',
          label: 'Parsed',
          pairs: [
            ['Browser', [result.browser.name, result.browser.version].filter(Boolean).join(' ') || '(unrecognised)'],
            ['Engine', [result.engine.name, result.engine.version].filter(Boolean).join(' ') || '(unrecognised)'],
            [
              'Operating system',
              [result.os.name, result.os.versionName ?? result.os.version].filter(Boolean).join(' ') ||
                '(unrecognised)',
            ],
            [
              'Device',
              [result.device.type, result.device.vendor, result.device.model].filter(Boolean).join(' ') ||
                '(unrecognised)',
            ],
            ['Confidence', result.confidence],
          ],
        },
        {
          kind: 'table',
          label: 'Product tokens (RFC 9110)',
          table: {
            headers: ['Product', 'Version', 'Comments'],
            rows: result.tokens.map((t) => [t.product, t.version ?? '', t.comments.join('; ')]),
            mono: [0, 1],
          },
        },
        {
          kind: 'list',
          label: 'Why this confidence',
          items: result.reasons.length > 0 ? result.reasons : ['Every part of this string was recognised.'],
        },
        { kind: 'note', label: 'Note', tone: 'info', value: result.note },
      ];

      return { outputs };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
