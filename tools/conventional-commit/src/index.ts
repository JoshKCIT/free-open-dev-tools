import meta from './meta.json';
import { bumpFor, type BumpResult } from './bump';
import { parseMessage, type ParsedMessage } from './parse';
import { DEFAULT_SEPARATOR, splitMessages, type SkippedMessage, type SplitMode } from './split';

export { meta };

export { ConventionalCommitError } from './errors';
export type { ErrorField } from './errors';
export { bumpFor, bumpLevel } from './bump';
export type { BumpLevel, BumpResult } from './bump';
export { collapseWhite, footerStart, isWhiteCode, parseMessage } from './parse';
export type { Failure, Footer, ParsedMessage } from './parse';
export { DEFAULT_SEPARATOR, checkSeparator, skipKindOf, splitMessages } from './split';
export type { SkipKind, SkippedMessage, SplitMessage, SplitMode, SplitResult } from './split';
export { forEachLine, isBlank, splitLines } from './lines';
export {
  MAX_CHANGELOG_LINES,
  MAX_ENTRY_CHARACTERS,
  MAX_FOOTERS,
  MAX_LINES_PER_MESSAGE,
  MAX_LINE_CHARACTERS,
  MAX_MESSAGES,
  MAX_PASTE_CHARACTERS,
  MAX_SEPARATOR_CHARACTERS,
  MAX_SHOWN_CHARACTERS,
  MAX_SHOWN_HEADER,
  MAX_TABLE_ROWS,
  MAX_VERSION_CHARACTERS,
  checkLineLength,
  checkPasteLength,
  withCommas,
} from './limits';
export { visible } from './visible';

export interface CheckInput {
  /** The pasted text. */
  text: string;
  /** How the paste is cut into messages; default `separator`. */
  mode?: SplitMode;
  /** The separator line for mode `separator`; default `---`. */
  separator?: string;
}

/** One message of the paste with its verdict. */
export interface CheckedMessage {
  number: number;
  /** The pasted line number the message starts on. */
  line: number;
  parsed: ParsedMessage;
}

export interface CheckResult {
  /** The messages in pasted order, valid or not. */
  messages: CheckedMessage[];
  /** Lines git wrote itself, named and not judged. */
  skipped: SkippedMessage[];
  /** How many messages came after the 1,000th: counted and not read. */
  unread: number;
  bump: BumpResult;
}

/**
 * Checks pasted commit messages against Conventional Commits 1.0.0 and adds up the version bump. A message that breaks a
 * rule is a row of the result with its failures, never an error; the errors are refusals of the paste itself.
 */
export function checkCommits(input: CheckInput): CheckResult {
  const split = splitMessages(input.text, input.mode ?? 'separator', input.separator ?? DEFAULT_SEPARATOR);
  const messages = split.messages.map((m) => ({
    number: m.number,
    line: m.line,
    parsed: parseMessage(m.text, m.number),
  }));
  return {
    messages,
    skipped: split.skipped,
    unread: split.unread,
    bump: bumpFor(messages.map((m) => m.parsed)),
  };
}
