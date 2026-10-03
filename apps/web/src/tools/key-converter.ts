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
  type Curve,
  type KeyModel,
  type KeyOutputBlock,
  type KeyOutputs,
} from '@fodt/key-converter';
import { keyConverterInWorker } from '../lib/run-key-converter-in-worker';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

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

/**
 * One output block as a code block. Each download name is a fixed string written here, chosen by the kind of block and
 * the kind of key, and never built from the key or from the comment.
 */
function codeBlock(block: KeyOutputBlock, family: KeyModel['type']): OutputBlock {
  switch (block.id) {
    case 'pkcs8':
      return { kind: 'code', label: block.label, value: block.text, download: 'private-key.pem' };
    case 'spki':
      return { kind: 'code', label: block.label, value: block.text, download: 'public-key.pem' };
    default:
      switch (family) {
        case 'ec':
          return { kind: 'code', label: block.label, value: block.text, download: 'id_ecdsa.pub' };
        case 'ed25519':
          return { kind: 'code', label: block.label, value: block.text, download: 'id_ed25519.pub' };
        default:
          return { kind: 'code', label: block.label, value: block.text, download: 'id_rsa.pub' };
      }
  }
}

function outputBlocks(result: KeyOutputs, family: KeyModel['type']): OutputBlock[] {
  const outputs: OutputBlock[] = [];
  if (result.blocks.some((block) => block.private)) {
    outputs.push({ kind: 'note', tone: 'warn', value: PRIVATE_NOTE });
  }
  for (const block of result.blocks) outputs.push(codeBlock(block, family));
  outputs.push({ kind: 'keyvalue', label: 'Fingerprints', pairs: result.fingerprints });
  outputs.push({ kind: 'keyvalue', label: 'Key', pairs: result.facts });
  return outputs;
}

export default defineTool({
  id: 'key-converter',
  // Making an RSA key is real background work, so this waits for a deliberate Run press and offers Cancel while the key
  // is being made.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'keyType',
      label: 'Key type',
      type: 'select',
      default: 'ed25519',
      options: KEY_TYPES.map((type) => ({ value: type.id, label: type.label })),
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
    { label: 'Generate an RSA 2048-bit key pair', values: { keyType: 'rsa-2048', comment: 'example' } },
    { label: 'Generate an Ed25519 key pair', values: { keyType: 'ed25519', comment: 'example' } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const keyType = str(values, 'keyType', 'ed25519');
    const comment = str(values, 'comment').trim();
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
      if (err instanceof KeyConverterError || err instanceof DerError || err instanceof PemError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error && err.message ? err.message : 'The key could not be made.' }],
      };
    }
  },
});
