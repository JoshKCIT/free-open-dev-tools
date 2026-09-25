/**
 * A User-Agent field value, split into its RFC 9110 section 10.1.5
 * product identifiers and comments:
 *
 *   User-Agent = product *( RWS ( product / comment ) )
 *   product    = token [ "/" product-version ]
 *   token      = 1*tchar                             (section 5.6.2)
 *   comment    = "(" *( ctext / quoted-pair / comment ) ")"  (section 5.6.5)
 *
 * This never throws. A malformed part -- an unbalanced parenthesis, a
 * character outside the token character set, a slash with no version
 * after it -- is listed in `problems` and marks the result not well
 * formed, but parsing always finishes and returns whatever it could read.
 */

export interface ProductToken {
  product: string;
  version: string | null;
  comments: string[];
}

export interface TokenizeResult {
  tokens: ProductToken[];
  wellFormed: boolean;
  problems: string[];
}

// RFC 9110 section 5.6.2: tchar = the listed punctuation, plus DIGIT / ALPHA.
const TCHAR_EXTRA = "!#$%&'*+-.^_`|~";

function isTchar(ch: string): boolean {
  if (TCHAR_EXTRA.includes(ch)) return true;
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

export function tokenizeUserAgent(ua: string): TokenizeResult {
  const tokens: ProductToken[] = [];
  const problems: string[] = [];
  let wellFormed = true;
  let i = 0;
  const n = ua.length;

  function skipWhitespace(): void {
    while (i < n && isWhitespace(ua[i]!)) i++;
  }

  function readToken(): string {
    const start = i;
    while (i < n && isTchar(ua[i]!)) i++;
    return ua.slice(start, i);
  }

  // Reads a "(" ... ")" comment, tracking nested comments and quoted pairs
  // ("\" followed by one octet, which stands for that octet literally) so a
  // parenthesis escaped with a backslash, or opened by a nested comment,
  // never ends the outer comment early.
  function readComment(): string {
    i++; // consume the opening "("
    let depth = 1;
    let content = '';
    while (i < n && depth > 0) {
      const ch = ua[i]!;
      if (ch === '\\' && i + 1 < n) {
        content += ua.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '(') {
        depth++;
        content += ch;
        i++;
        continue;
      }
      if (ch === ')') {
        depth--;
        i++;
        if (depth === 0) break;
        content += ch;
        continue;
      }
      content += ch;
      i++;
    }
    if (depth > 0) {
      wellFormed = false;
      problems.push(
        'An unbalanced parenthesis in a comment was never closed, so the rest of the string was read as its content.',
      );
    }
    return content;
  }

  skipWhitespace();
  while (i < n) {
    const ch = ua[i]!;
    if (ch === '(') {
      const comment = readComment();
      if (tokens.length === 0) {
        wellFormed = false;
        problems.push('A comment appeared before any product token, so it has nothing to attach to.');
      } else {
        tokens[tokens.length - 1]!.comments.push(comment);
      }
    } else if (isTchar(ch)) {
      const product = readToken();
      let version: string | null = null;
      if (i < n && ua[i] === '/') {
        i++;
        const v = readToken();
        if (v === '') {
          wellFormed = false;
          problems.push(`"${product}/" has a slash with no version after it.`);
        } else {
          version = v;
        }
      }
      tokens.push({ product, version, comments: [] });
    } else {
      wellFormed = false;
      problems.push(`The character at position ${i + 1} is not part of a token, a comment, or whitespace.`);
      i++;
    }
    skipWhitespace();
  }

  return { tokens, wellFormed, problems };
}
