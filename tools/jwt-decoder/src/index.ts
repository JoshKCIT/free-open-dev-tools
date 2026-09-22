import meta from './meta.json';

export { meta };

/**
 * Decodes a JSON Web Token. It does not verify anything.
 *
 * That distinction is the whole reason this is a separate tool from the JWT
 * signer and verifier. Decoding tells you what a token claims. Only signature
 * verification tells you whether to believe it, and a decoder that blurs the
 * two teaches a dangerous habit.
 */

export type TokenShape = 'jws' | 'jwe' | 'unknown';

export interface JwtSegment {
  raw: string;
  json?: unknown;
  /** Set when the segment decoded but was not valid JSON. */
  decodeError?: string;
}

export interface ClaimRow {
  name: string;
  /** Long name from the IANA JSON Web Token Claims registry, when there is one. */
  description: string;
  raw: unknown;
  /** Rendered value, with times expanded into something readable. */
  display: string;
}

export interface JwtWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface DecodedJwt {
  shape: TokenShape;
  segments: number;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signature?: string;
  signatureBytes: number;
  headerSegment?: JwtSegment;
  payloadSegment?: JwtSegment;
  algorithm?: string;
  type?: string;
  keyId?: string;
  claims: ClaimRow[];
  warnings: JwtWarning[];
  /** Fatal problems that stopped the decode. */
  errors: string[];
  /** The exact bytes a verifier would sign, for checking against another tool. */
  signingInput?: string;
}

const REGISTERED_CLAIMS: Record<string, string> = {
  iss: 'Issuer — who created and signed this token',
  sub: 'Subject — who the token is about',
  aud: 'Audience — who the token is intended for',
  exp: 'Expiration time — reject at or after this moment',
  nbf: 'Not before — reject before this moment',
  iat: 'Issued at — when the token was created',
  jti: 'JWT ID — unique identifier, used to prevent replay',
  azp: 'Authorized party — the client the token was issued to',
  scope: 'Scope — space-separated list of granted permissions',
  scp: 'Scope — array form used by some issuers',
  nonce: 'Nonce — binds the token to a specific authentication request',
  auth_time: 'Authentication time — when the user actually authenticated',
  acr: 'Authentication context class reference',
  amr: 'Authentication methods references',
  at_hash: 'Access token hash',
  c_hash: 'Code hash',
  sid: 'Session ID',
  email: 'Email address',
  email_verified: 'Whether the email address has been verified',
  name: 'Full name',
  preferred_username: 'Preferred username',
  groups: 'Group memberships',
  roles: 'Assigned roles',
  client_id: 'OAuth client identifier',
  typ: 'Token type',
  ver: 'Version',
};

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at']);

function base64UrlToBytes(input: string): Uint8Array {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    throw new Error('Segment contains a character that is not valid Base64url.');
  }
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeSegment(raw: string): JwtSegment {
  if (raw === '') return { raw, decodeError: 'Segment is empty.' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(raw));
    try {
      return { raw, json: JSON.parse(text) };
    } catch {
      return { raw, decodeError: `Decoded to text, but it is not valid JSON: ${text.slice(0, 80)}` };
    }
  } catch (err) {
    return { raw, decodeError: err instanceof Error ? err.message : String(err) };
  }
}

function formatTime(seconds: number, now: number): string {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms)) return String(seconds);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return `${seconds} (not a valid time)`;
  const delta = ms - now;
  const abs = Math.abs(delta);
  const unit =
    abs < 60_000
      ? `${Math.round(abs / 1000)} second${Math.round(abs / 1000) === 1 ? '' : 's'}`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)} minute${Math.round(abs / 60_000) === 1 ? '' : 's'}`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)} hour${Math.round(abs / 3_600_000) === 1 ? '' : 's'}`
          : `${Math.round(abs / 86_400_000)} day${Math.round(abs / 86_400_000) === 1 ? '' : 's'}`;
  return `${date.toISOString()} (${delta >= 0 ? `in ${unit}` : `${unit} ago`})`;
}

