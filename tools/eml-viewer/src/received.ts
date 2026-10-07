import { commentNote, stripComments } from './comments';
import { readMailDate, type MailDate } from './dates';

/** One Received header field read as a delivery hop. */
export interface ReceivedHop {
  from: string;
  /** The first comment inside the from clause, which servers use for the address they saw. */
  fromComment: string;
  by: string;
  byComment: string;
  via: string;
  with: string;
  id: string;
  for: string;
  /** The date as written: the text after the last semicolon. Empty when there is no semicolon. */
  dateText: string;
  date: MailDate | null;
  notes: string[];
}

/** RFC 5321 section 4.4: the clauses of a trace line, which a clause value cannot contain as a word of its own. */
const CLAUSES: ReadonlySet<string> = new Set(['from', 'by', 'via', 'with', 'id', 'for']);

/** The most characters of one clause value kept (a page shows fewer). */
const MAX_CLAUSE_CHARACTERS = 1_000;

interface Span {
  value: string;
  start: number;
  end: number;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * Reads a Received header field value (RFC 5321 section 4.4): the `from`, `by`, `via`, `with`, `id` and `for` clauses
 * outside comments, and the date after the last semicolon. Nothing about it is checked: the line is whatever the server
 * that wrote it chose to say. The clause words are found in one pass over the words of the line, so a line of ten thousand
 * words costs one pass.
 */
export function parseReceived(value: string): ReceivedHop {
  const stripped = stripComments(value);
  const notes: string[] = [];
  const cut = commentNote(stripped, 'a Received line');
  if (cut !== '') notes.push(cut);

  const text = stripped.text;
  const semicolon = text.lastIndexOf(';');
  const head = semicolon >= 0 ? text.slice(0, semicolon) : text;
  const dateText = semicolon >= 0 ? text.slice(semicolon + 1).trim() : '';

  // Walk the words of the head; a clause word starts a clause and the words after it, up to the next clause word, are its value.
  const clauses = new Map<string, Span>();
  let current: string | null = null;
  let start = 0;
  let valueParts: string[] = [];
  let repeated = false;
  const close = (end: number): void => {
    if (current === null) return;
    if (clauses.has(current)) repeated = true;
    else {
      const joined = valueParts.join(' ');
      clauses.set(current, {
        value: joined.length > MAX_CLAUSE_CHARACTERS ? joined.slice(0, MAX_CLAUSE_CHARACTERS) : joined,
        start,
        end,
      });
    }
    current = null;
    valueParts = [];
  };

  const n = head.length;
  let pos = 0;
  while (pos < n) {
    while (pos < n && isSpace(head.charCodeAt(pos))) pos++;
    if (pos >= n) break;
    const wordStart = pos;
    while (pos < n && !isSpace(head.charCodeAt(pos))) pos++;
    const word = head.slice(wordStart, pos);
    const lower = word.toLowerCase();
    if (CLAUSES.has(lower)) {
      close(wordStart);
      current = lower;
      start = wordStart;
    } else if (current !== null) {
      valueParts.push(word);
    }
  }
  close(n);
  if (repeated) notes.push('A clause appears more than once in this line, so the first one was used.');

  const commentOf = (key: string): string => {
    const span = clauses.get(key);
    if (span === undefined) return '';
    for (const found of stripped.comments) {
      if (found.at >= span.start && found.at < span.end) return found.text.trim();
    }
    return '';
  };

  let date: MailDate | null = null;
  if (semicolon < 0) {
    notes.push('This line has no date after a semicolon.');
  } else if (dateText === '') {
    notes.push('This line has nothing after its semicolon, so it states no date.');
  } else {
    date = readMailDate(dateText);
    if (date === null) notes.push('The date in this line could not be read.');
    else notes.push(...date.notes);
  }

  return {
    from: clauses.get('from')?.value ?? '',
    fromComment: commentOf('from'),
    by: clauses.get('by')?.value ?? '',
    byComment: commentOf('by'),
    via: clauses.get('via')?.value ?? '',
    with: clauses.get('with')?.value ?? '',
    id: clauses.get('id')?.value ?? '',
    for: clauses.get('for')?.value ?? '',
    dateText,
    date,
    notes,
  };
}
