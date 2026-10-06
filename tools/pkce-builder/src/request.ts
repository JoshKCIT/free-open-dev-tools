import { PLAIN_WARNING, plainChallenge, s256Challenge } from './challenge';
import { PkceBuilderError, type PkceBuilderPart } from './errors';
import {
  DEFAULT_STATE_BYTES,
  DEFAULT_VERIFIER_BYTES,
  MAX_PARAMETERS,
  MAX_SCOPE_CHARACTERS,
  MAX_URL_CHARACTERS,
  MAX_VERIFIER_CHARACTERS,
  MIN_VERIFIER_CHARACTERS,
  checkLength,
  withCommas,
} from './limits';
import { randomBase64Url, randomUnreserved, type RandomSource } from './random';
import { checkRedirectUri, type Finding } from './redirect-uri';
import { requireVerifier } from './verifier';

export type ResponseType = 'code' | 'token';
export type ChallengeMethod = 'S256' | 'plain';

/** Everything a request is built from. There is no field for a client secret, by design. */
export interface AuthorizationFields {
  /** The authorization endpoint, an absolute http or https address. An existing query is kept; a fragment is refused. */
  authorizeUrl: string;
  clientId: string;
  /** Blank leaves redirect_uri out. */
  redirectUri: string;
  /** Space-delimited scope values; blank leaves scope out. */
  scope: string;
  responseType: ResponseType;
  /** Blank makes a new state. */
  state: string;
  /** Blank makes a new nonce when the scope holds openid. */
  nonce: string;
  /** The PKCE code verifier for a code request; blank makes a new one. */
  verifier: string;
  /** The length of a made verifier, 43 to 128. */
  verifierLength: number;
  method: ChallengeMethod;
  responseMode: string;
  prompt: string;
  display: string;
  /** Maximum authentication age in seconds, or null to leave it out. */
  maxAge: number | null;
  loginHint: string;
  acrValues: string;
  uiLocales: string;
  /** The only source of random values; the page passes the browser's. */
  random: RandomSource;
}

/** One parameter of the request: its value as given and as written in the address. */
export interface RequestParameter {
  name: string;
  value: string;
  written: string;
}

/** A value this call made for the visitor. */
export interface MadeValue {
  name: 'verifier' | 'state' | 'nonce';
  value: string;
}

export interface AuthorizationRequest {
  url: string;
  /** The parameters this package wrote, in the order written (an existing query on the endpoint is not listed). */
  parameters: RequestParameter[];
  problems: Finding[];
  /** The values that were made, in the order they were made: verifier, state, nonce. */
  made: MadeValue[];
  /** The verifier used (typed or made), or null when the request has no challenge. */
  verifier: string | null;
  challenge: string | null;
  method: ChallengeMethod | null;
}

/**
 * One percent-encoding pass over everything except the unreserved characters of RFC 3986 section 2.3 (A-Z, a-z, 0-9,
 * hyphen, period, underscore, tilde). A space is written as %20, never as a plus sign. A character that cannot be encoded
 * (an unpaired surrogate) is refused without being shown.
 */
