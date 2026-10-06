import {
  meta,
  PkceBuilderError,
  DEFAULT_VERIFIER_BYTES,
  MAX_VERIFIER_CHARACTERS,
  MIN_VERIFIER_CHARACTERS,
  buildAuthorizationRequest,
  checkVerifier,
  hasOpenidScope,
  plainChallenge,
  randomBase64Url,
  randomUnreserved,
  readRedirect,
  s256Challenge,
  tokenRequestText,
  visible,
  type AuthorizationRequest,
  type Place,
  type RandomSource,
  type RedirectReport,
} from '@fodt/pkce-builder';
import { defineTool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// The only source of random values on this page: the browser's cryptographic random number generator.
const random: RandomSource = (n) => crypto.getRandomValues(new Uint8Array(n));

// Everything on this page is an invented example: hosts are the reserved .example names (RFC 2606) and the values are the
// literals of RFC 6749, RFC 7636 and OpenID Connect Core.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_MADE =
  "Made on this device. Nothing is sent, and the verifier is not saved: keep it in your application's memory until the code is exchanged.";
const NOTE_REQUEST =
  'Made on this device. Nothing is sent, nothing is saved, and the address below is only text: this page never opens it, and what a server does with it is up to the server.';
const NOTE_REDIRECT =
  'Read on this device. Nothing is sent, nothing is saved and nothing in this text is opened. Tokens are shown only by their first characters and their length.';

const MAX_AGE_SECONDS = 31_536_000;
const SHOWN_CELL = 200;

type Mode = 'verifier' | 'request' | 'redirect';

function readMode(values: Values): Mode {
  const chosen = str(values, 'mode', 'verifier');
  return chosen === 'request' || chosen === 'redirect' ? chosen : 'verifier';
}

const only =
  (...modes: Mode[]) =>
  (values: Values): boolean =>
    modes.includes(readMode(values));

/** The length field as a whole number from 43 to 128, or the sentence that refuses it. The label and range are named. */
function readLength(values: Values): number | string {
  const n = num(values, 'length', MIN_VERIFIER_CHARACTERS);
  if (!Number.isInteger(n) || n < MIN_VERIFIER_CHARACTERS || n > MAX_VERIFIER_CHARACTERS) {
    return `Length must be a whole number from ${MIN_VERIFIER_CHARACTERS} to ${MAX_VERIFIER_CHARACTERS}.`;
  }
  return n;
}

/** The maximum authentication age: null when empty, a whole number of seconds, or the sentence that refuses it. */
function readMaxAge(values: Values): number | null | string {
  const raw = values['maxAge'];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = num(values, 'maxAge', Number.NaN);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AGE_SECONDS) {
    return `Maximum authentication age must be a whole number of seconds from 0 to ${MAX_AGE_SECONDS.toLocaleString('en-US')}.`;
  }
  return n;
}

function readMethod(values: Values): 'S256' | 'plain' {
  return str(values, 'method', 'S256') === 'plain' ? 'plain' : 'S256';
}

/** A new verifier: 32 random bytes written as 43 characters, or one random character per byte for any other length. */
function makeVerifier(length: number): string {
  return length === MIN_VERIFIER_CHARACTERS
    ? randomBase64Url(DEFAULT_VERIFIER_BYTES, random)
    : randomUnreserved(length, random);
}

async function verifierResult(values: Values): Promise<ToolResult> {
  const method = readMethod(values);
  const typed = str(values, 'verifier').trim();
  let verifier = typed;
  if (typed === '') {
    const length = readLength(values);
    if (typeof length === 'string') return { outputs: [], errors: [{ message: length }] };
    verifier = makeVerifier(length);
  }
  const problems = checkVerifier(verifier);
  if (problems.length > 0) return { outputs: [], errors: problems.map((problem) => ({ message: problem.message })) };
  const plain = method === 'plain' ? plainChallenge(verifier) : null;
  const challenge = plain === null ? await s256Challenge(verifier) : plain.challenge;
  const outputs: OutputBlock[] = [
    { kind: 'note', tone: 'info', value: NOTE_MADE },
    {
      kind: 'keyvalue',
      label: 'PKCE verifier and challenge',
      pairs: [
        ['Verifier', verifier],
        ['Length', `${verifier.length} characters`],
        ['Where it came from', typed === '' ? "Made now with the browser's random number generator" : 'As typed'],
        ['Method', method],
        ['Challenge', challenge],
        [
          'Rule check',
          `Passes RFC 7636 section 4.1: ${MIN_VERIFIER_CHARACTERS} to ${MAX_VERIFIER_CHARACTERS} characters from A-Z, a-z, 0-9, hyphen, period, underscore and tilde.`,
        ],
      ],
    },
    {
      kind: 'code',
      label: 'Authorization request parameters',
      value: `code_challenge=${challenge}&code_challenge_method=${method}`,
    },
  ];
  if (plain !== null) outputs.push({ kind: 'note', tone: 'warn', value: plain.warning });
  return { outputs };
}

