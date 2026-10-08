import { ConventionalCommitError } from './errors';
import { MAX_FOOTERS, withCommas } from './limits';
import { isBlank, splitLines } from './lines';

/** One footer: a word token, its separator, and a value that may run over several lines. */
export interface Footer {
  /** The token as written, for example `Reviewed-by` or `BREAKING CHANGE`. */
  token: string;
  /** `: ` (a colon and a space) or ` #` (a space and a number sign), the two separators of rule 8. */
  separator: ': ' | ' #';
  /** The value, trimmed at both ends; later lines of a value are joined with a line feed. */
  value: string;
  /** The line of the message (the header is line 1) on which the footer starts. */
  line: number;
}

/** One rule of the specification that a message breaks. */
export interface Failure {
  /** The number of the rule, 1 to 16, as the specification numbers them. */
  rule: number;
  message: string;
}

export interface ParsedMessage {
  /** True when no rule of the specification is broken. Convention advice never changes this. */
  valid: boolean;
  /** The first line exactly as pasted. */
  header: string;
  /** The type as written (any case), or null when none could be read. */
  type: string | null;
  /** The scope, or null when there is none (or none could be read). */
  scope: string | null;
  /** True when the type or scope is followed by `!` right before the colon. */
  bang: boolean;
  /** The description after the colon and space, trimmed; empty when none could be read. */
  description: string;
  /** The body: the lines between the description and the footers, without the blank lines around them. */
  body: string;
  footers: Footer[];
  /** True for a `!` mark, a `BREAKING CHANGE` footer or a `BREAKING-CHANGE` footer (upper case only). */
  breaking: boolean;
  /** What the breaking change says: the first breaking footer's value, else the description when only the mark is used. */
  breakingText: string | null;
  failures: Failure[];
}

/**
 * White space for the purposes of the type and the footer token: tab, vertical tab, form feed, space, no-break space and
 * the zero width no-break space. These are the characters the specification's reference parser calls white space, so the
 * two split a line in the same places.
 */
export function isWhiteCode(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 0xa0 || code === 0xfeff;
}

const BREAKING_CHANGE = 'BREAKING CHANGE';
const BREAKING_HYPHEN = 'BREAKING-CHANGE';

interface FooterStart {
  token: string;
  separator: ': ' | ' #';
  value: string;
}

/**
 * Reads the start of a footer from one line: a word token, then `: ` or ` #`, then the first line of the value. The token
 * is a run of characters that are not white space, a colon, a parenthesis or `!`; `BREAKING CHANGE` is the one token
 * that holds a space (rule 9). Returns null when the line does not start a footer. One scan, no regular expression.
 */
export function footerStart(line: string): FooterStart | null {
  let i: number;
  if (line.startsWith(BREAKING_CHANGE)) {
    i = BREAKING_CHANGE.length;
  } else {
    i = 0;
    while (i < line.length) {
      const c = line.charCodeAt(i);
      if (c === 58 || c === 40 || c === 41 || c === 33 || isWhiteCode(c)) break;
      i++;
    }
    if (i === 0) return null;
  }
  const token = line.slice(0, i);
  if (line.charCodeAt(i) === 58 && line.charCodeAt(i + 1) === 32) {
    return { token, separator: ': ', value: line.slice(i + 2) };
  }
  if (line.charCodeAt(i) === 32 && line.charCodeAt(i + 1) === 35) {
    return { token, separator: ' #', value: line.slice(i + 2) };
  }
  return null;
}

/** White space runs written as one space, for showing a value in one line. */
export function collapseWhite(text: string): string {
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isWhiteCode(c) || c === 10 || c === 13) {
      pendingSpace = out !== '';
    } else {
      if (pendingSpace) out += ' ';
      pendingSpace = false;
      out += text[i];
    }
  }
  return out;
}

interface HeaderParts {
  type: string | null;
  scope: string | null;
  bang: boolean;
  description: string;
}

/**
 * Reads the first line with an index: the type up to `(`, `)`, `!`, `:` or white space; an optional scope inside one pair
 * of parentheses; an optional `!`; the colon and one space; a description that is not empty. Each broken rule is added to
 * `failures` with its number; the scan stops at the first problem in the prefix, because what follows cannot be read.
 */
