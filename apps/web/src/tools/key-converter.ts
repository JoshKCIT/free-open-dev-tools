import {
  DerError,
  KEY_TYPES,
  KeyConverterError,
  PemError,
  checkComment,
  generateEc,
  generateEd25519,
  keyFromGeneratedRsa,
  keyOutputs,
  meta,
  readKeyInput,
  type Curve,
  type KeyModel,
  type KeyOutputBlock,
  type KeyOutputs,
} from '@fodt/key-converter';
import {
  KEY_CONVERTER_TIME_LIMIT_MS,
  KEY_CONVERTER_NOT_STARTED_MESSAGE,
  KEY_CONVERTER_START_LIMIT_MESSAGE,
  KEY_CONVERTER_STOPPED_MESSAGE,
  KEY_CONVERTER_TIME_LIMIT_MESSAGE,
  KeyConverterRunError,
  keyConverterInWorker,
} from '../lib/run-key-converter-in-worker';
import { endWithOneLineFeed } from '../lib/download-mime';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

const PRIVATE_NOTE =
  'The private key below is shown in plain text so you can copy it. Treat every private output as a secret, and close this page when you are done. Nothing here is sent, stored or logged.';

/** The RSA sizes by menu entry. The page reads the size from this table, never from the entry's text. */
const RSA_BITS = new Map<string, 2048 | 3072 | 4096>([
  ['rsa-2048', 2048],
  ['rsa-3072', 3072],
  ['rsa-4096', 4096],
]);

/** The curves by menu entry, read from this table and never from the entry's text. */
const EC_CURVES = new Map<string, Curve>([
  ['ecdsa-p256', 'P-256'],
  ['ecdsa-p384', 'P-384'],
  ['ecdsa-p521', 'P-521'],
]);

/** The part of a code block that does not depend on the download: its label, its text and, for JWK, its language. */
function codeBase(block: KeyOutputBlock): { kind: 'code'; label: string; value: string; language?: string } {
  return block.language === undefined
    ? { kind: 'code', label: block.label, value: block.text }
    : { kind: 'code', label: block.label, value: block.text, language: block.language };
}

/**
 * One output block with its download. Each download name is a fixed string written here, chosen by the kind of block and
 * the kind of key, and never built from the key, the comment or any pasted text.
 */
function codeBlock(block: KeyOutputBlock, family: KeyModel['type']): OutputBlock {
  const base = codeBase(block);
  switch (block.id) {
    case 'pkcs8':
      return { ...base, download: 'private-key.pem' };
    case 'spki':
      return { ...base, download: 'public-key.pem' };
    case 'pkcs1-private':
      return { ...base, download: 'rsa-private-key.pem' };
    case 'pkcs1-public':
      return { ...base, download: 'rsa-public-key.pem' };
    case 'sec1':
      return { ...base, download: 'ec-private-key.pem' };
    case 'jwk-private':
      return { ...base, download: 'private-key.jwk' };
    case 'jwk-public':
      return { ...base, download: 'public-key.jwk' };
    // An OpenSSH file is read line by line by ssh, so each one ends with exactly one line feed.
    case 'ssh-private': {
      const file = { ...base, value: endWithOneLineFeed(base.value) };
      switch (family) {
        case 'ec':
          return { ...file, download: 'id_ecdsa' };
        case 'ed25519':
          return { ...file, download: 'id_ed25519' };
        default:
          return { ...file, download: 'id_rsa' };
      }
    }
    case 'ssh-public': {
      const file = { ...base, value: endWithOneLineFeed(base.value) };
      switch (family) {
        case 'ec':
          return { ...file, download: 'id_ecdsa.pub' };
        case 'ed25519':
          return { ...file, download: 'id_ed25519.pub' };
        default:
          return { ...file, download: 'id_rsa.pub' };
      }
    }
    default:
      return { ...base, download: 'public-key-rfc4716.pub' };
  }
}

function outputBlocks(result: KeyOutputs, family: KeyModel['type'], source?: string): OutputBlock[] {
  const outputs: OutputBlock[] = [];
  if (result.blocks.some((block) => block.private)) {
    outputs.push({ kind: 'note', tone: 'warn', value: PRIVATE_NOTE });
  } else if (source !== undefined) {
    outputs.push({ kind: 'note', tone: 'info', value: 'This is a public key; there is no private key to show.' });
  }
  for (const block of result.blocks) {
    const shown = codeBlock(block, family);
    outputs.push(shown);
    // The reminder sits right after the private key file it is about, and only when that file is shown. The file name in
    // it is the block's own fixed download name.
    if (block.id === 'ssh-private' && shown.kind === 'code' && shown.download !== undefined) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `On macOS and Linux, run chmod 600 ${shown.download} before ssh will use this private key.`,
      });
    }
  }
  outputs.push({ kind: 'keyvalue', label: 'Fingerprints', pairs: result.fingerprints });
  outputs.push({
    kind: 'keyvalue',
    label: 'Key',
    pairs: source === undefined ? result.facts : [['Read as', source], ...result.facts],
  });
  return outputs;
}

