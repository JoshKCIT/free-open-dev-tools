import {
  meta,
  buildLink,
  MarkupError,
  LINK_KINDS,
  FIELD_LABELS,
  type LinkKind,
  type LinkSpec,
} from '@fodt/link-builder';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const KIND_LABELS: Record<LinkKind, string> = {
  mailto: 'Email (mailto)',
};

export default defineTool({
  id: 'link-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'kind',
      label: FIELD_LABELS.kind,
      type: 'select',
      default: 'mailto',
      options: LINK_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
    },
    {
      name: 'text',
      label: FIELD_LABELS.text,
      type: 'text',
      help: 'Leave blank to use the address.',
    },
    {
      name: 'to',
      label: FIELD_LABELS.to,
      type: 'text',
      mono: true,
      placeholder: 'infobot@example.com',
      help: 'One or more addresses separated by commas.',
    },
    { name: 'body', label: FIELD_LABELS.body, type: 'textarea', rows: 3 },
  ],
  examples: [
    {
      label: 'RFC 6068 section 6.1: a two-line body',
      values: { kind: 'mailto', to: 'infobot@example.com', body: 'send current-issue\nsend index' },
    },
  ],
  run(values): ToolResult {
    try {
      const spec: LinkSpec = {
        kind: str(values, 'kind', 'mailto') as LinkKind,
        text: str(values, 'text'),
        to: str(values, 'to'),
        body: str(values, 'body'),
      };
      const link = buildLink(spec);
      if (link === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: link.html, download: 'link-builder.html' },
        { kind: 'sandboxed-html', label: 'Preview (addresses replaced, nothing is loaded)', html: link.preview },
        { kind: 'code', label: 'Address only (for use outside HTML)', value: link.address },
      ];
      if (link.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: link.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof MarkupError) return { outputs: [], errors: [{ message: `${err.field}: ${err.message}` }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
