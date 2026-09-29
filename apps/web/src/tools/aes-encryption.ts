import {
  meta,
  encryptWithPassphrase,
  decryptWithPassphrase,
  encryptRaw,
  decryptRaw,
  generateKey,
  parseHex,
  parseBase64,
  toHex,
  toBase64,
  decodeUtf8Strict,
  AesError,
  OPENSSL_CIPHERS,
  KDFS,
  RAW_MODES,
  type OpensslCipherId,
  type OpensslKdfId,
  type RawMode,
} from '@fodt/aes-encryption';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

type KeySource = 'passphrase' | 'raw';
type Direction = 'encrypt' | 'decrypt';
type BytesEncoding = 'utf8' | 'hex';
type CipherEncoding = 'base64' | 'hex';

function decodeBytesField(text: string, encoding: BytesEncoding, what: string): Uint8Array {
  if (encoding === 'hex') return parseHex(text, what);
  return new TextEncoder().encode(text);
}

function decodeCipherField(text: string, encoding: CipherEncoding, what: string): Uint8Array {
  return encoding === 'hex' ? parseHex(text, what) : parseBase64(text, what);
}

function encodeCipherField(bytes: Uint8Array, encoding: CipherEncoding): string {
  return encoding === 'hex' ? toHex(bytes) : toBase64(bytes);
}

/** Never lets a raw error, or any part of a passphrase/key, reach the visitor (S1/S2). */
function errorMessage(err: unknown): string {
  if (err instanceof AesError) return err.message;
  return 'This could not be processed. Check the input and try again.';
}

export default defineTool({
  id: 'aes-encryption',
  // Encrypting/decrypting as the visitor types would run on every half-typed
  // passphrase or key, so this waits for a deliberate Run press, like
  // jwt-signature and bcrypt.
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'keySource',
      label: 'Key source',
      type: 'radio',
      default: 'passphrase',
      options: [
        { value: 'passphrase', label: 'Passphrase (OpenSSL enc compatible)' },
        { value: 'raw', label: 'Raw key' },
      ],
    },
    {
      name: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'encrypt',
      options: [
        { value: 'encrypt', label: 'Encrypt' },
        { value: 'decrypt', label: 'Decrypt' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 6,
      mono: true,
      help: 'Plaintext when encrypting, ciphertext when decrypting. Nothing here ever leaves your browser.',
      placeholder: 'Type or paste here.',
    },
    {
      name: 'plaintextEncoding',
      label: 'Plaintext is',
      type: 'select',
      default: 'utf8',
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex bytes' },
      ],
      help: 'Applies to the encrypt input and the decrypted output.',
    },
    {
      name: 'cipher',
      label: 'Cipher',
      type: 'select',
      default: 'aes-256-cbc',
      options: OPENSSL_CIPHERS.map((c) => ({ value: c.id, label: c.label })),
      visible: (v) => v.keySource === 'passphrase',
    },
    {
      name: 'kdf',
      label: 'Key derivation',
      type: 'select',
      default: 'pbkdf2',
      options: KDFS.map((k) => ({ value: k.id, label: k.label })),
      visible: (v) => v.keySource === 'passphrase',
    },
    {
      name: 'iterations',
      label: 'Iterations',
      type: 'number',
      default: 10000,
      min: 1,
      max: 10_000_000,
      visible: (v) => v.keySource === 'passphrase' && v.kdf === 'pbkdf2',
    },
    {
      name: 'passphrase',
      label: 'Passphrase',
      type: 'text',
      placeholder: 'Never shown in the output.',
      visible: (v) => v.keySource === 'passphrase',
    },
    {
      name: 'salt',
      label: 'Fixed salt (hex, optional)',
      type: 'text',
      mono: true,
      help: 'Exactly 16 hex digits (8 bytes). Leave blank for a fresh random salt -- only use a fixed salt for reproducible tests.',
      visible: (v) => v.keySource === 'passphrase' && v.direction === 'encrypt',
    },
    {
      name: 'aesMode',
      label: 'Mode',
      type: 'select',
      default: 'gcm',
      options: RAW_MODES.map((m) => ({ value: m.id, label: m.label })),
      visible: (v) => v.keySource === 'raw',
    },
    {
      name: 'generateKey',
      label: 'Generate a random key',
      type: 'checkbox',
      default: false,
      visible: (v) => v.keySource === 'raw' && v.direction === 'encrypt',
    },
    {
      name: 'keySize',
      label: 'Key size',
      type: 'select',
      default: '256',
      options: [
        { value: '128', label: '128 bits' },
        { value: '256', label: '256 bits' },
      ],
      visible: (v) => v.keySource === 'raw' && v.direction === 'encrypt' && bool(v, 'generateKey'),
    },
    {
      name: 'key',
      label: 'Key',
      type: 'text',
      mono: true,
      placeholder: '16 or 32 bytes, hex or Base64',
      visible: (v) => v.keySource === 'raw' && !(v.direction === 'encrypt' && bool(v, 'generateKey')),
    },
    {
      name: 'keyEncoding',
      label: 'Key is',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      visible: (v) => v.keySource === 'raw' && !(v.direction === 'encrypt' && bool(v, 'generateKey')),
    },
    {
      name: 'iv',
      label: 'IV (hex)',
      type: 'text',
      mono: true,
      help: 'Empty on encrypt means random.',
      visible: (v) => v.keySource === 'raw',
    },
    {
      name: 'ivPrepended',
      label: 'IV is prepended',
      type: 'checkbox',
      default: false,
      visible: (v) => v.keySource === 'raw' && v.direction === 'decrypt',
    },
    {
      name: 'aad',
      label: 'Additional authenticated data (UTF-8 text)',
      type: 'text',
      visible: (v) => v.keySource === 'raw' && v.aesMode === 'gcm',
    },
    {
      name: 'tag',
      label: 'Tag (optional, separate from the ciphertext)',
      type: 'text',
      mono: true,
      visible: (v) => v.keySource === 'raw' && v.aesMode === 'gcm' && v.direction === 'decrypt',
    },
    {
      name: 'cipherEncoding',
      label: 'Ciphertext is',
      type: 'select',
      default: 'base64',
      options: [
        { value: 'base64', label: 'Base64' },
        { value: 'hex', label: 'Hex' },
      ],
      visible: (v) => v.keySource === 'raw',
    },
  ],
  examples: [
    {
      label: 'Encrypt with a passphrase',
      values: {
        keySource: 'passphrase',
        direction: 'encrypt',
        input: 'Attack at dawn',
        passphrase: 'correct horse battery staple',
      },
    },
    {
      label: 'Decrypt openssl enc -pbkdf2 output',
      values: {
        keySource: 'passphrase',
        direction: 'decrypt',
        input: 'U2FsdGVkX18BAgMEBQYHCMu0XEsdjP5nVNrhGouunGngbsutjjqqTyCT5gK/eAOZeHkWD8Nz2DctvlNPqkUVxw==',
        passphrase: 'correct horse battery staple',
        iterations: 10000,
      },
    },
    {
      label: 'Encrypt with a raw AES-256-GCM key',
      values: {
        keySource: 'raw',
        direction: 'encrypt',
        input: 'hello',
        key: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
        keyEncoding: 'hex',
      },
    },
  ],
  async run(values): Promise<ToolResult> {
    const keySource = str(values, 'keySource', 'passphrase') as KeySource;
    const direction = str(values, 'direction', 'encrypt') as Direction;
    const input = str(values, 'input');
    const plaintextEncoding = str(values, 'plaintextEncoding', 'utf8') as BytesEncoding;

    if (!input.trim()) return { outputs: [] };

    try {
      if (keySource === 'passphrase') {
        return direction === 'encrypt'
          ? await runPassphraseEncrypt(values, input, plaintextEncoding)
          : await runPassphraseDecrypt(values, input, plaintextEncoding);
      }
      return direction === 'encrypt'
        ? await runRawEncrypt(values, input, plaintextEncoding)
        : await runRawDecrypt(values, input, plaintextEncoding);
    } catch (err) {
      return { outputs: [], errors: [{ message: errorMessage(err) }] };
    }
  },
});

