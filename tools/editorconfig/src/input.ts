import { EditorConfigError } from './errors';
import { forEachLine } from './lines';
import {
  MAX_FILES,
  MAX_FOLDER,
  MAX_LINE_CHARACTERS,
  MAX_PATH,
  MAX_TOTAL_CHARACTERS,
  MAX_TOTAL_LINES,
  withCommas,
} from './limits';

/** One file of the paste: the text under the top of the paste, or under one `=== folder ===` line. */
export interface PastedFile {
  /** Which file of the paste this is, counting from 1 in pasted order. */
  number: number;
  /** The folder the file lives in, relative to the top folder, with forward slashes; empty for the top folder. */
  folder: string;
  /** What the file is called on screen: `.editorconfig` for the top folder and `src/lib/.editorconfig` for `src/lib`. */
  label: string;
  /** The text of the file, one line end between lines. */
  text: string;
  /** The line of the whole paste the first line of this file is on. */
  firstLine: number;
}

/** The on-screen name of the file in a folder. */
export function fileLabel(folder: string): string {
  return folder === '' ? '.editorconfig' : `${folder}/.editorconfig`;
}

const SLASH = 0x2f;
const EQUALS = 0x3d;

/**
 * Reads a line as a folder line, `=== src/lib ===`: three or more equals signs, the folder, three or more equals signs.
 * Returns null for any other line. An EditorConfig file reads such a line as a pair with an empty key, which the reference
 * cores skip, so the marker cannot change what a real file means. A line made only of equals signs (a decorative rule some
 * hand-written files carry) is not a folder line: it stays in its file and is listed as a skipped line, the way the
 * reference cores skip it.
 */
export function folderLine(line: string): string | null {
  const text = line.trim();
  if (text.length < 7) return null;
  let left = 0;
  while (left < text.length && text.charCodeAt(left) === EQUALS) left += 1;
  let right = text.length;
  while (right > 0 && text.charCodeAt(right - 1) === EQUALS) right -= 1;
  if (left < 3 || text.length - right < 3) return null;
  if (right <= left) return null;
  return text.slice(left, right).trim();
}

/** Refuses a folder name the paste cannot use, naming the line of the paste. The name is never repeated. */
function checkFolder(folder: string, pasteLine: number): void {
  if (folder === '') throw new EditorConfigError('the folder line holds no folder name.', undefined, pasteLine);
  if (folder.length > MAX_FOLDER) {
    throw new EditorConfigError(
      `the folder name is ${withCommas(folder.length)} characters long and this page reads names of at most ${withCommas(MAX_FOLDER)}.`,
      undefined,
      pasteLine,
    );
  }
  if (folder.includes('\\')) {
    throw new EditorConfigError('a folder name uses forward slashes, never a backslash.', undefined, pasteLine);
  }
  if (folder.charCodeAt(0) === SLASH) {
    throw new EditorConfigError(
      'a folder name is relative to the top folder, so it cannot start with a slash.',
      undefined,
      pasteLine,
    );
  }
  for (const part of folder.split('/')) {
    if (part === '') {
      throw new EditorConfigError(
        'a folder name cannot hold an empty part: two slashes in a row or a slash at the end.',
        undefined,
        pasteLine,
      );
    }
    if (part === '.' || part === '..') {
      throw new EditorConfigError('a folder name cannot hold a . or .. part.', undefined, pasteLine);
    }
  }
}

/**
 * Refuses a file path the page cannot match, before anything else is done with it: over 1,024 characters, a leading slash,
 * an empty part or a . or .. part. A backslash is an ordinary character. The path is never repeated in the message.
 */
export function checkPath(path: string): void {
  if (path.length > MAX_PATH) {
    throw new EditorConfigError(
      `The path is ${withCommas(path.length)} characters long and this page reads paths of at most ${withCommas(MAX_PATH)}.`,
    );
  }
  if (path.charCodeAt(0) === SLASH) {
    throw new EditorConfigError('The path is relative to the top folder, so it cannot start with a slash.');
  }
  for (const part of path.split('/')) {
    if (part === '') {
      throw new EditorConfigError('The path cannot hold an empty part: two slashes in a row or a slash at the end.');
    }
    if (part === '.' || part === '..') {
      throw new EditorConfigError('The path cannot hold a . or .. part.');
    }
  }
}

/**
 * Cuts a paste into files. The text before the first folder line is the file of the top folder (left out when it holds
 * nothing but white space), and each `=== folder ===` line starts the file of that folder.
 *
 * Every limit is checked here, before any file is parsed: a paste over 1,000,000 characters, more than 10,000 lines, a line
 * over 8,192 characters, more than 50 files, a folder line the paste cannot use, or a folder given twice.
 */
export function splitFiles(text: string): PastedFile[] {
  if (text.length > MAX_TOTAL_CHARACTERS) {
    throw new EditorConfigError(
      `The paste is ${withCommas(text.length)} characters long and this page reads at most ${withCommas(MAX_TOTAL_CHARACTERS)}.`,
    );
  }
  const files: PastedFile[] = [];
  const folders = new Set<string>();
  let folder = '';
  let first = 1;
  let isTop = true;
  let lines: string[] = [];
  let content = false;

  const close = (): void => {
    if (isTop && !content) return;
    if (files.length >= MAX_FILES) {
      throw new EditorConfigError(
        `The paste holds more than ${MAX_FILES} files and this page reads at most ${MAX_FILES}.`,
      );
    }
    files.push({
      number: files.length + 1,
      folder,
      label: fileLabel(folder),
      text: lines.join('\n'),
      firstLine: first,
    });
  };

  forEachLine(text, (line, number, last) => {
    if (number > MAX_TOTAL_LINES && !(last && line === '')) {
      throw new EditorConfigError(
        `The paste holds more than ${withCommas(MAX_TOTAL_LINES)} lines and this page reads at most ${withCommas(MAX_TOTAL_LINES)}.`,
      );
    }
    if (line.length > MAX_LINE_CHARACTERS) {
      throw new EditorConfigError(
        `the line is ${withCommas(line.length)} characters long and this page reads lines of at most ${withCommas(MAX_LINE_CHARACTERS)}.`,
        `File ${files.length + 1}`,
        number - first + 1,
      );
    }
    const named = folderLine(line);
    if (named === null) {
      lines.push(line);
      if (!content && line.trim() !== '') content = true;
      return;
    }
    checkFolder(named, number);
    if (folders.has(named)) {
      throw new EditorConfigError('a folder is given twice; give the file of each folder once.', undefined, number);
    }
    folders.add(named);
    close();
    folder = named;
    first = number + 1;
    isTop = false;
    lines = [];
    content = false;
  });
  close();
  return files;
}
