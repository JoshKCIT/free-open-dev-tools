import {
  CertificateError,
  DerError,
  PemError,
  decodeInput,
  meta,
  type CertificateInfo,
  type ChainResult,
  type ChainRole,
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

const ORDER_NOTE =
  "The order is found by matching each issuer name with another certificate's subject name, and by key identifiers when two certificates share a name. It is not a verified chain: no signature, date or trust is checked.";

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

/** What a certificate is, in the words of the order list and of its heading. */
const ROLE_WORDS: Record<ChainRole | 'duplicate', string> = {
  leaf: 'leaf',
  intermediate: 'intermediate',
  root: 'self-issued root',
  alone: 'not in a chain',
  duplicate: 'repeat of an earlier certificate',
};

function certificateBlocks(
  cert: CertificateInfo,
  position: number,
  total: number,
  role: ChainRole | 'duplicate' | undefined,
): OutputBlock[] {
  const blocks: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: `Certificate ${position} of ${total}${role === undefined ? '' : ` (${ROLE_WORDS[role]})`}`,
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

/** The issuing order as one numbered list per chain, with a note for every reason an order stopped early. */
function orderBlocks(items: CertificateInfo[], chains: ChainResult[], duplicates: number[]): OutputBlock[] {
  const blocks: OutputBlock[] = [{ kind: 'note', tone: 'info', value: ORDER_NOTE }];
  const label = (index: number): string => items[index]!.subject.commonName ?? items[index]!.subject.display;
  chains.forEach((chain, at) => {
    blocks.push({
      kind: 'list',
      label: chains.length === 1 ? 'Issuing order' : `Issuing order, chain ${at + 1} of ${chains.length}`,
      ordered: true,
      items: chain.order.map(
        (index, position) =>
          `${ROLE_WORDS[chain.roles[position]!]}, certificate ${index + 1} in the paste: ${label(index)}`,
      ),
    });
    const last = chain.order[chain.order.length - 1]!;
    if (chain.stopReason === 'issuer-not-in-paste') {
      const issuer = items[last]!.issuer;
      blocks.push({
        kind: 'note',
        tone: 'info',
        value: `The issuer of certificate ${last + 1} (${issuer.commonName ?? issuer.display}) is not in the paste, so this order stops there.`,
      });
    } else if (chain.stopReason === 'cycle') {
      blocks.push({
        kind: 'note',
        tone: 'warn',
        value: `Certificate ${last + 1} names an issuer that is already in this order, so the certificates name each other and the order stops there.`,
      });
    } else if (chain.stopReason === 'cap') {
      blocks.push({
        kind: 'note',
        tone: 'warn',
        value: `This order stops after ${chain.order.length} certificates, the most one order shows.`,
      });
    }
  });
  if (chains.length > 1) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `The paste holds ${chains.length} chains that do not continue into each other, listed above in the order their first certificate comes in the paste.`,
    });
  }
  if (duplicates.length > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${duplicates.map((index) => `Certificate ${index + 1}`).join(', ')} ${duplicates.length === 1 ? 'is a repeat' : 'are repeats'} of an earlier certificate in the paste and ${duplicates.length === 1 ? 'is' : 'are'} left out of the order.`,
    });
  }
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
      const many = result.items.length > 1;
      // A certificate that is in more than one chain takes the role it has in the first.
      const roles = new Map<number, ChainRole | 'duplicate'>();
      for (const index of result.duplicates) roles.set(index, 'duplicate');
      for (const chain of result.chains) {
        chain.order.forEach((index, position) => {
          if (!roles.has(index)) roles.set(index, chain.roles[position]!);
        });
      }
      if (many) outputs.push(...orderBlocks(result.items, result.chains, result.duplicates));
      result.items.forEach((cert, index) =>
        outputs.push(...certificateBlocks(cert, index + 1, result.items.length, many ? roles.get(index) : undefined)),
      );
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