/** The line and column of a character position in the pasted text, for an error that has one. */
function lineAndColumn(text: string, position: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** Maps what the package throws to a message for the visitor. Nothing else is ever shown, so no key text can leak. */
function failure(err: unknown, pasted?: string): ToolResult {
  if (err instanceof KeyConverterError || err instanceof PemError) {
    const issue: ToolIssue = { message: err.message };
    if (pasted !== undefined && err.position !== undefined) Object.assign(issue, lineAndColumn(pasted, err.position));
    return { outputs: [], errors: [issue] };
  }
  if (err instanceof DerError) return { outputs: [], errors: [{ message: err.message }] };
  return { outputs: [], errors: [{ message: 'The key could not be made or read.' }] };
}

/** The sentences of the background task that are written by this page and are safe to show as they are. */
const FIXED_WORKER_MESSAGES: ReadonlySet<string> = new Set([
  KEY_CONVERTER_TIME_LIMIT_MESSAGE,
  KEY_CONVERTER_START_LIMIT_MESSAGE,
  KEY_CONVERTER_NOT_STARTED_MESSAGE,
  KEY_CONVERTER_STOPPED_MESSAGE,
]);

/**
 * The message for an error while a key is made. The package's own errors and the background task's own errors carry fixed
 * sentences; any other error (one raised by the browser's engine, an extension or a bug) gets one fixed sentence, because
 * its own text is not under this page's control.
 */
function generateFailure(err: unknown): ToolResult {
  if (err instanceof KeyConverterError || err instanceof DerError || err instanceof PemError) return failure(err);
  if (err instanceof KeyConverterRunError || (err instanceof Error && FIXED_WORKER_MESSAGES.has(err.message))) {
    return { outputs: [], errors: [{ message: err.message }] };
  }
  return { outputs: [], errors: [{ message: 'The key could not be made.' }] };
}

export default defineTool({
  id: 'key-converter',
  // Making an RSA key is real background work, so this waits for a deliberate Run press and offers Cancel while the key
  // is being made.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: KEY_CONVERTER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'generate',
      options: [
        { value: 'generate', label: 'Generate a new key pair' },
        { value: 'convert', label: 'Convert a key I paste' },
      ],
    },
    {
      name: 'keyType',
      label: 'Key type',
      type: 'select',
      default: 'ed25519',
      options: KEY_TYPES.map((type) => ({ value: type.id, label: type.label })),
      visible: (values) => values.mode !== 'convert',
    },
    {
      name: 'input',
      label: 'Key',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A PKCS#8, SubjectPublicKeyInfo, PKCS#1, SEC1, OpenSSH or RFC 4716 key in PEM or OpenSSH form, or a JWK. A key protected by a passphrase is not read.',
      visible: (values) => values.mode === 'convert',
    },
    {
      name: 'comment',
      label: 'Comment',
      type: 'text',
      placeholder: 'for example you@laptop',
      help: 'Optional. It is written after the public key on the OpenSSH line, and it is not secret.',
    },
  ],
  examples: [
    {
      label: 'Convert the RFC 8037 example Ed25519 key (JWK)',
      values: {
        mode: 'convert',
        input:
          '{"kty":"OKP","crv":"Ed25519","d":"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}',
        comment: 'example',
      },
    },
    { label: 'Generate an Ed25519 key pair', values: { mode: 'generate', keyType: 'ed25519', comment: 'example' } },
    {
      label: 'Generate an RSA 2048-bit key pair',
      values: { mode: 'generate', keyType: 'rsa-2048', comment: 'example' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const mode = str(values, 'mode', 'generate');
    const comment = str(values, 'comment').trim();

    if (mode === 'convert') {
      // Only the pasted key is read in this mode; the key type menu keeps its value but is not looked at.
      const pasted = str(values, 'input');
      if (pasted.trim() === '') return { outputs: [] };
      try {
        // The comment is checked first, so a comment that will be refused never costs a parse.
        checkComment(comment);
        const read = readKeyInput(pasted);
        const result = keyOutputs(read.key, { comment: comment !== '' ? comment : (read.comment ?? '') });
        const warnings = Array.from(new Set([...read.warnings, ...result.warnings]));
        const stats: [string, string][] = [['Read as', read.source]];
        for (const [name, value] of result.facts)
          if (name === 'Key type' || name === 'Size in bits') stats.push([name, value]);
        return { outputs: outputBlocks(result, read.key.type, read.source), warnings, stats };
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        return failure(err, pasted);
      }
    }

    const keyType = str(values, 'keyType', 'ed25519');
    const rsaBits = RSA_BITS.get(keyType);
    const curve = EC_CURVES.get(keyType);
    if (rsaBits === undefined && curve === undefined && keyType !== 'ed25519') {
      return { outputs: [], errors: [{ message: 'Choose a key type from the list.' }] };
    }
    try {
      // The comment is checked first, so a comment that will be refused never costs a key.
      checkComment(comment);
      let key: KeyModel;
      if (rsaBits !== undefined) {
        // Only RSA runs in the background worker: it can freeze a page for seconds. The other kinds take milliseconds.
        const generated = await keyConverterInWorker({ type: 'key-converter-job', bits: rsaBits }, ctx);
        key = keyFromGeneratedRsa(generated.pkcs8, generated.spki);
      } else if (curve !== undefined) {
        key = await generateEc(curve);
      } else {
        key = generateEd25519();
      }
      const result = keyOutputs(key, { comment });
      const stats: [string, string][] = result.facts
        .filter(([name]) => name === 'Key type' || name === 'Size in bits')
        .map(([name, value]) => [name, value]);
      return { outputs: outputBlocks(result, key.type), warnings: result.warnings, stats };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return generateFailure(err);
    }
  },
});