const MADE_LABELS: Record<string, string> = {
  verifier: 'Code verifier (keep it until the code is exchanged)',
  state: 'State',
  nonce: 'Nonce',
};

function requestBlocks(request: AuthorizationRequest, clientId: string, redirectUri: string): OutputBlock[] {
  const blocks: OutputBlock[] = [
    { kind: 'note', tone: 'info', value: NOTE_REQUEST },
    { kind: 'code', label: 'Authorization request address', value: request.url },
    {
      kind: 'table',
      label: 'Parameters',
      table: {
        headers: ['Parameter', 'Value', 'Written in the address'],
        rows: request.parameters.map((parameter) => [
          parameter.name,
          visible(parameter.value, SHOWN_CELL),
          visible(parameter.written, SHOWN_CELL),
        ]),
        mono: [0, 1, 2],
      },
    },
  ];
  if (request.made.length > 0) {
    blocks.push({
      kind: 'keyvalue',
      label: 'Made for you',
      pairs: request.made.map((made): [string, string] => [MADE_LABELS[made.name] ?? made.name, made.value]),
    });
  }
  if (request.verifier !== null) {
    const token = tokenRequestText({
      clientId: clientId.trim(),
      redirectUri: redirectUri.trim(),
      verifier: request.verifier,
    });
    blocks.push(
      { kind: 'code', label: 'Token request body (text only)', value: token.body },
      { kind: 'note', tone: 'info', value: token.note },
    );
  }
  const items = request.problems.map(
    (problem) => `${problem.tone === 'warn' ? 'Worth a look' : 'Note'}: ${problem.message}`,
  );
  if (items.length === 0) {
    items.push(
      'None of the rules checked here (RFC 6749, RFC 7636, RFC 9700, RFC 8252 and OpenID Connect Core) is broken by these fields. The server may still refuse the request: it knows its clients, redirect addresses and scopes, and this page does not.',
    );
  }
  blocks.push({ kind: 'list', label: 'Checks', items });
  return blocks;
}

async function requestResult(values: Values): Promise<ToolResult> {
  const authorizeUrl = str(values, 'authorizeUrl').trim();
  if (authorizeUrl === '') return { outputs: [] };
  const maxAge = readMaxAge(values);
  if (typeof maxAge === 'string') return { outputs: [], errors: [{ message: maxAge }] };
  const verifier = str(values, 'verifier');
  let verifierLength = MIN_VERIFIER_CHARACTERS;
  if (verifier.trim() === '' && str(values, 'responseType', 'code') !== 'token') {
    const length = readLength(values);
    if (typeof length === 'string') return { outputs: [], errors: [{ message: length }] };
    verifierLength = length;
  }
  const scope = str(values, 'scope');
  const clientId = str(values, 'clientId');
  const redirectUri = str(values, 'redirectUri');
  const request = await buildAuthorizationRequest({
    authorizeUrl,
    clientId,
    redirectUri,
    scope,
    responseType: str(values, 'responseType', 'code') === 'token' ? 'token' : 'code',
    state: str(values, 'state'),
    nonce: str(values, 'nonce'),
    verifier,
    verifierLength,
    method: readMethod(values),
    responseMode: str(values, 'responseMode'),
    prompt: str(values, 'prompt'),
    display: str(values, 'display'),
    maxAge,
    loginHint: str(values, 'loginHint'),
    acrValues: str(values, 'acrValues'),
    uiLocales: str(values, 'uiLocales'),
    random,
  });
  return { outputs: requestBlocks(request, clientId, redirectUri) };
}

const PLACE_LABELS: Record<Place, string> = { query: 'Query', fragment: 'Fragment', body: 'Form body' };

const FORM_LABELS: Record<RedirectReport['form'], string> = {
  address: 'A full address',
  query: 'A bare query',
  fragment: 'A bare fragment',
  'form body': 'A form body',
};

