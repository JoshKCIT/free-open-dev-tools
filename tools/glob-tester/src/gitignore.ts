import ignore from 'ignore';
import { forEachLine, isBlank, parsePaths } from './lines';

/** What decided one path in .gitignore mode. */
export type DecidedBy =
  /** The last pattern line that matched the path itself; a negation (a line starting with !) is named too. */
  | { kind: 'rule'; line: number; pattern: string; negated: boolean }
  /** A directory above the path is excluded, and a file under an excluded directory cannot be re-included. */
  | { kind: 'parent'; directory: string; line: number; pattern: string }
  /** No pattern line matched. */
  | { kind: 'none' }
  /** The package decided but the deciding line could not be named; the page says so in words. */
  | { kind: 'text' };

/** One path's answer in .gitignore mode. */
export interface GitignoreRow {
  /** The path as pasted, without the `/` that marks a directory. */
  path: string;
  isDirectory: boolean;
  ignored: boolean;
  decidedBy: DecidedBy;
}

type Engine = ReturnType<typeof ignore>;

/** What the package reported for a target: the line of the first rule of the last run of matching rules, when it says. */
type Hint = number | undefined;

interface Rule {
  line: number;
  /** The line as pasted, for showing. */
  text: string;
  /** The line as the rule engine reads it: the pasted line with its unquoted trailing spaces taken off. */
  pattern: string;
}

const BACKSLASH = 92;
const SPACE = 32;

/**
 * Takes the trailing spaces off a pattern line, as the gitignore documentation describes ("Trailing spaces are ignored
 * unless they are quoted with backslash"). A backslash quotes the character after it, so the line is read from the
 * start, skipping each backslash and the character it quotes; only the final run of unquoted spaces is dropped. A space
 * that follows a quoted backslash is not quoted itself and goes, one that is quoted stays. Only the space character
 * counts: a trailing tab stays.
 */
export function withoutTrailingSpaces(line: string): string {
  let keep = 0;
  for (let i = 0; i < line.length; i++) {
    const unit = line.charCodeAt(i);
    if (unit === BACKSLASH) {
      i += 1;
      keep = Math.min(i + 1, line.length);
    } else if (unit !== SPACE) {
      keep = i + 1;
    }
  }
  return line.slice(0, keep);
}

/** How many rules share one engine when the last matching rule is looked for. */
const BLOCK_SIZE = 32;

/**
 * Decides each pasted path with the `ignore` package (version 7.0.9, case-sensitive, as one .gitignore at the top of a
 * repository) and names the pasted line that decided it.
 *
 * The package decides whether the path is ignored: every pattern line is handed to it as a rule marked with its pasted
 * line number, and `test()` answers for the path and its parent directories. The package names the first matching
 * positive rule of the last run and never a negation, but git names the last matching line, negations included, so the
 * deciding line is found with more questions to the same package, each about a smaller group of the rules.
 *
 * An engine holding the rules from line j to the end of a group says whether any of them matches a path, and that
 * answer only turns from yes to no once j passes the last matching line, so a binary search over j finds the line.
 * Groups of 32 rules are tried from the last backwards first, so a path whose last match is near the end of a long list
 * costs little. A group answers for its own rules alone only when no directory above the path was matched by any rule
 * (a rule that excludes a directory that a later negation re-includes would otherwise make every group look like a
 * match); when one was, the search runs over engines holding every rule from j to the very end, which is always exact.
 * That search starts from what the package itself reported for the path: when the path is ignored, the package names
 * the first rule of the last run of matching rules, the deciding line is that one or a later one, and a single question
 * to the engine holding every rule after it says which, so a path costs about the number of rules after the line that
 * decides it, not a search over all of them. An answer is kept for every distinct target, so paths that sit under the
 * same excluded directory share the work.
 *
 * A directory path ends in `/`, as the package expects.
 */
