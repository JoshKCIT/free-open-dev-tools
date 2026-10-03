import {
  CertificateError,
  DerError,
  PemError,
  checkFileSize,
  decodeInput,
  meta,
  type CertificateInfo,
  type ChainResult,
  type ChainRole,
  type CsrInfo,
  type ExtensionInfo,
} from '@fodt/certificate-decoder';
import { defineTool, files, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

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

const REQUEST_NOTE =
  "This page reads what a request asks for. It does not check the request's signature, and a request says nothing about whether any authority has issued, or would issue, a certificate for it.";

const ORDER_NOTE =
  "The order is found by matching each issuer name with another certificate's subject name, and by key identifiers when two certificates share a name. It is not a verified chain: no signature, date or trust is checked.";

/** Where the text came from, so a sentence says `paste` or `file`. */
type Where = 'paste' | 'file';

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

function keyText(item: CertificateInfo | CsrInfo): string {
  const key = item.publicKey;
  let text = key.curve === undefined ? key.type : `${key.type} ${key.curve}`;
  if (key.bits !== undefined) text += `, ${key.bits} bits`;
  else if (key.keyBytes !== undefined) text += `, ${key.keyBytes}-byte public key`;
  if (key.exponent !== undefined) text += `, exponent ${key.exponent}`;
  return text;
}

function signatureText(item: CertificateInfo | CsrInfo): string {
  const { name, oid, params } = item.signatureAlgorithm;
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

/** The alternative names and extensions tables, shared by certificates and requests. */
function nameAndExtensionBlocks(item: CertificateInfo | CsrInfo, extensionsLabel: string): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  if (item.sans.length > 0) {
    blocks.push({
      kind: 'table',
      label: 'Subject alternative names',
      table: { headers: ['Type', 'Value'], rows: item.sans.map((san) => [san.type, san.value]), mono: [1] },
    });
  }
  if (item.extensions.length > 0) {
    blocks.push({
      kind: 'table',
      label: extensionsLabel,
      table: {
        headers: ['Name', 'OID', 'Critical', 'Value'],
        rows: item.extensions.map(extensionRow),
        mono: [1, 3],
      },
    });
  }
  return blocks;
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
    ...nameAndExtensionBlocks(cert, 'Extensions'),
  ];
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

/** A certification request: who it is for, the key, how it was signed, what it asks for and the attributes it carries. */
function requestBlocks(request: CsrInfo, position: number, total: number): OutputBlock[] {
  const blocks: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: `Request ${position} of ${total}`,
      pairs: [
        ['Subject', request.subject.display],
        ['Version', String(request.version)],
        ['Public key', keyText(request)],
        ['Signature algorithm', signatureText(request)],
        ['SHA-256 of the request DER', request.requestSha256],
      ],
    },
    { kind: 'keyvalue', label: 'Subject, RFC 4514', pairs: [['Subject', request.subject.rfc4514]] },
    ...nameAndExtensionBlocks(request, 'Requested extensions'),
  ];
  if (request.attributes.length > 0) {
    blocks.push({
      kind: 'table',
      label: 'Attributes',
      table: {
        headers: ['Name', 'OID', 'Value'],
        rows: request.attributes.map((attribute) => [attribute.name, attribute.oid, attribute.value.join('; ')]),
        mono: [1],
      },
    });
  }
  blocks.push({ kind: 'code', label: 'Public key (PEM)', value: request.publicKey.pem });
  return blocks;
}

