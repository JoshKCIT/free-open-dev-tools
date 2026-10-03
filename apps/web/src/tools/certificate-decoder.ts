import {
  CertificateError,
  DerError,
  PemError,
  decodeInput,
  meta,
  type CertificateInfo,
} from '@fodt/certificate-decoder';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** A P-256 certificate that signs itself, made by OpenSSL 3.5.5 and valid for 3,650 days. Its key was thrown away. */
const EXAMPLE_P256 = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBijCCATCgAwIBAgIUED5RxjMVDd2fI2wufVef2SPzau0wCgYIKoZIzj0EAwIw',
  'HDEaMBgGA1UEAwwRZWMyNTYuZXhhbXBsZS5jb20wHhcNMjYxMDAzMDQzNzU5WhcN',
  'MzYwOTMwMDQzNzU5WjAcMRowGAYDVQQDDBFlYzI1Ni5leGFtcGxlLmNvbTBZMBMG',
  'ByqGSM49AgEGCCqGSM49AwEHA0IABFkWXKw1rwtfB5ostBPImPfCQvF3GWEYK3sy',
  'Nup3PAsaUarywX2rFwT8AB6gOhbLSivhYngMmI/Gd4HqZRCNHlajUDBOMBwGA1Ud',
  'EQQVMBOCEWVjMjU2LmV4YW1wbGUuY29tMB0GA1UdDgQWBBSzFLM7ld8o0Jq2UqCE',
  'tSrG7hB/2zAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQCZhrjP',
  'AzWAc4kQkyD5CN+qn0NH0a9PhNhZ+u9JRTRNYgIgBgmdaLr2sgpD6x5MnJXVPdfo',
  'DwHWJO89NhBQjG1HnC4=',
  '-----END CERTIFICATE-----',
].join('\n');

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The status against this device's clock, in words. */
function statusText(status: CertificateInfo['status']): string {
  const { state, days } = status;
  switch (state) {
    case 'expired':
      return days >= 1 ? `Expired ${plural(days, 'day')} ago` : 'Expired less than a day ago';
    case 'not-yet-valid':
      return days >= 1
        ? `Not valid yet: it starts in ${plural(days, 'day')}`
        : 'Not valid yet: it starts in less than a day';
    default:
      return days >= 1 ? `Valid for ${plural(days, 'more day')}` : 'Valid for less than a day more';
  }
}

function keyText(cert: CertificateInfo): string {
  const key = cert.publicKey;
  const kind = key.curve === undefined ? key.type : `${key.type} ${key.curve}`;
  return key.bits === undefined ? kind : `${kind}, ${key.bits} bits`;
}

function certificateBlocks(cert: CertificateInfo, position: number, total: number): OutputBlock[] {
  return [
    {
      kind: 'keyvalue',
      label: `Certificate ${position} of ${total}`,
      pairs: [
        ['Subject', cert.subject.display],
        ['Issuer', cert.issuer.display],
        ['Serial number', cert.serialHex],
        ['Version', String(cert.version)],
        ['Valid from', cert.notBefore.iso],
        ['Valid until', cert.notAfter.iso],
        ['Status', `${statusText(cert.status)} (by this device's clock)`],
        ['Public key', keyText(cert)],
        ['Signature algorithm', cert.signatureAlgorithm.name],
      ],
    },
    {
      kind: 'keyvalue',
      label: 'Fingerprints',
      pairs: [
        ['SHA-256', cert.fingerprints.sha256],
        ['SHA-1', cert.fingerprints.sha1],
      ],
    },
  ];
}

/** Maps what the package throws to a message for the visitor. Nothing else is ever shown, so no pasted text can leak. */
function failure(err: unknown): ToolResult {
  if (err instanceof CertificateError) {
    const issue: ToolIssue = { message: err.message };
    if (err.line !== undefined) issue.line = err.line;
    return { outputs: [], errors: [issue] };
  }
  if (err instanceof DerError || err instanceof PemError) return { outputs: [], errors: [{ message: err.message }] };
  return {
    outputs: [],
    errors: [{ message: 'This does not look like a certificate or request (it could not be read as DER).' }],
  };
}

export default defineTool({
  id: 'certificate-decoder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Certificate, chain or request',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: "PEM blocks, or one certificate's DER as Base64 or hex.",
    },
  ],
  examples: [{ label: 'A P-256 self-signed certificate', values: { input: EXAMPLE_P256 } }],
  run(values, ctx): ToolResult {
    const pasted = str(values, 'input');
    if (pasted.trim() === '') return { outputs: [] };
    try {
      // The clock is read here, on the page, and handed to the package, which never reads it.
      const result = decodeInput(pasted, { nowMs: Date.now() });
      const outputs: OutputBlock[] = [];
      for (const skipped of result.ignored) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `${plural(skipped.count, `${skipped.label} block`)} in the paste ${skipped.count === 1 ? 'was' : 'were'} ignored and is not shown.`,
        });
      }
      result.items.forEach((cert, index) => outputs.push(...certificateBlocks(cert, index + 1, result.items.length)));
      const warnings = result.items.flatMap((cert) => cert.warnings).concat(result.warnings);
      return { outputs, warnings, stats: [['Certificates read', String(result.items.length)]] };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
