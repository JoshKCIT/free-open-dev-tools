import { it, expect } from 'vitest';
import { buildMailto } from '../src/uri';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

it('RFC 6068 section 6.1 body with two lines joins them with an encoded carriage return and line feed', () => {
  // RFC 6068 section 6.1: "send current-issue" and, on the next line, "send index".
  const literal = 'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index';
  const lines = ['send current-issue', 'send index'];
  // RFC 6068 section 5: line breaks in the body MUST be encoded with a carriage return and line feed,
  // whichever line break was typed.
  for (const separator of [LF, CR + LF, CR]) {
    expect(buildMailto({ to: ['infobot@example.com'], body: lines.join(separator) })).toBe(literal);
  }
});
