import {
  CertificateError,
  DerError,
  PemError,
  decodeInput,
  meta,
  type CertificateInfo,
  type ExtensionInfo,
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

const TRUST_NOTE =
  'This page reads what a certificate says. It does not check signatures, trust, revocation or host names, so a certificate shown here may be forged, revoked or not meant for the site you have in mind.';

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
  let text = key.curve === undefined ? key.type : `${key.type} ${key.curve}`;
  if (key.bits !== undefined) text += `, ${key.bits} bits`;
  else if (key.keyBytes !== undefined) text += `, ${key.keyBytes}-byte public key`;
  if (key.exponent !== undefined) text += `, exponent ${key.exponent}`;
  return text;
}

function signatureText(cert: CertificateInfo): string {
  const { name, oid, params } = cert.signatureAlgorithm;
  const base = name === oid ? oid : `${name} (OID ${oid})`;
  return params === undefined ? base : `${base}: ${params}`;
}

/** One extension as a table row: the lines it decoded to, or its hex, with the note when it could not be decoded. */
function extensionRow(extension: ExtensionInfo): string[] {
  const value = extension.value.join('; ');
  return [
    extension.name ?? '(not named here)',
    extension.oid,
    extension.critical ? 'yes' : 'no',
    extension.note === undefined ? value : `${value} (${extension.note})`,
  ];
}

function certificateBlocks(cert: CertificateInfo, position: number, total: number): OutputBlock[] {
  const blocks: OutputBlock[] = [
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
        ['Signature algorithm', signatureText(cert)],
      ],
    },
    {
      kind: 'keyvalue',
      label: 'Subject and issuer, RFC 4514',
      pairs: [
        ['Subject', cert.subject.rfc4514],
        ['Issuer', cert.issuer.rfc4514],
      ],
    },
  ];
  if (cert.sans.length > 0) {
    blocks.push({
      kind: 'table',
      label: 'Subject alternative names',
      table: { headers: ['Type', 'Value'], rows: cert.sans.map((san) => [san.type, san.value]), mono: [1] },
    });
  }
  if (cert.extensions.length > 0) {
    blocks.push({
      kind: 'table',
      label: 'Extensions',
      table: {
        headers: ['Name', 'OID', 'Critical', 'Value'],
        rows: cert.extensions.map(extensionRow),
        mono: [1, 3],
      },
    });
  }
  blocks.push(
    {
      kind: 'keyvalue',
      label: 'Fingerprints',
      pairs: [
        ['SHA-256', cert.fingerprints.sha256],
        ['SHA-1', cert.fingerprints.sha1],
        ['MD5 (legacy, not for security)', cert.fingerprints.md5],
        ['Public key pin (SHA-256, Base64)', cert.fingerprints.spkiSha256],
      ],
    },
    { kind: 'code', label: 'Public key (PEM)', value: cert.publicKey.pem },
  );
  return blocks;
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
      if (result.items.length > 0) outputs.push({ kind: 'note', tone: 'info', value: TRUST_NOTE });
      for (const skipped of result.ignored) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `${plural(skipped.count, `${skipped.label} block`)} in the paste ${skipped.count === 1 ? 'was' : 'were'} ignored and is not shown.`,
        });
      }
      result.items.forEach((cert, index) => outputs.push(...certificateBlocks(cert, index + 1, result.items.length)));
      const many = result.items.length > 1;
      const warnings = result.items
        .flatMap((cert, index) =>
          cert.warnings.map((warning) => (many ? `Certificate ${index + 1}: ${warning}` : warning)),
        )
        .concat(result.warnings);
      return { outputs, warnings, stats: [['Certificates read', String(result.items.length)]] };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