async function runPassphraseEncrypt(
  values: Record<string, unknown>,
  input: string,
  plaintextEncoding: BytesEncoding,
): Promise<ToolResult> {
  const cipher = str(values, 'cipher', 'aes-256-cbc') as OpensslCipherId;
  const kdf = str(values, 'kdf', 'pbkdf2') as OpensslKdfId;
  const iterations = Math.round(num(values, 'iterations', 10000));
  const passphrase = str(values, 'passphrase');
  const saltText = str(values, 'salt');
  const salt = saltText.trim() ? parseHex(saltText, 'salt') : undefined;
  const plaintext = decodeBytesField(input, plaintextEncoding, 'input');

  const result = await encryptWithPassphrase(plaintext, passphrase, { cipher, kdf, iterations, salt });
  const outputs: OutputBlock[] = [
    { kind: 'code', label: 'Encrypted (OpenSSL enc format, Base64)', value: result.base64, download: 'encrypted.txt' },
    { kind: 'code', label: 'Decrypt it with OpenSSL', language: 'sh', value: result.command },
    {
      kind: 'note',
      tone: 'info',
      value:
        'Save the Base64 above as encrypted.txt and set PASS in your shell without typing the passphrase on the command line (for example `read -rs PASS; export PASS` in bash), then run the command.',
    },
  ];
  for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
  return {
    outputs,
    stats: [
      ['Cipher', cipher],
      ['Key derivation', kdf],
      ...(kdf === 'pbkdf2' ? ([['Iterations', String(iterations)]] as [string, string][]) : []),
      ['Salt (hex)', result.saltHex],
    ],
  };
}

