/**
 * Checks a branch or tag name the way `git check-ref-format --branch` does,
 * following the rules `git-check-ref-format`'s own DESCRIPTION section lists
 * (fetched from https://git-scm.com/docs/git-check-ref-format/2.52.0, the
 * page git-scm.com currently serves for git 2.55.0 -- the man page text has
 * not changed since 2.52.0, so git-scm.com redirects the newer version
 * number to it):
 *
 *   "They can include slash / for hierarchical (directory) grouping, but no
 *   slash-separated component can begin with a dot . or end with the
 *   sequence .lock. ... They cannot have two consecutive dots .. anywhere.
 *   They cannot have ASCII control characters ... space, tilde ~, caret ^,
 *   or colon : anywhere. They cannot have question-mark ?, asterisk *, or
 *   open bracket [ anywhere. ... They cannot begin or end with a slash / or
 *   contain multiple consecutive slashes ... They cannot end with a dot ..
 *   They cannot contain a sequence @{. They cannot be the single character
 *   @. They cannot contain a \."
 *
 * `--branch` mode additionally allows a one-level name with no slash at all
 * (confirmed by running the installed git: `git check-ref-format --branch
 * main` accepts a bare `main`, where plain `git check-ref-format main`
 * without `--allow-onelevel` refuses it), and refuses a name starting with a
 * hyphen -- confirmed the same way (`git check-ref-format --branch -u` and
 * `--branch --upload-pack=x` both refuse, "is not a valid branch name"),
 * because such a name would be read as an option by any command it is
 * passed to.
 *
 * Ambiguity, disclosed rather than guessed at: `--branch` mode also resolves
 * shorthand revision syntax such as `@{-1}` (the previously checked-out
 * branch) and `<branch>@{upstream}` against the caller's own repository
 * history -- confirmed empirically that `git check-ref-format --branch
 * @{-1}` fails outside any repository history and succeeds only after a
 * real checkout exists to resolve it against. This tool cannot see the
 * visitor's repository (AQ), so it does not attempt that resolution; a name
 * using this shorthand is refused with a message saying so. The one
 * exception is a bare `@`, confirmed to always succeed under `--branch`
 * (inside a repository, outside one, and in a freshly initialised repository
 * with no commits) as the literal shorthand for the current branch, so it is
 * accepted here without running it through the character rules.
 *
 * One more confirmed special case: `--branch` refuses the exact string
 * `HEAD` (but accepts `head`, `Head`, `MERGE_HEAD`, `FETCH_HEAD` and
 * `ORIG_HEAD` -- only the literal all-caps `HEAD` is reserved), presumably
 * because it already names the checked-out commit rather than a real branch
 * a visitor could create or refer to by that name.
 */

export class RefNameError extends Error {
  /** Which rule the name broke, in this project's own words. */
  readonly rule: string;

  constructor(name: string, rule: string) {
    super(`"${name}" is not a valid branch or tag name: ${rule}`);
    this.name = 'RefNameError';
    this.rule = rule;
  }
}

/** True for `@{...}` shorthand this tool cannot resolve without the visitor's own repository history. */
function isUnresolvableShorthand(name: string): boolean {
  return name !== '@' && /@\{/.test(name);
}

/**
 * Checks `name` against the rules above, throwing `RefNameError` naming the
 * broken rule when it is not acceptable, exactly mirroring
 * `git check-ref-format --branch` for every case this tool can decide
 * without the visitor's own repository (see the module header's disclosed
 * exception for `@{` shorthand).
 */
export function checkRefName(name: string): void {
  if (name === '') throw new RefNameError(name, 'a ref name cannot be empty.');
  if (name === '@') return; // the shorthand for the current branch; always accepted under --branch.
  if (name === 'HEAD') {
    throw new RefNameError(
      name,
      'HEAD already names the checked-out commit, not a branch you can create or refer to by that name.',
    );
  }

  if (name.startsWith('-')) {
    throw new RefNameError(name, 'a branch or tag name cannot start with a hyphen, or it could be read as an option.');
  }
  if (isUnresolvableShorthand(name)) {
    throw new RefNameError(
      name,
      "this looks like @{...} shorthand (for example the previously checked-out branch), which needs the visitor's own repository history to resolve and this tool cannot see it.",
    );
  }

  // "They cannot have ASCII control characters (i.e. bytes whose values are
  // lower than \040, or \177 DEL), space, tilde ~, caret ^, or colon : anywhere."
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  if (/[\x00-\x1f\x7f ~^:]/.test(name)) {
    throw new RefNameError(name, 'it cannot contain a control character, space, tilde ~, caret ^ or colon :.');
  }
  // "They cannot have question-mark ?, asterisk *, or open bracket [ anywhere."
  if (/[?*[]/.test(name)) {
    throw new RefNameError(name, 'it cannot contain a question mark ?, asterisk * or open bracket [.');
  }
  // "They cannot contain a \."
  if (name.includes('\\')) {
    throw new RefNameError(name, 'it cannot contain a backslash.');
  }
  // "They cannot have two consecutive dots .. anywhere."
  if (name.includes('..')) {
    throw new RefNameError(name, 'it cannot contain two consecutive dots ...');
  }
  // "They cannot begin or end with a slash / or contain multiple consecutive slashes."
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    throw new RefNameError(name, 'it cannot begin or end with a slash, or contain two slashes in a row.');
  }
  // "They cannot end with a dot .."
  if (name.endsWith('.')) {
    throw new RefNameError(name, 'it cannot end with a dot.');
  }
  // "They cannot contain a sequence @{."
  if (name.includes('@{')) {
    throw new RefNameError(name, 'it cannot contain the sequence @{.');
  }
  // "no slash-separated component can begin with a dot . or end with the sequence .lock"
  for (const part of name.split('/')) {
    if (part.startsWith('.')) {
      throw new RefNameError(name, `the part "${part}" cannot begin with a dot.`);
    }
    if (part.endsWith('.lock')) {
      throw new RefNameError(name, `the part "${part}" cannot end with ".lock".`);
    }
    if (part === '') {
      throw new RefNameError(name, 'it cannot contain an empty part between two slashes.');
    }
  }
}

/** True when `checkRefName` accepts `name`, without throwing. */
export function isValidRefName(name: string): boolean {
  try {
    checkRefName(name);
    return true;
  } catch {
    return false;
  }
}
