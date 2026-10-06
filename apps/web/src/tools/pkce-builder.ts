import {
  meta,
  PkceBuilderError,
  DEFAULT_VERIFIER_BYTES,
  MAX_VERIFIER_CHARACTERS,
  MIN_VERIFIER_CHARACTERS,
  checkVerifier,
  plainChallenge,
  randomBase64Url,
  randomUnreserved,
  s256Challenge,
  type RandomSource,
} from '@fodt/pkce-builder';
import { defineTool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// The only source of random values on this page: the browser's cryptographic random number generator.
const random: RandomSource = (n) => crypto.getRandomValues(new Uint8Array(n));

const NOTE_MADE =
  "Made on this device. Nothing is sent, and the verifier is not saved: keep it in your application's memory until the code is exchanged.";

/** The length field as a whole number from 43 to 128, or the sentence that refuses it. The label and range are named. */
function readLength(values: Values): number | string {
  const n = num(values, 'length', MIN_VERIFIER_CHARACTERS);
  if (!Number.isInteger(n) || n < MIN_VERIFIER_CHARACTERS || n > MAX_VERIFIER_CHARACTERS) {
    return `Length must be a whole number from ${MIN_VERIFIER_CHARACTERS} to ${MAX_VERIFIER_CHARACTERS}.`;
  }
  return n;
}

/** A new verifier: 32 random bytes written as 43 characters, or one random character per byte for any other length. */
function makeVerifier(length: number): string {
  return length === MIN_VERIFIER_CHARACTERS
    ? randomBase64Url(DEFAULT_VERIFIER_BYTES, random)
    : randomUnreserved(length, random);
}

async function verifierBlocks(values: Values): Promise<ToolResult> {
  const method = str(values, 'method', 'S256') === 'plain' ? 'plain' : 'S256';
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

export default defineTool({
  id: 'pkce-builder',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'verifier',
      label: 'Code verifier',
      type: 'text',
      placeholder: 'Leave blank to make a new one',
      help: 'Leave blank to make a new one. A verifier you type is checked against RFC 7636 section 4.1.',
      mono: true,
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
    },
  ],
  examples: [
    {
      label: 'RFC 7636 Appendix B verifier',
      values: { verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', length: 43, method: 'S256' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      return await verifierBlocks(values);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof PkceBuilderError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not make a PKCE pair here.' }] };
    }
  },
});
