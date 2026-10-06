import type { AuthorizationFields, RandomSource } from '../src/index';

/** RFC 7636 appendix B: the code_verifier and the code_challenge it gives with S256. */
export const APPENDIX_B_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const APPENDIX_B_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** A small seeded generator (mulberry32): the same seed always gives the same numbers between 0 and 1. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source made of seeded bytes. Two sources with the same seed give the same bytes call by call. */
export function seeded(seed: number): RandomSource {
  const next = mulberry32(seed);
  return (count) => Uint8Array.from({ length: count }, () => Math.floor(next() * 256));
}

/** A complete set of fields for a code flow request; a test overrides only what it is about. */
export function fields(over: Partial<AuthorizationFields> = {}): AuthorizationFields {
  return {
    authorizeUrl: 'https://server.example.com/authorize',
    clientId: 's6BhdRkqt3',
    redirectUri: 'https://client.example.org/cb',
    scope: 'openid profile',
    responseType: 'code',
    state: 'xyz',
    nonce: 'n-0S6_WzA2Mj',
    verifier: APPENDIX_B_VERIFIER,
    verifierLength: 43,
    method: 'S256',
    responseMode: '',
    prompt: '',
    display: '',
    maxAge: null,
    loginHint: '',
    acrValues: '',
    uiLocales: '',
    random: seeded(1),
    ...over,
  };
}
