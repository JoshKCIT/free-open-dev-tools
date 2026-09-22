import {
  meta,
  computeHmac,
  decodeBytes,
  describeKey,
  timingSafeEqual,
  ALGORITHMS,
  type HmacAlgorithm,
  type Encoding,
  type OutputFormat,
} from '@fodt/hmac';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'hmac',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'message', label: 'Message', type: 'textarea', rows: 7, placeholder: 'The exact bytes that were signed' },
    { name: 'key', label: 'Key', type: 'text', mono: true, placeholder: 'The shared secret' },
    {
      name: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      default: 'sha256',
      options: ALGORITHMS.map((a) => ({ value: a.id, label: a.label })),
    },
    {
      name: 'keyEncoding',
      label: 'Read the key as',
      type: 'radio',
      default: 'utf8',
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      help: 'Getting this wrong is the usual reason a signature does not match.',
    },
    {
      name: 'messageEncoding',
      label: 'Read the message as',
      type: 'radio',
      default: 'utf8',
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
    },
    {
      name: 'output',
      label: 'Output as',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Lowercase hex' },
        { value: 'HEX', label: 'Uppercase hex' },
        { value: 'base64', label: 'Base64' },
        { value: 'base64url', label: 'Base64url' },
      ],
    },
    {
      name: 'expected',
      label: 'Expected signature (optional)',
      type: 'text',
      mono: true,
      placeholder: 'Paste the signature you were sent to compare',
    },
  ],
  examples: [
    { label: 'RFC 4231 case 2', values: { key: 'Jefe', message: 'what do ya want for nothing?', algorithm: 'sha256' } },
    { label: 'Webhook style', values: { key: 'whsec_test', message: '{"event":"ping"}', algorithm: 'sha256' } },
  ],
  run(values): ToolResult {
    const key = str(values, 'key');
    const message = str(values, 'message');
    if (!key && !message) return { outputs: [] };

    const algorithm = str(values, 'algorithm', 'sha256') as HmacAlgorithm;
    const keyEncoding = str(values, 'keyEncoding', 'utf8') as Encoding;

    let keyBytes: Uint8Array;
    try {
      keyBytes = decodeBytes(key, keyEncoding);
    } catch (err) {
      return { outputs: [], errors: [{ message: `Key: ${err instanceof Error ? err.message : String(err)}` }] };
    }

    let digest: string;
    try {
      digest = computeHmac(key, message, {
        algorithm,
        keyEncoding,
        messageEncoding: str(values, 'messageEncoding', 'utf8') as Encoding,
        output: str(values, 'output', 'hex') as OutputFormat,
      });
    } catch (err) {
      return { outputs: [], errors: [{ message: `Message: ${err instanceof Error ? err.message : String(err)}` }] };
    }

    const keyReport = describeKey(keyBytes, algorithm);
    const info = ALGORITHMS.find((a) => a.id === algorithm)!;
    const expected = str(values, 'expected').trim();

    const outputs: OutputBlock[] = [];

    if (expected) {
      const match = timingSafeEqual(digest, expected);
      outputs.push({
        kind: 'note',
        tone: match ? 'success' : 'error',
        value: match
          ? 'The signatures match.'
          : 'The signatures do not match. Check the key encoding, and check that the message is byte-for-byte what was signed, including any trailing newline.',
      });
    }

    outputs.push({ kind: 'code', label: `${info.label} signature`, value: digest, download: 'signature.txt' });
    outputs.push({ kind: 'note', tone: 'info', value: info.note });

    if (keyReport.hashedFirst) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `Your key is ${keyReport.bytes} bytes, longer than the ${keyReport.blockSize} byte block size, so HMAC hashes it first. That is correct behaviour but it surprises people comparing against another implementation.`,
      });
    }
    if (keyReport.shorterThanDigest) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `Your key is ${keyReport.bytes} bytes, shorter than the ${info.outputBytes} byte digest. RFC 2104 recommends a key at least as long as the digest.`,
      });
    }

    return {
      outputs,
      stats: [
        ['Key', `${keyReport.bytes} bytes`],
        ['Block size', `${keyReport.blockSize} bytes`],
        ['Digest', `${info.outputBytes} bytes`],
      ],
    };
  },
});
