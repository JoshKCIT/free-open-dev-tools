import {
  meta,
  sign,
  verify,
  ALGORITHMS,
  JwtSignatureError,
  importSigningKey,
  importVerifyingKey,
  JwtKeyError,
  type JwsAlgorithm,
  type KeyInput,
  type Encoding,
} from '@fodt/jwt-signature';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

type KeyFormatOption = 'secret' | 'pem-private' | 'pem-public' | 'jwk';

function algorithmInfo(algorithm: JwsAlgorithm) {
  return ALGORITHMS.find((a) => a.id === algorithm)!;
}

/** Builds the key input from whichever field is showing, based on the visitor's chosen format. */
function keyInputFrom(values: Record<string, unknown>): KeyInput {
  const format = str(values, 'keyFormat', 'secret') as KeyFormatOption;
  if (format === 'secret') {
    return {
      format: 'secret',
      encoding: str(values, 'secretEncoding', 'utf8') as Encoding,
      value: str(values, 'secret'),
    };
  }
  if (format === 'pem-private') {
    return { format: 'pem-private', pem: str(values, 'pemPrivateKey') };
  }
  if (format === 'pem-public') {
    return { format: 'pem-public', pem: str(values, 'pemPublicKey') };
  }
  return { format: 'jwk', json: str(values, 'jwkKey') };
}

