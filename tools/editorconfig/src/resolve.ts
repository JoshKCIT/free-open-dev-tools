import { EditorConfigError } from './errors';
import { compileGlob, matchGlob, newBudget, type Budget, type Program } from './glob';
import { checkPath, type PastedFile } from './input';
import { parseEditorConfig, type ParsedFile } from './parse';

/** How a property got its value: written in a section, written as `unset`, or worked out from another property. */
export type HowSet = 'set' | 'unset' | 'derived';

/** One property that applies to the path, with the place that decided it. */
export interface PropertyRow {
  key: string;
  value: string;
  how: HowSet;
  /** The on-screen name of the file that decided it, such as `src/.editorconfig`. */
  file: string;
  /** The section name that decided it, without its brackets. */
  section: string;
  /** The line of that file the pair is on. */
  line: number;
  /** For a derived property, the property it was worked out from. */
  from?: string;
}

/** An earlier setting that a later one replaced. */
export interface OverriddenRow {
  key: string;
  value: string;
  file: string;
  section: string;
  line: number;
  /** The setting that replaced it. */
  byFile: string;
  bySection: string;
  byLine: number;
}

export interface FileRow {
  label: string;
  folder: string;
  /** Why a file was not used; absent for a file that was. */
  reason?: string;
  /** True for a used file that sets root to true, so the search stopped there. */
  root?: true;
}

export interface SectionRow {
  file: string;
  /** The section name, without its brackets. */
  section: string;
  line: number;
  /** Why a section did not match; absent for one that did. */
  reason?: string;
}

export interface ProblemRow {
  file: string;
  line: number;
  message: string;
}

export interface Resolution {
  /** The properties that apply, in the order they were first set. */
  properties: PropertyRow[];
  overridden: OverriddenRow[];
  filesUsed: FileRow[];
  filesNotUsed: FileRow[];
  sectionsMatched: SectionRow[];
  sectionsNotMatched: SectionRow[];
  /** Lines of the files that the format has no place for, skipped. */
  problems: ProblemRow[];
  /** Plain sentences about how the answer was reached, such as a path that holds a backslash. */
  notes: string[];
}

export const REASON_NOT_ABOVE = 'it is not in a folder above the path';
export const REASON_ABOVE_ROOT = 'it is above a file that sets root to true';
export const REASON_FILE_NOT_USED = 'its file is not used';
export const REASON_NO_MATCH = 'the section name does not match the path';

/** The properties whose values the specification reads without regard to case; the reference cores lower-case them. */
const LOWER_CASE_KEYS: ReadonlySet<string> = new Set([
  'indent_style',
  'indent_size',
  'tab_width',
  'end_of_line',
  'charset',
  'insert_final_newline',
  'trim_trailing_whitespace',
]);

const UNSET = 'unset';

function depthOf(folder: string): number {
  if (folder === '') return 0;
  let depth = 1;
  for (let i = 0; i < folder.length; i++) if (folder.charCodeAt(i) === 47) depth += 1;
  return depth;
}

interface Setting {
  key: string;
  value: string;
  how: HowSet;
  file: string;
  section: string;
  line: number;
  from?: string;
}

/**
 * Works out which properties apply to a path.
 *
 * The files whose folder is above the path are read from the nearest folder up, and the search stops after the first file
 * whose lines before its first section hold `root = true`. The files that are used are then applied from the farthest to
 * the nearest, and inside a file from the top section to the bottom one, so a later section and a closer file win. Each
 * section name is a glob matched against the path as seen from its file's folder. For every property the result keeps the
 * file, section and line that set it, and every earlier setting it replaced.
 *
 * The values the reference cores work out are added: `indent_style = tab` without an `indent_size` gives `indent_size =
 * tab`; `indent_size = tab` with a `tab_width` takes that width; a number or `unset` in `indent_size` without a `tab_width`
 * gives the same `tab_width`. The values of the known properties are lower-cased and `unset` is reported as the value
 * `unset`, as the cores report it.
 *
 * Pure: the result depends on the files and the path alone, and the properties come out in the order they were first set.
 */
