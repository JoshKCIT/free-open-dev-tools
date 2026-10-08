import meta from './meta.json';
import { adviceFor, type AdviceLabel } from './advice';
import { bumpFor, currentVersionOf, type BumpResult } from './bump';
import { changelogFor } from './changelog';
import { checkPasteLength } from './limits';
import { parseMessage, type ParsedMessage } from './parse';
import { DEFAULT_SEPARATOR, checkSeparator, splitMessages, type SkippedMessage, type SplitMode } from './split';

export { meta };

export { adviceFor } from './advice';
export type { AdviceItem, AdviceLabel } from './advice';
export { ConventionalCommitError } from './errors';
export type { ErrorField } from './errors';
export { bumpFor, bumpLevel, currentVersionOf } from './bump';
export type { BumpOptions, BumpResult } from './bump';
export { changelogFor } from './changelog';
export type { ChangelogOptions } from './changelog';
export { collapseWhite, footerStart, isWhiteCode, parseMessage } from './parse';
export type { Failure, Footer, ParsedMessage } from './parse';
export { formatVersion, increment, parseVersion } from './semver';
export type { BumpLevel, Version } from './semver';
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
  /** The current version, as text, to work out the next one; empty or absent for none. */
  currentVersion?: string;
  /** Raise the minor number for a breaking change while the major number is 0. */
  zeroMajor?: boolean;
  /** Also list the hidden types (docs, style, chore, test, build, ci, refactor) and every other type in the changelog. */
  includeHidden?: boolean;
  /** Collect convention notes; default true. They never change a verdict, the bump or the changelog. */
  advice?: boolean;
}

/** One message of the paste with its verdict. */
export interface CheckedMessage {
  /** The position among everything cut out of the paste, lines git wrote itself included, starting at 1. */
  number: number;
  /** The pasted line number the message starts on. */
  line: number;
  parsed: ParsedMessage;
}

/** One note about one message. */
export interface AdviceEntry {
  /** The number of the message the note is about. */
  number: number;
  code: string;
  label: AdviceLabel;
  message: string;
}

export interface CheckResult {
  /** The messages in pasted order, valid or not. */
  messages: CheckedMessage[];
  /** Lines git wrote itself, named and not judged. */
  skipped: SkippedMessage[];
  /** How many messages came after the 1,000th: counted and not read. */
  unread: number;
  bump: BumpResult;
  /** The draft changelog in Markdown; empty when there is nothing to list. */
  changelog: string;
  /** Convention notes, in the order of the messages. */
  advice: AdviceEntry[];
}

/**
 * Checks pasted commit messages against Conventional Commits 1.0.0, adds up the version bump and drafts a changelog. A
 * message that breaks a rule is a row of the result with its failures, never an error; the errors are refusals of the
 * paste itself (too long, a separator that is empty or too long, a version that is not a version), checked in that order
 * before the paste is cut, and then the limits of lines, messages and footers as it is read.
 */
export function checkCommits(input: CheckInput): CheckResult {
  checkPasteLength(input.text);
  const mode = input.mode ?? 'separator';
  const separator = input.separator ?? DEFAULT_SEPARATOR;
  if (mode === 'separator') checkSeparator(separator);
  currentVersionOf(input.currentVersion);

  const split = splitMessages(input.text, mode, separator);
  const messages: CheckedMessage[] = [];
  const advice: AdviceEntry[] = [];
  for (const message of split.messages) {
    const parsed = parseMessage(message.text, message.number);
    messages.push({ number: message.number, line: message.line, parsed });
    if (input.advice !== false) {
      for (const note of adviceFor(parsed, message.text)) advice.push({ number: message.number, ...note });
    }
  }
  const parsedList = messages.map((m) => m.parsed);
  return {
    messages,
    skipped: split.skipped,
    unread: split.unread,
    bump: bumpFor(parsedList, {
      ...(input.currentVersion === undefined ? {} : { currentVersion: input.currentVersion }),
      zeroMajor: input.zeroMajor === true,
    }),
    changelog: changelogFor(parsedList, { includeHidden: input.includeHidden === true }),
    advice,
  };
}