export function gitignoreRows(text: string, paths: string): GitignoreRow[] {
  const rules: Rule[] = [];
  /** The index in `rules` of each rule, by its pasted line number. */
  const indexOfLine = new Map<number, number>();
  const full = ignore({ ignorecase: false });
  forEachLine(text, (lineText, line) => {
    if (isBlank(lineText)) return;
    const pattern = withoutTrailingSpaces(lineText);
    // A line holding only a ! names no pattern, and git matches nothing with it. The line still counts in the line
    // numbers (they come from the pasted text), but it is given to no engine, as a comment is given to none.
    if (pattern === '!') return;
    indexOfLine.set(line, rules.length);
    rules.push({ line, text: lineText, pattern });
    full.add({ pattern, mark: String(line) });
  });

  // Every path is checked before the first one is decided, so a refusal never follows partial work.
  const parsed = parsePaths(paths);

  // chain(from, to)[i] holds the rules from index from + i to index to (inclusive). Each engine shares the rule objects
  // of the next one, so building a chain costs one small copy per engine.
  const buildChain = (from: number, to: number): Engine[] => {
    const built: Engine[] = new Array<Engine>(to - from + 1);
    for (let j = to; j >= from; j--) {
      const rule = rules[j] as Rule;
      const engine = ignore({ ignorecase: false }).add({ pattern: rule.pattern, mark: String(rule.line) });
      const next = built[j + 1 - from];
      if (next !== undefined) engine.add(next);
      built[j - from] = engine;
    }
    return built;
  };

  // Built on first need: a path that no rule touches never needs any of them.
  let everything: Engine[] | undefined;
  const blocks: (Engine[] | undefined)[] = [];
  const blockCount = Math.ceil(rules.length / BLOCK_SIZE);
  const blockChain = (b: number): Engine[] => {
    let chain = blocks[b];
    if (chain === undefined) {
      chain = buildChain(b * BLOCK_SIZE, Math.min(rules.length, (b + 1) * BLOCK_SIZE) - 1);
      blocks[b] = chain;
    }
    return chain;
  };

  const hintOf = (answer: { ignored: boolean; rule?: { mark?: string } }): Hint => {
    const mark = answer.ignored ? answer.rule?.mark : undefined;
    return mark === undefined ? undefined : Number(mark);
  };

  const matches = (engine: Engine, target: string): boolean => {
    const answer = engine.test(target);
    return answer.ignored || answer.unignored;
  };

  // The index of the last rule that matches `target` (a path, or a directory ending in `/`), or -1. `exact` is true
  // when some directory above the target was matched by a rule, which is the one case a group cannot answer alone.
  const lastMatching = (target: string, exact: boolean, hint: Hint): number => {
    const remembered = known.get(target);
    if (remembered !== undefined) return remembered;
    const found = findLast(target, exact, hint);
    known.set(target, found);
    return found;
  };

  const known = new Map<string, number>();

  const findLast = (target: string, exact: boolean, hint: Hint): number => {
    if (exact) {
      everything ??= buildChain(0, rules.length - 1);
      const first = hint === undefined ? undefined : indexOfLine.get(hint);
      if (first !== undefined) {
        // The rule the package named matches the target, and the last matching rule is that one or a later one.
        if (first + 1 >= rules.length || !matches(everything[first + 1] as Engine, target)) return first;
        return searchChain(everything, 0, target, first + 1);
      }
      return searchChain(everything, 0, target);
    }
    for (let b = blockCount - 1; b >= 0; b--) {
      const chain = blockChain(b);
      if (matches(chain[0] as Engine, target)) return searchChain(chain, b * BLOCK_SIZE, target);
    }
    return -1;
  };

  // The largest i for which chain[i] matches the target (chain[0] is known to, and so is chain[from]), as an index into the
  // rules.
  const searchChain = (chain: Engine[], offset: number, target: string, from = 0): number => {
    let low = from;
    let high = chain.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (matches(chain[mid] as Engine, target)) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found < 0 ? -1 : offset + found;
  };

  const rows: GitignoreRow[] = [];
  const decided = new Map<string, GitignoreRow>();
  for (const { path, isDirectory } of parsed) {
    const key = isDirectory ? path + '/' : path;
    const known = decided.get(key);
    if (known !== undefined) {
      rows.push({ ...known });
      continue;
    }
    const answer = full.test(key);
    let row: GitignoreRow;
    if (!answer.ignored && !answer.unignored) {
      row = { path, isDirectory, ignored: false, decidedBy: { kind: 'none' } };
    } else {
      row = { path, isDirectory, ignored: answer.ignored, decidedBy: { kind: 'text' } };
      // The first excluded directory above the path decides it: nothing below it can be re-included.
      let excluded = '';
      let excludedHint: Hint;
      let touched = false;
      let slash = path.indexOf('/');
      while (slash >= 0) {
        const directory = path.slice(0, slash + 1);
        const above = full.test(directory);
        if (above.ignored) {
          excluded = directory;
          excludedHint = hintOf(above);
          break;
        }
        if (above.unignored) touched = true;
        slash = path.indexOf('/', slash + 1);
      }
      if (excluded !== '') {
        const index = lastMatching(excluded, touched, excludedHint);
        const rule = index < 0 ? undefined : (rules[index] as Rule);
        if (rule !== undefined && !rule.pattern.startsWith('!')) {
          row.decidedBy = { kind: 'parent', directory: excluded, line: rule.line, pattern: rule.text };
        }
      } else {
        const index = lastMatching(key, touched, hintOf(answer));
        const rule = index < 0 ? undefined : (rules[index] as Rule);
        // The named rule must agree with the package's answer: a rule that is not a negation ignores the path.
        if (rule !== undefined && rule.pattern.startsWith('!') === !answer.ignored) {
          row.decidedBy = { kind: 'rule', line: rule.line, pattern: rule.text, negated: rule.pattern.startsWith('!') };
        }
      }
    }
    decided.set(key, row);
    rows.push({ ...row });
  }
  return rows;
}
