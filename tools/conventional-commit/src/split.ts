import { ConventionalCommitError } from './errors';
import { forEachLine } from './lines';
import {
  MAX_LINES_PER_MESSAGE,
  MAX_MESSAGES,
  MAX_SEPARATOR_CHARACTERS,
  checkLineLength,
  checkPasteLength,
  withCommas,
} from './limits';

/** How a paste is cut into messages. */
export type SplitMode = 'separator' | 'lines' | 'gitlog';

/** The separator line used when none is given. */
export const DEFAULT_SEPARATOR = '---';

/** What git wrote itself, so the line is named and skipped instead of being judged. */
export type SkipKind = 'merge' | 'revert' | 'fixup' | 'squash' | 'amend' | 'comment';

export interface SplitMessage {
  /** The position among everything that was cut out of the paste, skipped lines included, starting at 1. */
  number: number;
  /** The message, lines joined with a line feed, without the blank lines around it. */
  text: string;
  /** The first line of the message. */
  firstLine: string;
  /** The pasted line number the message starts on (counting every line of the paste). */
  line: number;
}

export interface SkippedMessage {
  number: number;
  kind: SkipKind;
  line: number;
}

export interface SplitResult {
  messages: SplitMessage[];
  skipped: SkippedMessage[];
  /** How many messages came after the 1,000th: counted and not read. */
  unread: number;
}

/**
 * Names the lines git writes by itself: a merge commit's `Merge ` line, the `Revert "` line of `git revert`, the
 * `fixup! `, `squash! ` and `amend! ` lines of `git commit --fixup` and `--squash`, and a `#` comment line. Case matters,
 * as it does in what git writes.
 */
export function skipKindOf(firstLine: string): SkipKind | null {
  if (firstLine.startsWith('#')) return 'comment';
  if (firstLine.startsWith('Merge ')) return 'merge';
  if (firstLine.startsWith('Revert "')) return 'revert';
  if (firstLine.startsWith('fixup! ')) return 'fixup';
  if (firstLine.startsWith('squash! ')) return 'squash';
  if (firstLine.startsWith('amend! ')) return 'amend';
  return null;
}

/** Refuses an empty or over-long separator before the paste is cut. */
export function checkSeparator(separator: string): string {
  const trimmed = separator.trim();
  if (trimmed === '') {
    throw new ConventionalCommitError(
      `The separator is empty. Type the line that ends each message, for example ${DEFAULT_SEPARATOR}.`,
      'separator',
    );
  }
  if (separator.length > MAX_SEPARATOR_CHARACTERS) {
    throw new ConventionalCommitError(
      `The separator is ${withCommas(separator.length)} characters long and this page allows at most ${MAX_SEPARATOR_CHARACTERS}.`,
      'separator',
    );
  }
  return trimmed;
}

/** Collects what is cut out of the paste, numbering skipped lines and messages together. */
class Collector {
  readonly messages: SplitMessage[] = [];
  readonly skipped: SkippedMessage[] = [];
  unread = 0;
  count = 0;

  /** True once 1,000 messages are taken: later ones are only counted. */
  get full(): boolean {
    return this.count >= MAX_MESSAGES;
  }

  add(lines: string[], line: number): void {
    this.count += 1;
    const firstLine = lines[0] as string;
    const kind = skipKindOf(firstLine);
    if (kind !== null) this.skipped.push({ number: this.count, kind, line });
    else this.messages.push({ number: this.count, text: lines.join('\n'), firstLine, line });
  }
}

/** Gathers the lines of one message, keeping nothing once the 1,000 message limit is reached. */
class Gatherer {
  private lines: string[] = [];
  private trailingBlank = 0;
  private startLine = 0;
  private seen = false;

  constructor(private readonly collector: Collector) {}

