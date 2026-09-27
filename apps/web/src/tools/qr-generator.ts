import {
  meta,
  buildPayload,
  generateQr,
  matrixToSvg,
  matrixToPng,
  QrPayloadError,
  QrError,
  type PayloadKind,
} from '@fodt/qr-generator';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default defineTool({
  id: 'qr-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'kind',
      label: 'Payload',
      type: 'radio',
      default: 'text',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'url', label: 'URL' },
        { value: 'wifi', label: 'WiFi' },
        { value: 'vcard', label: 'vCard' },
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'SMS' },
      ],
    },
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      rows: 4,
      default: '',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.kind === 'text',
    },
    {
      name: 'url',
      label: 'URL',
      type: 'text',
      default: '',
      placeholder: 'https://example.com/',
      visible: (v) => v.kind === 'url',
    },
    {
      name: 'ssid',
      label: 'Network name (SSID)',
      type: 'text',
      default: '',
      visible: (v) => v.kind === 'wifi',
    },
    {
      name: 'security',
      label: 'Security',
      type: 'select',
      default: 'WPA',
      options: [
        { value: 'WPA', label: 'WPA/WPA2' },
        { value: 'WEP', label: 'WEP' },
        { value: 'nopass', label: 'None' },
      ],
      visible: (v) => v.kind === 'wifi',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      default: '',
      visible: (v) => v.kind === 'wifi' && v.security !== 'nopass',
    },
    {
      name: 'hidden',
      label: 'Hidden network',
      type: 'checkbox',
      default: false,
      visible: (v) => v.kind === 'wifi',
    },
    {
      name: 'vcardVersion',
      label: 'vCard version',
      type: 'select',
      default: '4.0',
      options: [
        { value: '3.0', label: '3.0' },
        { value: '4.0', label: '4.0' },
      ],
      visible: (v) => v.kind === 'vcard',
    },
    { name: 'givenName', label: 'Given name', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'familyName', label: 'Family name', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'org', label: 'Organisation', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'title', label: 'Title', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'phone', label: 'Phone', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'vEmail', label: 'Email', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'website', label: 'Website', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'address', label: 'Address', type: 'text', default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'note', label: 'Note', type: 'textarea', rows: 3, default: '', visible: (v) => v.kind === 'vcard' },
    { name: 'to', label: 'To', type: 'text', default: '', visible: (v) => v.kind === 'email' },
    { name: 'subject', label: 'Subject', type: 'text', default: '', visible: (v) => v.kind === 'email' },
    { name: 'body', label: 'Body', type: 'textarea', rows: 4, default: '', visible: (v) => v.kind === 'email' },
    { name: 'number', label: 'Phone number', type: 'text', default: '', visible: (v) => v.kind === 'sms' },
    { name: 'message', label: 'Message', type: 'textarea', rows: 3, default: '', visible: (v) => v.kind === 'sms' },
    {
      name: 'smsScheme',
      label: 'Format',
      type: 'select',
      default: 'sms',
      options: [
        { value: 'sms', label: 'sms: (RFC 5724)' },
        { value: 'SMSTO', label: 'SMSTO: (older convention)' },
      ],
      visible: (v) => v.kind === 'sms',
    },
    {
      name: 'level',
      label: 'Error correction',
      type: 'select',
      default: 'M',
      options: [
        { value: 'L', label: 'L (~7%)' },
        { value: 'M', label: 'M (~15%)' },
        { value: 'Q', label: 'Q (~25%)' },
        { value: 'H', label: 'H (~30%)' },
      ],
    },
    { name: 'scale', label: 'Scale (pixels per module)', type: 'number', default: 8, min: 1, max: 40, step: 1 },
    { name: 'margin', label: 'Quiet zone margin (modules)', type: 'number', default: 4, min: 0, max: 20, step: 1 },
    { name: 'dark', label: 'Dark colour', type: 'color', default: '#000000' },
    { name: 'light', label: 'Light colour', type: 'color', default: '#ffffff' },
  ],
  examples: [
    { label: 'A URL', values: { kind: 'url', url: 'https://example.com/' } },
    { label: 'A WiFi network', values: { kind: 'wifi', ssid: 'CoffeeShop', security: 'WPA', password: 'espresso99' } },
  ],
  run(values): ToolResult {
    const kind = str(values, 'kind', 'text') as PayloadKind;
    const level = str(values, 'level', 'M') as 'L' | 'M' | 'Q' | 'H';
    const scale = num(values, 'scale', 8);
    const margin = num(values, 'margin', 4);
    const dark = str(values, 'dark', '#000000');
    const light = str(values, 'light', '#ffffff');

    let fields: Record<string, unknown>;
    switch (kind) {
      case 'text':
        fields = { text: str(values, 'text') };
        break;
      case 'url':
        fields = { url: str(values, 'url') };
        break;
      case 'wifi':
        fields = {
          ssid: str(values, 'ssid'),
          security: str(values, 'security', 'WPA'),
          password: str(values, 'password'),
          hidden: bool(values, 'hidden'),
        };
        break;
      case 'vcard':
        fields = {
          vcardVersion: str(values, 'vcardVersion', '4.0'),
          givenName: str(values, 'givenName'),
          familyName: str(values, 'familyName'),
          org: str(values, 'org'),
          title: str(values, 'title'),
          phone: str(values, 'phone'),
          email: str(values, 'vEmail'),
          website: str(values, 'website'),
          address: str(values, 'address'),
          note: str(values, 'note'),
        };
        break;
      case 'email':
        fields = { to: str(values, 'to'), subject: str(values, 'subject'), body: str(values, 'body') };
        break;
      case 'sms':
        fields = {
          number: str(values, 'number'),
          message: str(values, 'message'),
          smsScheme: str(values, 'smsScheme', 'sms'),
        };
        break;
      default:
        return { outputs: [] };
    }

    const hasInput = Object.values(fields).some((v) => typeof v === 'string' && v.trim() !== '');
    if (!hasInput) return { outputs: [] };

    try {
      const { payload, warnings: payloadWarnings } = buildPayload(kind, fields);
      const qr = generateQr({ payload, level });
      const { output: svg, warnings: svgWarnings } = matrixToSvg(qr, { scale, margin, dark, light });
      const { output: png, warnings: pngWarnings } = matrixToPng(qr, { scale, margin, dark, light });

      const outputs: OutputBlock[] = [
        {
          kind: 'image',
          label: 'QR code',
          src: `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`,
          alt: 'QR code',
        },
        { kind: 'code', label: 'Encoded text', value: payload },
        { kind: 'code', label: 'SVG', language: 'xml', value: svg, download: 'qr-code.svg' },
        { kind: 'files', label: 'PNG', files: [{ name: 'qr-code.png', mime: 'image/png', content: png }] },
      ];

      return {
        outputs,
        warnings: [...new Set([...payloadWarnings, ...svgWarnings, ...pngWarnings])],
        stats: [
          ['Version', String(qr.version)],
          ['Error correction', qr.level],
          ['Mask', String(qr.mask)],
          ['Modules', `${qr.size} × ${qr.size}`],
          ['Bytes', String(qr.byteLength)],
        ],
      };
    } catch (err) {
      if (err instanceof QrPayloadError) {
        return { outputs: [], errors: [{ message: err.message, path: err.field }] };
      }
      if (err instanceof QrError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }
  },
});
