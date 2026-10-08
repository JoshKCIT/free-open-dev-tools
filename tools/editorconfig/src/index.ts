import meta from './meta.json';
import { checkPath, splitFiles } from './input';
import { resolveProperties, type Resolution } from './resolve';

export { meta };

export { EditorConfigError } from './errors';
export { compileGlob, matchGlob, newBudget } from './glob';
export type { Budget, Program } from './glob';
export { checkPath, fileLabel, folderLine, splitFiles } from './input';
export type { PastedFile } from './input';
export { forEachLine, splitLines } from './lines';
export {
  MAX_FILES,
  MAX_FOLDER,
  MAX_KEY,
  MAX_LINE_CHARACTERS,
  MAX_LISTED,
  MAX_PATH,
  MAX_RANGE_DIGITS,
  MAX_SECTION_NAME,
  MAX_SHOWN_CELL,
  MAX_SHOWN_CHARACTERS,
  MAX_TOTAL_CHARACTERS,
  MAX_TOTAL_LINES,
  MAX_VALUE,
  WORK_BUDGET,
  withCommas,
} from './limits';
export { parseEditorConfig } from './parse';
export type { ParseProblem, ParsedFile, ParsedPair, ParsedSection } from './parse';
export {
  REASON_ABOVE_ROOT,
  REASON_FILE_NOT_USED,
  REASON_NOT_ABOVE,
  REASON_NO_MATCH,
  resolveProperties,
} from './resolve';
export type { FileRow, HowSet, OverriddenRow, ProblemRow, PropertyRow, Resolution, SectionRow } from './resolve';
export { visible } from './visible';

/** The answer for a paste and a path: the resolution, and whether there was nothing to resolve. */
export interface EditorConfigResult extends Resolution {
  /** True when the paste or the path was empty: nothing was read and every list is empty. */
  empty: boolean;
}

/**
 * Works out which EditorConfig properties apply to a file path, from the text of one or more pasted `.editorconfig` files.
 * The text before the first `=== folder ===` line is the file at the top folder and each such line starts the file of that
 * folder; the path is relative to the top folder and uses forward slashes.
 *
 * An empty paste or an empty path gives an empty result. Anything over a limit is refused with an `EditorConfigError`
 * before any file is parsed: the path, then the size of the paste, its lines, its files and its folder lines. A file with
 * no section that matches is a result (no property applies), never an error.
 */
export function resolveEditorConfig(filesText: string, path: string): EditorConfigResult {
  if (filesText.trim() === '' || path.trim() === '') {
    return {
      empty: true,
      properties: [],
      overridden: [],
      filesUsed: [],
      filesNotUsed: [],
      sectionsMatched: [],
      sectionsNotMatched: [],
      problems: [],
      notes: [],
    };
  }
  checkPath(path);
  const files = splitFiles(filesText);
  return { empty: false, ...resolveProperties(files, path) };
}
