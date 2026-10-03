import {
  DerError,
  KEY_TYPES,
  KeyConverterError,
  PemError,
  checkComment,
  keyFromGeneratedRsa,
  keyOutputs,
  meta,
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

/**
 * One output block as a code block. Each download name is a fixed string written here, chosen by the kind of block and
 * never built from the key or from the comment.
 */
function codeBlock(block: KeyOutputBlock): OutputBlock {
  switch (block.id) {
    case 'pkcs8':
      return { kind: 'code', label: block.label, value: block.text, download: 'private-key.pem' };
    case 'spki':
      return { kind: 'code', label: block.label, value: block.text, download: 'public-key.pem' };
    default:
      return { kind: 'code', label: block.label, value: block.text, download: 'id_rsa.pub' };
  }
}

function outputBlocks(result: KeyOutputs): OutputBlock[] {
  const outputs: OutputBlock[] = [];
  if (result.blocks.some((block) => block.private)) {
    outputs.push({ kind: 'note', tone: 'warn', value: PRIVATE_NOTE });
  }
  for (const block of result.blocks) outputs.push(codeBlock(block));
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
      default: 'rsa-2048',
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
  examples: [{ label: 'Generate an RSA 2048-bit key pair', values: { keyType: 'rsa-2048', comment: 'example' } }],
  async run(values, ctx): Promise<ToolResult> {
    const keyType = str(values, 'keyType', 'rsa-2048');
    const comment = str(values, 'comment').trim();
    const bits = RSA_BITS.get(keyType);
    if (bits === undefined) {
      return { outputs: [], errors: [{ message: 'Choose a key type from the list.' }] };
    }
    try {
      // The comment is checked first, so a comment that will be refused never costs a key.
      checkComment(comment);
      const generated = await keyConverterInWorker({ type: 'key-converter-job', bits }, ctx);
      const key = keyFromGeneratedRsa(generated.pkcs8, generated.spki);
      const result = keyOutputs(key, { comment });
      const stats: [string, string][] = result.facts.slice(0, 2).map(([name, value]) => [name, value]);
      return { outputs: outputBlocks(result), warnings: result.warnings, stats };
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
