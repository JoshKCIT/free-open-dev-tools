import {
  meta,
  buildLink,
  MarkupError,
  LINK_KINDS,
  LINK_TYPES_ON_A,
  TARGET_KEYWORDS,
  FIELD_LABELS,
  type LinkKind,
  type LinkSpec,
} from '@fodt/link-builder';
import { defineTool, bool, str, type Field, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const KIND_LABELS: Record<LinkKind, string> = {
  web: 'Web address',
  mailto: 'Email (mailto)',
  tel: 'Phone call (tel)',
  sms: 'Text message (sms)',
};

/** The five link types that have a checkbox each, in the order their values are written. */
const REL_BOXES = [
  { name: 'relNoopener', value: 'noopener', label: 'rel noopener' },
  { name: 'relNoreferrer', value: 'noreferrer', label: 'rel noreferrer' },
  { name: 'relNofollow', value: 'nofollow', label: 'rel nofollow' },
  { name: 'relSponsored', value: 'sponsored', label: 'rel sponsored (IANA registered)' },
  { name: 'relUgc', value: 'ugc', label: 'rel ugc (IANA registered)' },
] as const;

/** The other link types the standard allows on a link, copied into the package from its link type table. */
const OTHER_REL = LINK_TYPES_ON_A.map((t) => t.value).filter((v) => !REL_BOXES.some((b) => b.value === v));

/** Whether the chosen link type uses a field, so a value typed before switching type never reaches a run. */
function whenKind(...kinds: LinkKind[]): (values: Values) => boolean {
  return (values) => kinds.includes(str(values, 'kind', 'web') as LinkKind);
}

/** The fields each email, phone and text message link reads, in the order the page shows them. */
const READS = {
  mailto: ['text', 'to', 'cc', 'bcc', 'subject', 'body'],
  tel: ['text', 'phone', 'ext', 'phoneContext'],
  sms: ['text', 'recipients', 'smsBody'],
} as const;

/** Splits the Other rel values field on ASCII whitespace; the package checks each value. */
function otherRelTokens(value: string): string[] {
  return value.split(/[ \t\r\n]+/).filter((token) => token !== '');
}

export default defineTool({
  id: 'link-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'kind',
      label: FIELD_LABELS.kind,
      type: 'select',
      default: 'web',
      options: LINK_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
    },
    {
      name: 'text',
      label: FIELD_LABELS.text,
      type: 'text',
      help: 'Leave blank to use the address, number or recipients.',
    },
    {
      name: 'href',
      label: FIELD_LABELS.href,
      type: 'text',
      mono: true,
      placeholder: 'https://example.org/',
      help: 'Written exactly as you type it.',
      visible: whenKind('web'),
    },
    ...REL_BOXES.map((box): Field => ({
      name: box.name,
      label: box.label,
      type: 'checkbox',
      default: false,
      visible: whenKind('web'),
    })),
    {
      name: 'relOther',
      label: 'Other rel values',
      type: 'text',
      mono: true,
      placeholder: 'license',
      help: `Space-separated, in the order you want them after the ticked ones. The other link types the standard allows here: ${OTHER_REL.join(', ')}.`,
      visible: whenKind('web'),
    },
    {
      name: 'target',
      label: FIELD_LABELS.target,
      type: 'select',
      default: '',
      options: [{ value: '', label: '(none)' }, ...TARGET_KEYWORDS.map((k) => ({ value: k, label: k }))],
      visible: whenKind('web'),
    },
    {
      name: 'download',
      label: 'Download instead of opening',
      type: 'checkbox',
      default: false,
      visible: whenKind('web'),
    },
    {
      name: 'downloadName',
      label: FIELD_LABELS.downloadName,
      type: 'text',
      mono: true,
      placeholder: 'report.pdf',
      help: 'Optional. Leave blank to write the download attribute with no file name.',
      visible: (values) => whenKind('web')(values) && bool(values, 'download'),
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
  ],
  examples: [
    {
      label: 'WHATWG 4.6.8: a link to a licence, with rel license and nothing else added',
      values: { kind: 'web', href: 'https://example.org/licence', text: 'Licence', relOther: 'license' },
    },
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
      const typedKind = str(values, 'kind', 'web');
      if (!(LINK_KINDS as readonly string[]).includes(typedKind)) {
        return {
          outputs: [],
          errors: [
            {
              message: `${FIELD_LABELS.kind}: "${typedKind}" is not one of the link types offered: ${LINK_KINDS.join(', ')}`,
            },
          ],
        };
      }
      const kind = typedKind as LinkKind;
      const spec: LinkSpec = { kind };
      if (kind === 'web') {
        spec.text = str(values, 'text');
        spec.href = str(values, 'href');
        // The ticked boxes in their fixed order, then the typed values; the package refuses anything it does not know.
        spec.rel = [
          ...REL_BOXES.filter((box) => bool(values, box.name)).map((box) => box.value as string),
          ...otherRelTokens(str(values, 'relOther')),
        ];
        spec.target = str(values, 'target');
        if (bool(values, 'download')) {
          const name = str(values, 'downloadName');
          spec.download = name.trim() === '' ? true : name;
        }
      } else {
        for (const name of READS[kind]) spec[name] = str(values, name);
      }
      const link = buildLink(spec);
      if (link === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: link.html, download: 'link-builder.html' },
        {
          kind: 'sandboxed-html',
          label: 'Preview (addresses replaced, nothing is loaded)',
          copy: false,
          html: link.preview,
        },
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