function readHeader(header: string, failures: Failure[]): HeaderParts {
  const n = header.length;
  const out: HeaderParts = { type: null, scope: null, bang: false, description: '' };
  let i = 0;
  while (i < n) {
    const c = header.charCodeAt(i);
    if (c === 40 || c === 41 || c === 33 || c === 58 || isWhiteCode(c)) break;
    i++;
  }
  if (i === 0) {
    failures.push({
      rule: 1,
      message:
        n === 0
          ? 'The first line is empty. A commit starts with a type, an optional scope, an optional ! and a colon and a space.'
          : isWhiteCode(header.charCodeAt(0))
            ? 'The first line starts with white space. The type must be the first thing on the line.'
            : 'The first line has no type. It must start with a type such as feat or fix, before the scope, the ! mark and the colon.',
    });
    return out;
  }
  out.type = header.slice(0, i);

  if (header.charCodeAt(i) === 40) {
    let j = i + 1;
    while (j < n) {
      const c = header.charCodeAt(j);
      if (c === 40 || c === 41) break;
      j++;
    }
    if (j >= n || header.charCodeAt(j) !== 41) {
      failures.push({
        rule: 4,
        message: 'The scope is not closed. Write it as (name) right after the type, with one pair of parentheses.',
      });
      return out;
    }
    if (j === i + 1) {
      failures.push({
        rule: 4,
        message: 'The scope in parentheses is empty. Name a section of the codebase or leave the parentheses out.',
      });
      return out;
    }
    out.scope = header.slice(i + 1, j);
    i = j + 1;
  }

  if (header.charCodeAt(i) === 33) {
    out.bang = true;
    i++;
  }

  if (header.charCodeAt(i) !== 58) {
    if (out.bang) {
      failures.push({ rule: 13, message: 'The ! mark must come immediately before the colon.' });
    } else if (header.charCodeAt(i) === 40) {
      failures.push({
        rule: 4,
        message: 'A commit has at most one scope, written as one pair of parentheses right after the type.',
      });
    } else {
      failures.push({
        rule: 1,
        message:
          'The type and the scope must be followed by a colon, with no space before it. Write the prefix as type(scope): description.',
      });
    }
    return out;
  }
  i++;

  if (i >= n) {
    failures.push({ rule: 1, message: 'The colon must be followed by a space and then the description.' });
    failures.push({
      rule: 5,
      message: 'The description is missing. Write a short summary of the change after the colon and space.',
    });
    return out;
  }
  if (header.charCodeAt(i) !== 32) {
    failures.push({
      rule: 1,
      message: isWhiteCode(header.charCodeAt(i))
        ? 'The colon must be followed by an ordinary space (U+0020), not a tab or a no-break space.'
        : 'The colon must be followed by a space.',
    });
    out.description = header.slice(i).trim();
  } else {
    out.description = header.slice(i + 1).trim();
  }
  if (out.description === '') {
    failures.push({
      rule: 5,
      message: 'The description is missing. Write a short summary of the change after the colon and space.',
    });
  }
  return out;
}

interface OpenFooter {
  token: string;
  separator: ': ' | ' #';
  parts: string[];
  line: number;
}

/**
 * Parses one commit message against the 16 numbered rules of Conventional Commits 1.0.0.
 *
 * The header is read with an index (see `readHeader`). The body begins one blank line after the description (rule 6); more
 * than one blank line is read as one. The footers start at the first footer-shaped line that follows a blank line (rule 8),
 * and from there every line either starts a footer or continues the value of the one before (rule 10), blank lines
 * included. A line that looks like a footer but follows body text without a blank line stays in the body. A message that
 * breaks a rule is a result with `valid: false` and its failures, never an error; the only refusal is a message with more
 * than 100 footers.
 *
 * `number` is only used to word that one refusal. Linear in the length of the text; no regular expression.
 */
export function parseMessage(text: string, number?: number): ParsedMessage {
  const lines = splitLines(text);
  const header = lines[0] ?? '';
  const failures: Failure[] = [];
  const head = readHeader(header, failures);

  let body = '';
  const footers: Footer[] = [];

  let bodyStart = 1;
  while (bodyStart < lines.length && isBlank(lines[bodyStart] as string)) bodyStart++;
  if (bodyStart < lines.length) {
    if (bodyStart === 1) {
      failures.push(
        footerStart(lines[1] as string)
          ? {
              rule: 8,
              message:
                'A footer must start one blank line after the description or the body, but the second line is not blank.',
            }
          : {
              rule: 6,
              message: 'The body must begin one blank line after the description, but the second line is not blank.',
            },
      );
    }
    let footerAt = -1;
    for (let j = bodyStart; j < lines.length; j++) {
      const line = lines[j] as string;
      if ((j === bodyStart || isBlank(lines[j - 1] as string)) && footerStart(line) !== null) {
        footerAt = j;
        break;
      }
    }
    let bodyEnd = footerAt < 0 ? lines.length : footerAt;
    while (bodyEnd > bodyStart && isBlank(lines[bodyEnd - 1] as string)) bodyEnd--;
    body = lines.slice(bodyStart, bodyEnd).join('\n');

    if (footerAt >= 0) {
      let open: OpenFooter | null = null;
      const close = (): void => {
        if (open === null) return;
        footers.push({
          token: open.token,
          separator: open.separator,
          value: open.parts.join('\n').trim(),
          line: open.line,
        });
      };
      for (let j = footerAt; j < lines.length; j++) {
        const line = lines[j] as string;
        const start = footerStart(line);
        if (start !== null) {
          close();
          if (footers.length >= MAX_FOOTERS) {
            throw new ConventionalCommitError(
              number === undefined
                ? `A message has more than ${withCommas(MAX_FOOTERS)} footers, the most this page reads.`
                : `Message ${number} has more than ${withCommas(MAX_FOOTERS)} footers, the most this page reads.`,
              'messages',
            );
          }
          open = { token: start.token, separator: start.separator, parts: [start.value], line: j + 1 };
        } else if (open !== null) {
          open.parts.push(line);
        }
      }
      close();
    }
  }

  let breakingFooter: Footer | undefined;
  for (const footer of footers) {
    if (footer.token === BREAKING_CHANGE || footer.token === BREAKING_HYPHEN) {
      breakingFooter ??= footer;
      if (footer.value === '') {
        failures.push({
          rule: 12,
          message: 'A BREAKING CHANGE footer needs a description after the colon and space.',
        });
      }
    }
  }
  const breaking = head.bang || breakingFooter !== undefined;
  const breakingText =
    breakingFooter !== undefined ? collapseWhite(breakingFooter.value) : head.bang ? head.description : null;

  return {
    valid: failures.length === 0,
    header,
    type: head.type,
    scope: head.scope,
    bang: head.bang,
    description: head.description,
    body,
    footers,
    breaking,
    breakingText,
    failures,
  };
}