export default defineTool({
  id: 'jwt-signature',
  // Signing as the visitor types would import a private key on every
  // keystroke of an incomplete paste, filling the panel with failures about
  // a key that simply is not finished yet. Waiting for Run means the first
  // thing the visitor sees is the real answer.
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'sign',
      options: [
        { value: 'sign', label: 'Sign' },
        { value: 'verify', label: 'Verify' },
      ],
    },
    {
      name: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      default: 'HS256',
      options: ALGORITHMS.map((a) => ({ value: a.id, label: a.label })),
      help: 'The unsecured "none" algorithm is refused by this tool and is never offered here.',
    },
    {
      name: 'header',
      label: 'Header',
      type: 'textarea',
      rows: 3,
      mono: true,
      default: '{"typ":"JWT","alg":"HS256"}',
      help: 'The exact text signed, byte for byte. Keep it consistent with the algorithm you chose above.',
      visible: (v) => v.mode === 'sign',
    },
    {
      name: 'payload',
      label: 'Payload',
      type: 'textarea',
      rows: 6,
      mono: true,
      default: '{"sub":"1234567890","name":"Ada Lovelace","iat":1516239022}',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.mode === 'sign',
    },
    {
      name: 'token',
      label: 'Token',
      type: 'textarea',
      rows: 8,
      mono: true,
      placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…',
      help: 'A compact JWS: header, payload and signature, dot-separated.',
      visible: (v) => v.mode === 'verify',
    },
    {
      name: 'keyFormat',
      label: 'Key format',
      type: 'select',
      default: 'secret',
      options: [
        { value: 'secret', label: 'Shared secret (HS256, HS384, HS512)' },
        { value: 'pem-private', label: 'PEM private key' },
        { value: 'pem-public', label: 'PEM public key' },
        { value: 'jwk', label: 'JSON Web Key' },
      ],
      help: 'Pick the shape the key you have is actually in. Signing needs a private key or a shared secret; verifying needs a public key or the same shared secret.',
    },
    {
      name: 'secret',
      label: 'Shared secret',
      type: 'textarea',
      rows: 2,
      mono: true,
      placeholder: 'The shared secret for HS256, HS384 or HS512',
      help: 'The same secret signs and verifies. Read according to the encoding below.',
      visible: (v) => v.keyFormat === 'secret',
    },
    {
      name: 'secretEncoding',
      label: 'Read the secret as',
      type: 'radio',
      default: 'utf8',
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      visible: (v) => v.keyFormat === 'secret',
    },
    {
      name: 'pemPrivateKey',
      label: 'PEM private key',
      type: 'textarea',
      rows: 8,
      mono: true,
      placeholder: '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----',
      help: 'A PKCS8 private key. Used to sign with RS256/384/512, PS256/384/512 or ES256/384/512.',
      visible: (v) => v.keyFormat === 'pem-private',
    },
    {
      name: 'pemPublicKey',
      label: 'PEM public key',
      type: 'textarea',
      rows: 8,
      mono: true,
      placeholder: '-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----',
      help: 'An SPKI public key. Used to verify with RS256/384/512, PS256/384/512 or ES256/384/512.',
      visible: (v) => v.keyFormat === 'pem-public',
    },
    {
      name: 'jwkKey',
      label: 'JSON Web Key',
      type: 'textarea',
      rows: 6,
      mono: true,
      placeholder: '{"kty":"EC","crv":"P-256","x":"…","y":"…"}',
      help: 'Paste the JSON object. A key carrying a "d" member signs; one without it verifies.',
      visible: (v) => v.keyFormat === 'jwk',
    },
  ],
  examples: [
    {
      label: 'Sign with a shared secret',
      values: {
        mode: 'sign',
        algorithm: 'HS256',
        header: '{"typ":"JWT","alg":"HS256"}',
        payload: '{"sub":"1234567890","name":"Ada Lovelace","iat":1516239022}',
        keyFormat: 'secret',
        secret: 'a-very-long-shared-secret-for-hs256',
      },
    },
  ],
  async run(values): Promise<ToolResult> {
    const mode = str(values, 'mode', 'sign');
    const algorithm = str(values, 'algorithm', 'HS256') as JwsAlgorithm;
    const info = algorithmInfo(algorithm);

    if (mode === 'sign') {
      const header = str(values, 'header');
      const payload = str(values, 'payload');
      if (!header.trim() && !payload.trim()) return { outputs: [] };

      let key;
      try {
        key = await importSigningKey(algorithm, keyInputFrom(values));
      } catch (err) {
        return { outputs: [], errors: [{ message: keyErrorMessage(err) }] };
      }

      let token: string;
      try {
        token = await sign(header, payload, key, { algorithm });
      } catch (err) {
        return { outputs: [], errors: [{ message: signErrorMessage(err) }] };
      }

      return {
        outputs: [{ kind: 'code', label: 'Compact token', value: token, download: 'token.jwt' }],
        stats: [
          ['Algorithm', info.label],
          ['Family', info.family],
        ],
      };
    }

    // verify
    const token = str(values, 'token');
    if (!token.trim()) return { outputs: [] };

    let key;
    try {
      key = await importVerifyingKey(algorithm, keyInputFrom(values));
    } catch (err) {
      return { outputs: [], errors: [{ message: keyErrorMessage(err) }] };
    }

    let report;
    try {
      report = await verify(token, key, { algorithm });
    } catch (err) {
      return { outputs: [], errors: [{ message: signErrorMessage(err) }] };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'note',
        tone: report.valid ? 'success' : report.reason === 'malformed-token' ? 'error' : 'warn',
        value: report.message,
      },
      {
        kind: 'keyvalue',
        label: 'Algorithm agreement',
        pairs: [
          ['Algorithm in the token header', report.headerAlgorithm ?? '(header could not be read)'],
          ['Algorithm you chose', report.chosenAlgorithm],
          [
            'They agree',
            report.algorithmsAgree === undefined
              ? 'unknown — the header could not be read'
              : report.algorithmsAgree
                ? 'yes'
                : 'no',
          ],
        ],
      },
    ];

    return {
      outputs,
      stats: [
        ['Valid', report.valid ? 'yes' : 'no'],
        ['Reason', report.reason],
      ],
    };
  },
});

/** Never lets a key's own content, or any part of the pasted input, reach the page verbatim. */
function keyErrorMessage(err: unknown): string {
  if (err instanceof JwtKeyError) return err.message;
  return 'The key could not be prepared. Check that it matches the format you selected.';
}

function signErrorMessage(err: unknown): string {
  if (err instanceof JwtSignatureError) return err.message;
  return 'This could not be processed. Check the token and the algorithm you chose.';
}