function displayValue(name: string, value: unknown, now: number): string {
  if (TIME_CLAIMS.has(name) && typeof value === 'number') return formatTime(value, now);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface DecodeOptions {
  /** Injected so the expiry checks are deterministic in tests. */
  now?: number;
}

export function decodeJwt(token: string, options: DecodeOptions = {}): DecodedJwt {
  const now = options.now ?? Date.now();
  const warnings: JwtWarning[] = [];
  const errors: string[] = [];
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');

  const parts = trimmed.split('.');
  const shape: TokenShape = parts.length === 3 ? 'jws' : parts.length === 5 ? 'jwe' : 'unknown';

  const base: DecodedJwt = {
    shape,
    segments: parts.length,
    signatureBytes: 0,
    claims: [],
    warnings,
    errors,
  };

  if (trimmed === '') {
    errors.push('No token supplied.');
    return base;
  }

  if (shape === 'jwe') {
    errors.push(
      'This is a JWE, an encrypted token with five segments. Its payload is ciphertext and cannot be read without the decryption key. Only the header below is readable.',
    );
    base.headerSegment = decodeSegment(parts[0]!);
    if (base.headerSegment.json && typeof base.headerSegment.json === 'object') {
      base.header = base.headerSegment.json as Record<string, unknown>;
      base.algorithm = String(base.header.alg ?? '');
    }
    return base;
  }

  if (shape === 'unknown') {
    errors.push(
      `A JWS has three dot-separated segments and a JWE has five. This has ${parts.length}. Check for a truncated copy or a stray line break.`,
    );
    return base;
  }

  const [headerRaw, payloadRaw, signatureRaw] = parts as [string, string, string];
  base.signingInput = `${headerRaw}.${payloadRaw}`;
  base.signature = signatureRaw;

  const headerSeg = decodeSegment(headerRaw);
  const payloadSeg = decodeSegment(payloadRaw);
  base.headerSegment = headerSeg;
  base.payloadSegment = payloadSeg;

  if (headerSeg.decodeError) errors.push(`Header: ${headerSeg.decodeError}`);
  if (payloadSeg.decodeError) errors.push(`Payload: ${payloadSeg.decodeError}`);

  if (headerSeg.json && typeof headerSeg.json === 'object' && !Array.isArray(headerSeg.json)) {
    base.header = headerSeg.json as Record<string, unknown>;
    base.algorithm = typeof base.header.alg === 'string' ? base.header.alg : undefined;
    base.type = typeof base.header.typ === 'string' ? base.header.typ : undefined;
    base.keyId = typeof base.header.kid === 'string' ? base.header.kid : undefined;
  }

  if (payloadSeg.json && typeof payloadSeg.json === 'object' && !Array.isArray(payloadSeg.json)) {
    base.payload = payloadSeg.json as Record<string, unknown>;
  }

  try {
    base.signatureBytes = signatureRaw === '' ? 0 : base64UrlToBytes(signatureRaw).length;
  } catch {
    warnings.push({ severity: 'warning', message: 'The signature segment is not valid Base64url.' });
  }

  // Always say this, at the top, for every token.
  warnings.push({
    severity: 'info',
    message:
      'Decoding is not verification. Anything in this token can be changed by anyone holding it. Only checking the signature against the issuer key tells you whether to trust it.',
  });

  const alg = base.algorithm;
  if (alg === undefined) {
    warnings.push({
      severity: 'warning',
      message: 'The header has no "alg" field, which every JWS is required to have.',
    });
  } else if (alg.toLowerCase() === 'none') {
    warnings.push({
      severity: 'error',
      message:
        'The algorithm is "none", meaning this token is unsigned. A verifier that accepts it is accepting a token anyone can forge. This is a well-known attack, and libraries must reject it unless unsigned tokens are explicitly expected.',
    });
  }

  if (signatureRaw === '' && alg?.toLowerCase() !== 'none') {
    warnings.push({ severity: 'error', message: `The signature is empty although the algorithm is "${alg}".` });
  }

  if (base.type && !/^(JWT|at\+jwt|application\/jwt)$/i.test(base.type)) {
    warnings.push({ severity: 'info', message: `The "typ" header is "${base.type}" rather than the usual "JWT".` });
  }

  const payload = base.payload;
  if (payload) {
    const nowSeconds = now / 1000;

    if (typeof payload.exp === 'number') {
      if (payload.exp <= nowSeconds) {
        warnings.push({
          severity: 'error',
          message: `This token expired ${formatTime(payload.exp, now).replace(/^.*\(/, '').replace(/\)$/, '')}.`,
        });
      }
    } else if (payload.exp === undefined) {
      warnings.push({
        severity: 'warning',
        message: 'There is no "exp" claim, so this token never expires on its own. That is rarely what you want.',
      });
    } else {
      warnings.push({ severity: 'error', message: '"exp" must be a number of seconds since the Unix epoch.' });
    }

    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
      warnings.push({
        severity: 'warning',
        message: `This token is not valid yet: "nbf" is ${formatTime(payload.nbf, now)}.`,
      });
    }

    if (typeof payload.iat === 'number' && payload.iat > nowSeconds + 60) {
      warnings.push({
        severity: 'warning',
        message: 'The "iat" claim is in the future. Either a clock is wrong or the timestamp is in the wrong unit.',
      });
    }

    for (const claim of ['exp', 'nbf', 'iat']) {
      const v = payload[claim];
      // A value above roughly year 33658 in seconds is almost certainly
      // milliseconds, which is one of the most common JWT bugs.
      if (typeof v === 'number' && v > 1e12) {
        warnings.push({
          severity: 'error',
          message: `"${claim}" looks like milliseconds. JWT timestamps are seconds since the Unix epoch (RFC 7519 section 2), so this value is about 1000 times too large.`,
        });
      }
    }

    const order = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'];
    const keys = Object.keys(payload).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    base.claims = keys.map((name) => ({
      name,
      description: REGISTERED_CLAIMS[name] ?? 'Custom claim, defined by whoever issued this token',
      raw: payload[name],
      display: displayValue(name, payload[name], now),
    }));
  }

  return base;
}

/** Splits a token for display without decoding it, so a broken token still shows structure. */
export function segments(token: string): string[] {
  return token
    .trim()
    .replace(/^Bearer\s+/i, '')
    .split('.');
}