async function runPassphraseDecrypt(
  values: Record<string, unknown>,
  input: string,
  plaintextEncoding: BytesEncoding,
): Promise<ToolResult> {
  const cipher = str(values, 'cipher', 'aes-256-cbc') as OpensslCipherId;
  const kdf = str(values, 'kdf', 'pbkdf2') as OpensslKdfId;
  const iterations = Math.round(num(values, 'iterations', 10000));
  const passphrase = str(values, 'passphrase');

  const result = await decryptWithPassphrase(input, passphrase, { cipher, kdf, iterations });
  const outputs = decryptedOutputs(result.plaintext, plaintextEncoding);
  for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
  return {
    outputs,
    stats: [
      ['Cipher', cipher],
      ['Key derivation', kdf],
      ['Salt (hex)', result.saltHex],
    ],
  };
}

async function runRawEncrypt(
  values: Record<string, unknown>,
  input: string,
  plaintextEncoding: BytesEncoding,
): Promise<ToolResult> {
  const mode = str(values, 'aesMode', 'gcm') as RawMode;
  const cipherEncoding = str(values, 'cipherEncoding', 'base64') as CipherEncoding;
  const shouldGenerate = bool(values, 'generateKey');
  const keySize = Number(str(values, 'keySize', '256')) as 128 | 256;
  const key = shouldGenerate
    ? generateKey(keySize)
    : decodeBytesField(str(values, 'key'), str(values, 'keyEncoding', 'hex') as BytesEncoding, 'key');
  const ivText = str(values, 'iv');
  const iv = ivText.trim() ? parseHex(ivText, 'IV') : undefined;
  const aadText = str(values, 'aad');
  const aad = mode === 'gcm' && aadText ? new TextEncoder().encode(aadText) : undefined;
  const plaintext = decodeBytesField(input, plaintextEncoding, 'input');

  const result = await encryptRaw(plaintext, key, { mode, iv, aad });
  const rows: [string, string, string][] = [
    ['IV', toHex(result.iv), toBase64(result.iv)],
    ['Ciphertext', toHex(result.ciphertext), toBase64(result.ciphertext)],
  ];
  if (result.tag) rows.push(['Tag', toHex(result.tag), toBase64(result.tag)]);
  rows.push(['Combined', toHex(result.combined), toBase64(result.combined)]);

  const outputs: OutputBlock[] = [
    {
      kind: 'code',
      label: 'Combined (IV ‖ ciphertext ‖ tag)',
      value: encodeCipherField(result.combined, cipherEncoding),
      download: 'ciphertext.txt',
    },
    {
      kind: 'table',
      label: 'Parts',
      table: { headers: ['Part', 'Hex', 'Base64'], rows, mono: [1, 2] },
    },
  ];
  if (shouldGenerate) {
    outputs.push({
      kind: 'keyvalue',
      label: 'Generated key',
      pairs: [
        ['Hex', toHex(key)],
        ['Base64', toBase64(key)],
      ],
    });
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value: 'Save this key now: nothing else can decrypt this data, and it is not stored anywhere.',
    });
  }
  for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
  return { outputs, stats: [['Mode', mode.toUpperCase()]] };
}

async function runRawDecrypt(
  values: Record<string, unknown>,
  input: string,
  plaintextEncoding: BytesEncoding,
): Promise<ToolResult> {
  const mode = str(values, 'aesMode', 'gcm') as RawMode;
  const cipherEncoding = str(values, 'cipherEncoding', 'base64') as CipherEncoding;
  const key = decodeBytesField(str(values, 'key'), str(values, 'keyEncoding', 'hex') as BytesEncoding, 'key');
  const ivText = str(values, 'iv');
  const iv = ivText.trim() ? parseHex(ivText, 'IV') : undefined;
  const ivPrepended = bool(values, 'ivPrepended');
  const aadText = str(values, 'aad');
  const aad = mode === 'gcm' && aadText ? new TextEncoder().encode(aadText) : undefined;
  const tagText = str(values, 'tag');
  const tag = mode === 'gcm' && tagText.trim() ? decodeCipherField(tagText, cipherEncoding, 'tag') : undefined;
  const data = decodeCipherField(input, cipherEncoding, 'ciphertext');

  const result = await decryptRaw(data, key, { mode, iv, ivPrepended, aad, tag });
  const outputs = decryptedOutputs(result.plaintext, plaintextEncoding);
  for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
  return { outputs, stats: [['Mode', mode.toUpperCase()]] };
}

/** Shared by both decrypt paths: text when requested and valid UTF-8, otherwise hex plus a download (PD-06). */
function decryptedOutputs(plaintext: Uint8Array, plaintextEncoding: BytesEncoding): OutputBlock[] {
  if (plaintextEncoding === 'hex') {
    return [{ kind: 'code', label: 'Decrypted (hex)', value: toHex(plaintext) }];
  }
  const text = decodeUtf8Strict(plaintext);
  if (text !== null) {
    return [{ kind: 'text', label: 'Decrypted', value: text }];
  }
  return [
    { kind: 'code', label: 'Decrypted (hex)', value: toHex(plaintext) },
    {
      kind: 'files',
      label: 'Decrypted bytes',
      files: [{ name: 'decrypted.bin', mime: 'application/octet-stream', content: plaintext }],
    },
    {
      kind: 'note',
      tone: 'warn',
      value:
        'The decrypted bytes are not valid UTF-8 text, so they are shown as hex. This often means the wrong passphrase or key was used.',
    },
  ];
}