export function resolveProperties(
  files: readonly PastedFile[],
  path: string,
  budget: Budget = newBudget(),
): Resolution {
  checkPath(path);
  const result: Resolution = {
    properties: [],
    overridden: [],
    filesUsed: [],
    filesNotUsed: [],
    sectionsMatched: [],
    sectionsNotMatched: [],
    problems: [],
    notes: [],
  };
  if (path.includes('\\')) {
    result.notes.push(
      'The path holds a backslash. A backslash is an ordinary character here, because paths use forward slashes, so it is matched as written.',
    );
  }

  const parsed = new Map<PastedFile, ParsedFile>();
  for (const file of files) parsed.set(file, parseEditorConfig(file.text, `File ${file.number}`));

  const ordered = [...files].sort((a, b) => depthOf(a.folder) - depthOf(b.folder) || a.number - b.number);
  const above = ordered.filter((file) => file.folder === '' || path.startsWith(`${file.folder}/`));
  const used = new Set<PastedFile>();
  for (let i = above.length - 1; i >= 0; i--) {
    const file = above[i];
    if (file === undefined) continue;
    used.add(file);
    if (parsed.get(file)?.root === true) break;
  }

  const programs = new Map<string, Program>();
  const settings = new Map<string, Setting>();

  for (const file of ordered) {
    const content = parsed.get(file);
    if (content === undefined) continue;
    for (const problem of content.problems) {
      result.problems.push({ file: file.label, line: problem.line, message: problem.message });
    }
    if (!used.has(file)) {
      const reason = above.includes(file) ? REASON_ABOVE_ROOT : REASON_NOT_ABOVE;
      result.filesNotUsed.push({ label: file.label, folder: file.folder, reason });
      for (const section of content.sections) {
        result.sectionsNotMatched.push({
          file: file.label,
          section: section.name,
          line: section.line,
          reason: REASON_FILE_NOT_USED,
        });
      }
      continue;
    }
    result.filesUsed.push(
      content.root
        ? { label: file.label, folder: file.folder, root: true }
        : { label: file.label, folder: file.folder },
    );
    const relative = file.folder === '' ? path : path.slice(file.folder.length + 1);
    for (const section of content.sections) {
      let program = programs.get(section.name);
      let matched = false;
      try {
        if (program === undefined) {
          program = compileGlob(section.name);
          programs.set(section.name, program);
        }
        matched = matchGlob(program, relative, budget);
      } catch (err) {
        if (err instanceof EditorConfigError && err.file === undefined) {
          throw new EditorConfigError(err.reason, `File ${file.number}`, section.line);
        }
        throw err;
      }
      if (!matched) {
        result.sectionsNotMatched.push({
          file: file.label,
          section: section.name,
          line: section.line,
          reason: REASON_NO_MATCH,
        });
        continue;
      }
      result.sectionsMatched.push({ file: file.label, section: section.name, line: section.line });
      for (const pair of section.pairs) {
        const value = LOWER_CASE_KEYS.has(pair.key) ? pair.value.toLowerCase() : pair.value;
        const before = settings.get(pair.key);
        if (before !== undefined) {
          result.overridden.push({
            key: before.key,
            value: before.value,
            file: before.file,
            section: before.section,
            line: before.line,
            byFile: file.label,
            bySection: section.name,
            byLine: pair.line,
          });
        }
        settings.set(pair.key, {
          key: pair.key,
          value,
          how: value.toLowerCase() === UNSET ? 'unset' : 'set',
          file: file.label,
          section: section.name,
          line: pair.line,
        });
      }
    }
  }

  deriveValues(settings, result);
  for (const setting of settings.values()) result.properties.push(setting);
  return result;
}

/** The derived values of the reference cores, added after every section has been applied. */
function deriveValues(settings: Map<string, Setting>, result: Resolution): void {
  const style = settings.get('indent_style');
  const size = settings.get('indent_size');
  const width = settings.get('tab_width');
  // unset is copied too, as the reference cores copy it: they treat unset as an ordinary value in these rules.
  const widthIsSet = width !== undefined;
  if (style !== undefined && style.value === 'tab' && size === undefined) {
    const source = widthIsSet ? width : style;
    settings.set('indent_size', derived('indent_size', widthIsSet ? width.value : 'tab', source));
  } else if (size !== undefined && size.value === 'tab' && widthIsSet) {
    result.overridden.push({
      key: size.key,
      value: size.value,
      file: size.file,
      section: size.section,
      line: size.line,
      byFile: width.file,
      bySection: width.section,
      byLine: width.line,
    });
    settings.set('indent_size', derived('indent_size', width.value, width));
  }
  const nowSize = settings.get('indent_size');
  if (nowSize !== undefined && nowSize.how === 'derived' && nowSize.value === UNSET && width?.value === UNSET) {
    result.notes.push(
      'indent_size is reported as unset because tab_width is unset: the reference cores copy it that way.',
    );
  }
  if (nowSize !== undefined && nowSize.value !== 'tab' && width === undefined) {
    settings.set('tab_width', derived('tab_width', nowSize.value, nowSize));
    if (nowSize.value === UNSET) {
      result.notes.push(
        'tab_width is reported as unset because indent_size is unset: the reference cores derive it that way.',
      );
    }
  }
}

function derived(key: string, value: string, source: Setting): Setting {
  return {
    key,
    value,
    how: 'derived',
    file: source.file,
    section: source.section,
    line: source.line,
    from: source.key,
  };
}