function redirectBlocks(report: RedirectReport): OutputBlock[] {
  const pairs: [string, string][] = [
    ['Read as', FORM_LABELS[report.form]],
    [
      'Read from',
      report.readFrom.length === 0 ? 'Nothing' : report.readFrom.map((place) => PLACE_LABELS[place]).join(' and '),
    ],
    ['Parameters', String(report.parameters.length)],
  ];
  for (const item of report.found) {
    pairs.push([item.name, `${visible(item.value, SHOWN_CELL)} (${PLACE_LABELS[item.place].toLowerCase()})`]);
  }
  for (const token of report.tokens) {
    pairs.push([token.name, `Present: ${token.value} (${PLACE_LABELS[token.place].toLowerCase()})`]);
  }
  if (report.error !== null) pairs.push(['What the error means', report.error.sentence]);
  const blocks: OutputBlock[] = [
    { kind: 'note', tone: 'info', value: NOTE_REDIRECT },
    { kind: 'keyvalue', label: 'What was found', pairs },
  ];
  if (report.parameters.length > 0) {
    blocks.push({
      kind: 'table',
      label: 'All parameters, in the order written',
      table: {
        headers: ['#', 'Where', 'Name', 'Value'],
        rows: report.parameters.map((parameter, index) => [
          index + 1,
          PLACE_LABELS[parameter.place],
          parameter.name === '' ? '(no name)' : visible(parameter.name, SHOWN_CELL),
          visible(parameter.value, SHOWN_CELL),
        ]),
        mono: [2, 3],
      },
    });
  }
  for (const note of report.notes) blocks.push({ kind: 'note', tone: note.tone, value: note.message });
  return blocks;
}

function redirectResult(values: Values): ToolResult {
  const text = str(values, 'redirect');
  if (text.trim() === '') return { outputs: [] };
  const report = readRedirect(text, { state: str(values, 'expectedState'), issuer: str(values, 'expectedIssuer') });
  return { outputs: redirectBlocks(report) };
}

const REQUEST_ONLY = only('request');