export function percentEncode(text: string, part: PkceBuilderPart): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(text);
  } catch {
    throw new PkceBuilderError(
      'A value holds an unpaired surrogate character, which cannot be written in an address.',
      part,
    );
  }
  // encodeURIComponent leaves ! ' ( ) * as they are; RFC 3986 section 2.3 does not count them as unreserved.
  return encoded.replace(/[!'()*]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The scope values, split on spaces only (RFC 6749 section 3.3), empty pieces dropped. */
function scopeValues(scope: string): string[] {
  return scope.split(' ').filter((value) => value !== '');
}

/** True when the scope holds the openid value, which makes the request an OpenID Connect request. */
export function hasOpenidScope(scope: string): boolean {
  return scopeValues(scope).includes('openid');
}

function codePointName(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** RFC 6749 section 3.3: scope-token = 1*( %x21 / %x23-5B / %x5D-7E ). Returns the first character that is not one. */
function firstBadScopeCharacter(scope: string): { code: number; position: number } | null {
  let position = 0;
  for (let i = 0; i < scope.length; i++) {
    const code = scope.codePointAt(i) ?? 0;
    position += 1;
    if (code > 0xffff) i += 1;
    if (code === 32) continue;
    const allowed = code === 0x21 || (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e);
    if (!allowed) return { code, position };
  }
  return null;
}

interface Endpoint {
  base: string;
  existing: string;
  secure: boolean;
}

function readEndpoint(endpoint: string): Endpoint {
  if (endpoint === '') {
    throw new PkceBuilderError('Give the authorization endpoint, an absolute http or https address.', 'endpoint');
  }
  if (endpoint.indexOf('#') >= 0) {
    throw new PkceBuilderError(
      'The authorization endpoint has a fragment. RFC 6749 section 3.1 says the endpoint must not include one.',
      'endpoint',
    );
  }
  for (let i = 0; i < endpoint.length; i++) {
    const code = endpoint.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) {
      throw new PkceBuilderError(
        'The authorization endpoint holds a space or a control character, which an address cannot hold.',
        'endpoint',
      );
    }
  }
  let protocol = '';
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new PkceBuilderError('The authorization endpoint is not an absolute http or https address.', 'endpoint');
  }
  const mark = endpoint.indexOf('?');
  return {
    base: mark < 0 ? endpoint : endpoint.slice(0, mark),
    existing: mark < 0 ? '' : endpoint.slice(mark + 1),
    secure: protocol === 'https:',
  };
}

/** The names and the number of the parameters already on the endpoint's query. */
function existingParameters(query: string): { names: Set<string>; count: number } {
  const names = new Set<string>();
  let count = 0;
  let start = 0;
  while (start <= query.length) {
    let end = query.indexOf('&', start);
    if (end < 0) end = query.length;
    if (end > start) {
      count += 1;
      let eq = end;
      for (let i = start; i < end; i++) {
        if (query.charCodeAt(i) === 61) {
          eq = i;
          break;
        }
      }
      names.add(query.slice(start, eq));
    }
    start = end + 1;
  }
  return { names, count };
}

function checkMaxAge(maxAge: number | null): void {
  if (maxAge !== null && (!Number.isSafeInteger(maxAge) || maxAge < 0)) {
    throw new PkceBuilderError(
      'The maximum authentication age must be a whole number of seconds, 0 or more.',
      'length',
    );
  }
}

/**
 * Builds an OAuth 2.0 authorization request address (RFC 6749 section 4.1.1, RFC 7636 section 4.3, OpenID Connect Core
 * section 3.1.2.1). Each parameter is written once, in this order: response_type, client_id, redirect_uri, scope, state,
 * nonce, code_challenge, code_challenge_method, then response_mode, display, prompt, max_age, ui_locales, login_hint and
 * acr_values. A blank verifier, state or nonce is made from the random source, in that order. The address is returned as
 * text; nothing is opened or sent.
 */
export async function buildAuthorizationRequest(fields: AuthorizationFields): Promise<AuthorizationRequest> {
  const endpointText = fields.authorizeUrl.trim();
  checkLength(endpointText, MAX_URL_CHARACTERS, 'endpoint', 'authorization endpoint');
  checkLength(fields.redirectUri, MAX_URL_CHARACTERS, 'redirect uri', 'redirect address');
  checkLength(fields.scope, MAX_SCOPE_CHARACTERS, 'scope', 'scope');
  const others: Array<[string, string]> = [
    [fields.clientId, 'client_id'],
    [fields.state, 'state'],
    [fields.nonce, 'nonce'],
    [fields.responseMode, 'response_mode'],
    [fields.prompt, 'prompt'],
    [fields.display, 'display'],
    [fields.loginHint, 'login_hint'],
    [fields.acrValues, 'acr_values'],
    [fields.uiLocales, 'ui_locales'],
  ];
  for (const [value, label] of others) checkLength(value, MAX_URL_CHARACTERS, 'length', label);
  checkMaxAge(fields.maxAge);

  const endpoint = readEndpoint(endpointText);
  const existing = existingParameters(endpoint.existing);
  const problems: Finding[] = [];
  const made: MadeValue[] = [];
  const written: Array<[string, string]> = [];
  const add = (name: string, value: string): void => {
    if (value !== '') written.push([name, value]);
  };

  if (!endpoint.secure) {
    problems.push({
      tone: 'warn',
      message:
        'The authorization endpoint uses http. RFC 6749 section 3.1 says the authorization server must require TLS, so a real server answers on https.',
    });
  }

  const openid = hasOpenidScope(fields.scope);
  const clientId = fields.clientId.trim();
  const redirectUri = fields.redirectUri.trim();
  const scope = scopeValues(fields.scope).join(' ');

  // The values to make, in the order they are made.
  let verifier: string | null = null;
  let challenge: string | null = null;
  let method: ChallengeMethod | null = null;
  if (fields.responseType === 'code') {
    method = fields.method === 'plain' ? 'plain' : 'S256';
    const typed = fields.verifier.trim();
    if (typed === '') {
      const length = fields.verifierLength;
      if (!Number.isInteger(length) || length < MIN_VERIFIER_CHARACTERS || length > MAX_VERIFIER_CHARACTERS) {
        throw new PkceBuilderError(
          `The verifier length must be a whole number from ${MIN_VERIFIER_CHARACTERS} to ${MAX_VERIFIER_CHARACTERS}.`,
          'length',
        );
      }
      verifier =
        length === MIN_VERIFIER_CHARACTERS
          ? randomBase64Url(DEFAULT_VERIFIER_BYTES, fields.random)
          : randomUnreserved(length, fields.random);
      made.push({ name: 'verifier', value: verifier });
    } else {
      requireVerifier(typed);
      verifier = typed;
    }
  }
  let state = fields.state.trim();
  if (state === '') {
    state = randomBase64Url(DEFAULT_STATE_BYTES, fields.random);
    made.push({ name: 'state', value: state });
  }
  let nonce = '';
  if (openid) {
    nonce = fields.nonce.trim();
    if (nonce === '') {
      nonce = randomBase64Url(DEFAULT_STATE_BYTES, fields.random);
      made.push({ name: 'nonce', value: nonce });
    }
  } else if (fields.nonce.trim() !== '') {
    problems.push({
      tone: 'info',
      message: 'A nonce belongs to OpenID Connect, so it is left out because the scope does not hold openid.',
    });
  }
  if (verifier !== null) {
    challenge = method === 'plain' ? plainChallenge(verifier).challenge : await s256Challenge(verifier);
  }

  add('response_type', fields.responseType);
  if (clientId === '') {
    problems.push({
      tone: 'warn',
      message: 'There is no client_id. RFC 6749 section 4.1.1 requires one, so none is written until you give one.',
    });
  } else {
    add('client_id', clientId);
  }
  add('redirect_uri', redirectUri);
  add('scope', scope);
  add('state', state);
  add('nonce', nonce);
  if (challenge !== null && method !== null) {
    add('code_challenge', challenge);
    add('code_challenge_method', method);
  }
  add('response_mode', fields.responseMode.trim());
  add('display', fields.display.trim());
  add('prompt', fields.prompt.trim());
  if (fields.maxAge !== null) add('max_age', String(fields.maxAge));
  add('ui_locales', fields.uiLocales.trim());
  add('login_hint', fields.loginHint.trim());
  add('acr_values', fields.acrValues.trim());

  if (existing.count + written.length > MAX_PARAMETERS) {
    throw new PkceBuilderError(
      `The request would hold ${withCommas(existing.count + written.length)} parameters. The limit is ${withCommas(MAX_PARAMETERS)}, counting the query already on the endpoint.`,
      'endpoint',
    );
  }
  for (const [name] of written) {
    if (existing.names.has(name)) {
      problems.push({
        tone: 'warn',
        message: `The endpoint already holds a parameter named ${name}. RFC 6749 section 3.1 says request parameters must not be included more than once.`,
      });
    }
  }

  if (fields.responseType === 'token') {
    problems.push({
      tone: 'warn',
      message:
        'response_type=token is the implicit grant. RFC 9700 section 2.1.2 says clients should not use it, because an access token in the response can leak and be replayed: use the code flow with PKCE. No code challenge is written, because PKCE protects the authorization code.',
    });
  } else if (method === 'plain') {
    problems.push({ tone: 'warn', message: PLAIN_WARNING });
  }

  const badScope = firstBadScopeCharacter(fields.scope);
  if (badScope !== null) {
    problems.push({
      tone: 'warn',
      message: `The scope holds ${codePointName(badScope.code)} at character ${badScope.position}, which RFC 6749 section 3.3 does not allow in a scope value.`,
    });
  }
  if (fields.scope.trim() !== scope) {
    problems.push({
      tone: 'info',
      message: 'Extra spaces in the scope were written as one space between values, as RFC 6749 section 3.3 writes it.',
    });
  }
  if (redirectUri !== '') {
    problems.push(...checkRedirectUri(redirectUri));
  } else if (openid) {
    problems.push({
      tone: 'warn',
      message:
        'There is no redirect_uri. OpenID Connect Core section 3.1.2.1 requires it, while RFC 6749 section 3.1.2 leaves it optional.',
    });
  }
  if (
    !openid &&
    (fields.prompt !== '' ||
      fields.display !== '' ||
      fields.maxAge !== null ||
      fields.uiLocales.trim() !== '' ||
      fields.loginHint.trim() !== '' ||
      fields.acrValues.trim() !== '')
  ) {
    problems.push({
      tone: 'info',
      message:
        'prompt, display, max_age, ui_locales, login_hint and acr_values are OpenID Connect parameters, and the scope does not hold openid, so a server will usually ignore them.',
    });
  }

  const parameters: RequestParameter[] = written.map(([name, value]) => ({
    name,
    value,
    written: percentEncode(value, 'length'),
  }));
  const query = parameters.map((parameter) => `${parameter.name}=${parameter.written}`).join('&');
  const joiner = endpoint.existing === '' || endpoint.existing.endsWith('&') ? '' : '&';
  const url = `${endpoint.base}?${endpoint.existing}${joiner}${query}`;
  if (url.length > MAX_URL_CHARACTERS) {
    throw new PkceBuilderError(
      `The request address would be ${withCommas(url.length)} characters. The limit is ${withCommas(MAX_URL_CHARACTERS)}.`,
      'length',
    );
  }
  return { url, parameters, problems, made, verifier, challenge, method };
}
