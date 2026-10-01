import {
  meta,
  buildLink,
  MarkupError,
  LINK_KINDS,
  FIELD_LABELS,
  type LinkKind,
  type LinkSpec,
} from '@fodt/link-builder';
import { defineTool, str, type Field, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const KIND_LABELS: Record<LinkKind, string> = {
  mailto: 'Email (mailto)',
  tel: 'Phone call (tel)',
  sms: 'Text message (sms)',
};

/** Whether the chosen link type uses a field, so a value typed before switching type never reaches a run. */
function whenKind(...kinds: LinkKind[]): (values: Values) => boolean {
  return (values) => kinds.includes(str(values, 'kind', 'mailto') as LinkKind);
}

/** The fields each link type reads, in the order the page shows them. */
const READS: Record<LinkKind, Exclude<keyof LinkSpec, 'kind'>[]> = {
  mailto: ['text', 'to', 'cc', 'bcc', 'subject', 'body'],
  tel: ['text', 'phone', 'ext', 'phoneContext'],
  sms: ['text', 'recipients', 'smsBody'],
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
      help: 'Leave blank to use the address, number or recipients.',
    },
    {
      name: 'to',
      label: FIELD_LABELS.to,
      type: 'text',
      mono: true,
      placeholder: 'infobot@example.com',
      help: 'One or more addresses separated by commas.',
      visible: whenKind('mailto'),
    },
    {
      name: 'cc',
      label: FIELD_LABELS.cc,
      type: 'text',
      mono: true,
      help: 'Addresses separated by commas.',
      visible: whenKind('mailto'),
    },
    {
      name: 'bcc',
      label: FIELD_LABELS.bcc,
      type: 'text',
      mono: true,
      help: 'Addresses separated by commas. They are written in the link, so anyone who reads the page source can see them (RFC 6068 section 7).',
      visible: whenKind('mailto'),
    },
    { name: 'subject', label: FIELD_LABELS.subject, type: 'text', visible: whenKind('mailto') },
    {
      name: 'body',
      label: FIELD_LABELS.body,
      type: 'textarea',
      rows: 3,
      help: 'Line breaks are written as an encoded carriage return and line feed.',
      visible: whenKind('mailto'),
    },
    {
      name: 'phone',
      label: FIELD_LABELS.phone,
      type: 'text',
      mono: true,
      placeholder: '+1-201-555-0123',
      help: 'Start with + for a global number. Spaces become hyphens.',
      visible: whenKind('tel'),
    },
    {
      name: 'ext',
      label: FIELD_LABELS.ext,
      type: 'text',
      mono: true,
      help: 'Optional: digits, with - . ( ) allowed.',
      visible: whenKind('tel'),
    },
    {
      name: 'phoneContext',
      label: FIELD_LABELS.phoneContext,
      type: 'text',
      mono: true,
      help: 'Needed for a local number: a domain such as example.com or a global prefix such as +1-914-555',
      visible: whenKind('tel'),
    },
    {
      name: 'recipients',
      label: FIELD_LABELS.recipients,
      type: 'textarea',
      rows: 3,
      mono: true,
      placeholder: '+15105550101',
      help: 'One number per line or separated by commas. A local number is followed by ;phone-context=example.com.',
      visible: whenKind('sms'),
    },
    {
      name: 'smsBody',
      label: FIELD_LABELS.smsBody,
      type: 'textarea',
      rows: 3,
      help: 'Everything except letters, digits and - . _ ~ is percent-encoded; line breaks become an encoded line feed.',
      visible: whenKind('sms'),
    },
  ] satisfies Field[],
  examples: [
    {
      label: 'RFC 6068 section 6.1: a two-line body',
      values: { kind: 'mailto', to: 'infobot@example.com', body: 'send current-issue\nsend index' },
    },
    {
      label: 'RFC 3966 section 6: a local number with a phone-context',
      values: { kind: 'tel', phone: '7042', phoneContext: 'example.com' },
    },
    {
      label: 'RFC 5724 section 2.5: two recipients and a body',
      values: { kind: 'sms', recipients: '+15105550101\n+15105550102', smsBody: 'hello there' },
    },
  ],
  run(values): ToolResult {
    try {
      const kind = str(values, 'kind', 'mailto') as LinkKind;
      const spec: LinkSpec = { kind };
      for (const name of READS[kind]) spec[name] = str(values, name);
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