/** The issuing order as one numbered list per chain, with a note for every reason an order stopped early. */
function orderBlocks(
  items: (CertificateInfo | CsrInfo)[],
  chains: ChainResult[],
  duplicates: number[],
  where: Where,
): OutputBlock[] {
  const blocks: OutputBlock[] = [{ kind: 'note', tone: 'info', value: ORDER_NOTE }];
  const label = (index: number): string => items[index]!.subject.commonName ?? items[index]!.subject.display;
  chains.forEach((chain, at) => {
    blocks.push({
      kind: 'list',
      label: chains.length === 1 ? 'Issuing order' : `Issuing order, chain ${at + 1} of ${chains.length}`,
      ordered: true,
      items: chain.order.map(
        (index, position) =>
          `${ROLE_WORDS[chain.roles[position]!]}, certificate ${index + 1} in the ${where}: ${label(index)}`,
      ),
    });
    const last = chain.order[chain.order.length - 1]!;
    const lastItem = items[last];
    if (chain.stopReason === 'issuer-not-in-paste' && lastItem?.kind === 'certificate') {
      const issuer = lastItem.issuer;
      blocks.push({
        kind: 'note',
        tone: 'info',
        value: `The issuer of certificate ${last + 1} (${issuer.commonName ?? issuer.display}) is not in the ${where}, so this order stops there.`,
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
      value: `The ${where} holds ${chains.length} chains that do not continue into each other, listed above in the order their first certificate comes in the ${where}.`,
    });
  }
  if (duplicates.length > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${duplicates.map((index) => `Certificate ${index + 1}`).join(', ')} ${duplicates.length === 1 ? 'is a repeat' : 'are repeats'} of an earlier certificate in the ${where} and ${duplicates.length === 1 ? 'is' : 'are'} left out of the order.`,
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
      name: 'file',
      label: 'Open a certificate or request file',
      type: 'file',
      accept: '.pem,.crt,.cer,.der,.csr,.req,application/pkix-cert,application/x-x509-ca-cert,application/pkcs10',
    },
    {
      name: 'input',
      label: 'Certificate, chain or request',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Used only when no file is attached above.',
    },
  ],
  examples: [{ label: 'A P-256 self-signed certificate', values: { input: EXAMPLE_P256 } }],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    const pasted = str(values, 'input');
    // With a file attached the paste is not read at all.
    if (picked.length === 0 && pasted.trim() === '') return { outputs: [] };
    const where: Where = picked.length > 0 ? 'file' : 'paste';
    try {
      let input: string | Uint8Array = pasted;
      if (picked.length > 0) {
        const file = picked[0]!;
        // The size is checked from the file's own record of it before any of its bytes are read, and the file is read once.
        checkFileSize(file.size);
        if (file.size === 0) throw new CertificateError('This file is empty.');
        input = new Uint8Array(await file.arrayBuffer());
        // An edit made while the file was being read has started a newer run; this one leaves nothing behind.
        if (ctx.signal.aborted) return { outputs: [] };
      }
      // The clock is read here, on the page, and handed to the package, which never reads it.
      const result = decodeInput(input, { nowMs: Date.now() });
      const outputs: OutputBlock[] = [];
      const certificates = result.items.filter((item) => item.kind === 'certificate').length;
      const requests = result.items.length - certificates;
      if (certificates > 0) outputs.push({ kind: 'note', tone: 'info', value: TRUST_NOTE });
      if (requests > 0) outputs.push({ kind: 'note', tone: 'info', value: REQUEST_NOTE });
      for (const skipped of result.ignored) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `${plural(skipped.count, `${skipped.label} block`)} in the ${where} ${skipped.count === 1 ? 'was' : 'were'} ignored and is not shown.`,
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
      if (certificates > 1) outputs.push(...orderBlocks(result.items, result.chains, result.duplicates, where));
      result.items.forEach((item, index) => {
        const position = index + 1;
        if (item.kind === 'request') outputs.push(...requestBlocks(item, position, result.items.length));
        else
          outputs.push(
            ...certificateBlocks(item, position, result.items.length, certificates > 1 ? roles.get(index) : undefined),
          );
      });
      const warnings = result.items
        .flatMap((item, index) =>
          item.warnings.map((warning) =>
            many ? `${item.kind === 'request' ? 'Request' : 'Certificate'} ${index + 1}: ${warning}` : warning,
          ),
        )
        .concat(result.warnings);
      const stats: [string, string][] = [];
      if (certificates > 0) stats.push(['Certificates read', String(certificates)]);
      if (requests > 0) stats.push(['Requests read', String(requests)]);
      return { outputs, warnings, stats };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
