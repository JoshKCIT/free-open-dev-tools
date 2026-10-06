import { PkceBuilderError } from './errors';
import { MAX_URL_CHARACTERS, MAX_VERIFIER_CHARACTERS, MIN_VERIFIER_CHARACTERS, checkLength } from './limits';

export type VerifierRule = 'too-short' | 'too-long' | 'character';

/** One rule a verifier breaks. The message names the rule, a count or a code point, and never the verifier itself. */
export interface Problem {
  rule: VerifierRule;
  message: string;
}

/** RFC 7636 section 4.1: unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~". */
function isUnreserved(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 46 ||
    code === 95 ||
    code === 126
  );
}

function codePointName(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Checks a code verifier against RFC 7636 section 4.1 (43 to 128 characters from A-Z, a-z, 0-9, hyphen, period,
 * underscore and tilde) and lists every rule it breaks: its length, and the first character outside the set as a U+ code
 * with its position. An empty list means the verifier is allowed.
 */
export function checkVerifier(text: string): Problem[] {
  checkLength(text, MAX_URL_CHARACTERS, 'verifier', 'verifier');
  const problems: Problem[] = [];
  let count = 0;
  let firstBad: { code: number; position: number } | null = null;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) ?? 0;
    count += 1;
    if (firstBad === null && !isUnreserved(code)) firstBad = { code, position: count };
    if (code > 0xffff) i += 1;
  }
  if (count < MIN_VERIFIER_CHARACTERS) {
    problems.push({
      rule: 'too-short',
      message: `The verifier has ${count} characters. RFC 7636 section 4.1 asks for at least ${MIN_VERIFIER_CHARACTERS}.`,
    });
  } else if (count > MAX_VERIFIER_CHARACTERS) {
    problems.push({
      rule: 'too-long',
      message: `The verifier has ${count} characters. RFC 7636 section 4.1 asks for at most ${MAX_VERIFIER_CHARACTERS}.`,
    });
  }
  if (firstBad !== null) {
    problems.push({
      rule: 'character',
      message: `Character ${firstBad.position} of the verifier is ${codePointName(firstBad.code)}, which RFC 7636 section 4.1 does not allow. Only A-Z, a-z, 0-9, hyphen, period, underscore and tilde are allowed.`,
    });
  }
  return problems;
}

/** Throws a refusal (part `verifier`) naming the first rule the verifier breaks; returns when it is allowed. */
export function requireVerifier(text: string): void {
  const first = checkVerifier(text)[0];
  if (first !== undefined) throw new PkceBuilderError(first.message, 'verifier');
}