export default defineTool({
  id: 'pkce-builder',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to do',
      type: 'radio',
      default: 'verifier',
      options: [
        { value: 'verifier', label: 'Make a verifier and challenge' },
        { value: 'request', label: 'Build an authorization request' },
        { value: 'redirect', label: 'Read a redirect' },
      ],
    },
    {
      name: 'verifier',
      label: 'Code verifier',
      type: 'text',
      placeholder: 'Leave blank to make a new one',
      help: 'Leave blank to make a new one. A verifier you type is checked against RFC 7636 section 4.1.',
      mono: true,
      visible: only('verifier', 'request'),
    },
    {
      name: 'length',
      label: 'Length',
      type: 'number',
      default: MIN_VERIFIER_CHARACTERS,
      min: MIN_VERIFIER_CHARACTERS,
      max: MAX_VERIFIER_CHARACTERS,
      step: 1,
      help: 'Used only when the verifier is blank. 43 is 32 random bytes written as base64url.',
      visible: only('verifier', 'request'),
    },
    {
      name: 'method',
      label: 'Challenge method',
      type: 'select',
      default: 'S256',
      options: [
        { value: 'S256', label: 'S256 (SHA-256, recommended)' },
        { value: 'plain', label: 'plain (not recommended)' },
      ],
      visible: only('verifier', 'request'),
    },
    {
      name: 'authorizeUrl',
      label: 'Authorization endpoint',
      type: 'text',
      placeholder: 'https://idp.example/authorize',
      help: 'An absolute http or https address. A query already on it is kept; a fragment is refused.',
      mono: true,
      wide: true,
      visible: REQUEST_ONLY,
    },
    { name: 'clientId', label: 'client_id', type: 'text', mono: true, visible: REQUEST_ONLY },
    {
      name: 'redirectUri',
      label: 'redirect_uri',
      type: 'text',
      placeholder: 'https://client.example.org/cb',
      mono: true,
      visible: REQUEST_ONLY,
    },
    {
      name: 'scope',
      label: 'scope',
      type: 'text',
      default: 'openid profile',
      help: 'Values separated by spaces. Add openid for an OpenID Connect request.',
      mono: true,
      visible: REQUEST_ONLY,
    },
    {
      name: 'responseType',
      label: 'response_type',
      type: 'select',
      default: 'code',
      options: [
        { value: 'code', label: 'code (authorization code flow)' },
        { value: 'token', label: 'token (implicit grant, RFC 9700 says should not be used)' },
      ],
      visible: REQUEST_ONLY,
    },
    {
      name: 'state',
      label: 'state',
      type: 'text',
      placeholder: 'Leave blank to make a new one',
      help: 'Leave blank to make a new one.',
      mono: true,
      visible: REQUEST_ONLY,
    },
    {
      name: 'nonce',
      label: 'nonce',
      type: 'text',
      placeholder: 'Leave blank to make a new one',
      help: 'OpenID Connect only. Leave blank to make a new one.',
      mono: true,
      visible: (values) => REQUEST_ONLY(values) && hasOpenidScope(str(values, 'scope')),
    },
    {
      name: 'responseMode',
      label: 'response_mode',
      type: 'select',
      default: '',
      options: [
        { value: '', label: 'Not set' },
        { value: 'query', label: 'query' },
        { value: 'fragment', label: 'fragment' },
        { value: 'form_post', label: 'form_post' },
      ],
      visible: REQUEST_ONLY,
    },
    {
      name: 'prompt',
      label: 'prompt',
      type: 'select',
      default: '',
      options: [
        { value: '', label: 'Not set' },
        { value: 'none', label: 'none' },
        { value: 'login', label: 'login' },
        { value: 'consent', label: 'consent' },
        { value: 'select_account', label: 'select_account' },
      ],
      visible: REQUEST_ONLY,
    },
    {
      name: 'display',
      label: 'display',
      type: 'select',
      default: '',
      options: [
        { value: '', label: 'Not set' },
        { value: 'page', label: 'page' },
        { value: 'popup', label: 'popup' },
        { value: 'touch', label: 'touch' },
        { value: 'wap', label: 'wap' },
      ],
      visible: REQUEST_ONLY,
    },
    {
      name: 'maxAge',
      label: 'max_age (seconds)',
      type: 'number',
      min: 0,
      max: MAX_AGE_SECONDS,
      step: 1,
      help: 'Optional. How old the last sign-in may be.',
      visible: REQUEST_ONLY,
    },
    {
      name: 'uiLocales',
      label: 'ui_locales',
      type: 'text',
      placeholder: 'fr-CA fr en',
      mono: true,
      visible: REQUEST_ONLY,
    },
    { name: 'loginHint', label: 'login_hint', type: 'text', mono: true, visible: REQUEST_ONLY },
    { name: 'acrValues', label: 'acr_values', type: 'text', mono: true, visible: REQUEST_ONLY },
    {
      name: 'redirect',
      label: 'Redirect address, query, fragment or form body',
      type: 'textarea',
      rows: 5,
      placeholder: PASTE_PLACEHOLDER,
      help: 'The address the authorization server sent the browser back to. Both the query and the fragment are read.',
      wide: true,
      visible: only('redirect'),
    },
    {
      name: 'expectedState',
      label: 'Expected state',
      type: 'text',
      help: 'The state your request carried. Leave blank to skip the comparison.',
      mono: true,
      visible: only('redirect'),
    },
    {
      name: 'expectedIssuer',
      label: 'Expected issuer',
      type: 'text',
      placeholder: 'https://idp.example',
      help: 'Optional. Compared with iss as a simple string (RFC 9207).',
      mono: true,
      visible: only('redirect'),
    },
  ],
  examples: [
    {
      label: 'RFC 7636 Appendix B verifier',
      values: { mode: 'verifier', verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', length: 43, method: 'S256' },
    },
    {
      label: 'An OpenID Connect request with PKCE',
      values: {
        mode: 'request',
        verifier: '',
        length: 43,
        method: 'S256',
        authorizeUrl: 'https://server.example.com/authorize',
        clientId: 's6BhdRkqt3',
        redirectUri: 'https://client.example.org/cb',
        scope: 'openid profile email',
        responseType: 'code',
        state: '',
        nonce: '',
      },
    },
    {
      label: 'RFC 6749 section 4.1.2: a code and a state come back',
      values: {
        mode: 'redirect',
        redirect: 'https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz',
        expectedState: 'xyz',
        expectedIssuer: '',
      },
    },
    {
      label: 'RFC 6749 section 4.1.2.1: an error comes back without a state',
      values: {
        mode: 'redirect',
        redirect: 'https://client.example.com/cb?error=access_denied',
        expectedState: 'xyz',
        expectedIssuer: '',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const mode = readMode(values);
      if (mode === 'redirect') return redirectResult(values);
      if (mode === 'request') return await requestResult(values);
      return await verifierResult(values);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof PkceBuilderError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not make or read this here.' }] };
    }
  },
});