  /** Adds one line; leading blank lines are dropped here, trailing ones when the message is closed. */
  push(line: string, number: number): void {
    const blank = line.trim() === '';
    if (!this.seen) {
      if (blank) return;
      this.seen = true;
      this.startLine = number;
    }
    if (this.collector.full) return;
    this.lines.push(line);
    this.trailingBlank = blank ? this.trailingBlank + 1 : 0;
    // Counted up to the last line that is not blank: blank lines at the end are dropped when the message is closed, so
    // the blank line before a separator or before git's next commit does not count. The paste limit bounds them.
    if (this.lines.length - this.trailingBlank > MAX_LINES_PER_MESSAGE) {
      throw new ConventionalCommitError(
        `Message ${this.collector.count + 1} has more than ${withCommas(MAX_LINES_PER_MESSAGE)} lines, the most this page reads in one message.`,
        'messages',
        this.startLine,
      );
    }
  }

  /** Ends the message being gathered. A message with nothing but blank lines is no message. */
  close(): void {
    if (this.seen) {
      if (this.collector.full) {
        this.collector.unread += 1;
      } else {
        this.lines.length -= this.trailingBlank;
        this.collector.add(this.lines, this.startLine);
      }
    }
    this.lines = [];
    this.trailingBlank = 0;
    this.startLine = 0;
    this.seen = false;
  }
}

function splitBySeparator(text: string, separator: string, collector: Collector): void {
  const gatherer = new Gatherer(collector);
  forEachLine(text, (line, number) => {
    checkLineLength(line, number);
    if (line.trim() === separator) gatherer.close();
    else gatherer.push(line, number);
  });
  gatherer.close();
}

function splitByLines(text: string, collector: Collector): void {
  forEachLine(text, (line, number) => {
    checkLineLength(line, number);
    if (line.trim() === '') return;
    if (collector.full) collector.unread += 1;
    else collector.add([line], number);
  });
}

function isHexCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
}

/** A `commit` line of `git log`: the word, a space, 7 to 64 hexadecimal digits, then the end of the line or a space. */
function isCommitLine(line: string): boolean {
  if (!line.startsWith('commit ')) return false;
  let i = 7;
  while (i < line.length && isHexCode(line.charCodeAt(i))) i++;
  const digits = i - 7;
  return digits >= 7 && digits <= 64 && (i === line.length || line.charCodeAt(i) === 32);
}

/** `git log` indents every line of a message by four spaces. */
function stripIndent(line: string): string {
  let i = 0;
  while (i < 4 && line.charCodeAt(i) === 32) i++;
  return i === 0 ? line : line.slice(i);
}

function splitGitLog(text: string, collector: Collector): void {
  const gatherer = new Gatherer(collector);
  let state: 'before' | 'header' | 'message' = 'before';
  forEachLine(text, (line, number) => {
    checkLineLength(line, number);
    if (isCommitLine(line)) {
      gatherer.close();
      state = 'header';
    } else if (state === 'header') {
      if (line.trim() === '') state = 'message';
    } else if (state === 'message') {
      gatherer.push(stripIndent(line), number);
    }
  });
  gatherer.close();
}

/**
 * Cuts a paste into messages. Mode `separator` ends a message at a line that equals the separator once white space is
 * trimmed (default `---`); mode `lines` takes every non-blank line as a message; mode `gitlog` reads the default output of
 * `git log`: a `commit` line, the `Author:` and `Date:` lines up to the first blank line, then the four-space indented
 * message. A separator that touches a message on either side splits it with nothing lost; two separators in a row, or one at
 * the start or the end, make no empty message; a message of blank lines only is no message. Messages are numbered together
 * with the lines git wrote itself (`Merge`, `Revert "`, `fixup!`, `squash!`, `amend!`, `#`), which are named in `skipped`
 * and not judged. After the 1,000th message the rest are counted in `unread` and not read.
 *
 * The paste length is checked first, then each line's length as it is read. One pass; no regular expression.
 */
export function splitMessages(
  text: string,
  mode: SplitMode = 'separator',
  separator: string = DEFAULT_SEPARATOR,
): SplitResult {
  checkPasteLength(text);
  const collector = new Collector();
  if (mode === 'separator') splitBySeparator(text, checkSeparator(separator), collector);
  else if (mode === 'lines') splitByLines(text, collector);
  else splitGitLog(text, collector);
  return { messages: collector.messages, skipped: collector.skipped, unread: collector.unread };
}
