import { meta, decodeJwt } from '@fodt/jwt-decoder';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

// Two demonstration tokens, so the tool has something to show before a visitor
// pastes their own. Neither is a credential, and neither authenticates anything.
//
// The CI secret scan flags anything JWT-shaped, which a JWT decoder cannot avoid
// containing. The `gitleaks:allow` markers below are scoped to these two lines
// only, so a real token committed anywhere else in this file is still caught.
//
// SAMPLE is signed with HS256, but every claim points at a domain reserved for
// documentation by RFC 2606: issuer.example and api.example. No such issuer
// exists, and the signature was never produced by a real key.
//
// NONE_SAMPLE has `alg: none` and an empty signature. It exists to demonstrate
// the unsigned-token attack, which is exactly what a decoder should make visible.
// An unsigned token is by definition not a secret.
const SAMPLE =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlIiwic3ViIjoidXNlci0xMjMiLCJhdWQiOiJhcGkuZXhhbXBsZSIsImlhdCI6MTc2NzIyNTYwMCwiZXhwIjoxNzY3MjI5MjAwLCJzY29wZSI6InJlYWQ6dGhpbmdzIHdyaXRlOnRoaW5ncyJ9.Yn8wS0Q2YkZ4ZVZ6bVVBQ1hBaEtkTGdpUHZ6VW5BdFNy'; // gitleaks:allow

const NONE_SAMPLE = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJyb290In0.'; // gitleaks:allow

export default defineTool({
  id: 'jwt-decoder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'token',
      label: 'Token',
      type: 'textarea',
      rows: 8,
      placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…',
      help: 'A Bearer prefix and surrounding whitespace are stripped automatically.',
    },
  ],
  examples: [
    { label: 'Typical token', values: { token: SAMPLE } },
    { label: 'Unsigned token', values: { token: NONE_SAMPLE } },
  ],
  run(values): ToolResult {
    const token = str(values, 'token');
    if (!token.trim()) return { outputs: [] };

    const decoded = decodeJwt(token);
    const outputs: OutputBlock[] = [];

    // The warning about verification always comes first, before any content.
    const info = decoded.warnings.find((w) => w.severity === 'info' && /not verification/.test(w.message));
    if (info) outputs.push({ kind: 'note', tone: 'warn', value: info.message });

    for (const w of decoded.warnings) {
      if (w === info) continue;
      outputs.push({
        kind: 'note',
        tone: w.severity === 'error' ? 'error' : w.severity === 'warning' ? 'warn' : 'info',
        value: w.message,
      });
    }

    if (decoded.header) {
      outputs.push({ kind: 'code', label: 'Header', language: 'json', value: JSON.stringify(decoded.header, null, 2) });
    }
    if (decoded.payload) {
      outputs.push({
        kind: 'code',
        label: 'Payload',
        language: 'json',
        value: JSON.stringify(decoded.payload, null, 2),
      });
    }
    if (decoded.claims.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Claims',
        table: {
          headers: ['Claim', 'Value', 'What it means'],
          rows: decoded.claims.map((c) => [c.name, c.display, c.description]),
          mono: [0, 1],
        },
      });
    }
    if (decoded.signature !== undefined && decoded.shape === 'jws') {
      outputs.push({
        kind: 'keyvalue',
        label: 'Signature',
        pairs: [
          ['Algorithm claimed', decoded.algorithm ?? '(none given)'],
          ['Key id', decoded.keyId ?? '(none)'],
          ['Signature length', `${decoded.signatureBytes} bytes`],
          ['Signature (base64url)', decoded.signature || '(empty)'],
        ],
      });
      outputs.push({
        kind: 'code',
        label: 'Signing input — the exact bytes a verifier signs',
        value: decoded.signingInput ?? '',
      });
    }

    return {
      outputs,
      errors: decoded.errors.map((message) => ({ message })),
      stats: [
        [
          'Shape',
          decoded.shape === 'jws' ? 'JWS (signed)' : decoded.shape === 'jwe' ? 'JWE (encrypted)' : 'unrecognised',
        ],
        ['Segments', String(decoded.segments)],
        ['Algorithm', decoded.algorithm ?? 'unknown'],
      ],
    };
  },
});
