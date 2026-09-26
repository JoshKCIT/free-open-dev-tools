import meta from './meta.json';
import { COMMANDS, findCommand, type GitCommandSpec, type GitFlagSpec, type GitPositionalSpec } from './catalogue';
import { checkRefName, RefNameError } from './refname';
import { posixSingleQuote, powershellSingleQuote, ShellLiteralError } from './shell-literal';

export { meta, COMMANDS, findCommand };
export type { GitCommandSpec, GitFlagSpec, GitPositionalSpec };
export { GIT_DOCS_VERSION } from './catalogue';
export { checkRefName, isValidRefName, RefNameError } from './refname';

export class GitCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export type Shell = 'posix' | 'powershell';

export interface BuildGitCommandRequest {
  /** One of `COMMANDS`' own names, e.g. "commit". */
  command: string;
  /** Required only for `stash`, one of its subcommand names. */
  subcommand?: string;
  /** Keyed by a flag's canonical `flag` string (e.g. "--message"). A boolean flag is included when its value is `true`; a valued flag is included when its value is a non-empty string or a finite number. */
  flags?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** One value per positional, in the command's own declared order. */
  positionals?: readonly (string | undefined)[];
  shell: Shell;
}

export interface BuildGitCommandResult {
  argv: string[];
  /** `argv`, quoted for `shell` and joined with spaces -- always the whole command as one line. */
  text: string;
  /** One line per flag actually used, its explanation and documentation link. */
  explanations: { flag: string; explanation: string; docsUrl: string }[];
  /** One line per destructive flag actually used. */
  warnings: string[];
}

/**
 * Characters that need no quoting at all in either shell this tool targets:
 * letters, digits and `-_./:=@,+`. Anything else goes through the shared
 * single-quote writer.
 */
const SAFE_BARE = /^[A-Za-z0-9\-_./:=@,+]+$/;

function assertNoNul(value: string, what: string): void {
  if (value.includes('\0')) {
    throw new GitCommandError(`${what} cannot contain a NUL character.`);
  }
}

function quoteArg(arg: string, shell: Shell): string {
  if (arg !== '' && SAFE_BARE.test(arg)) return arg;
  try {
    return shell === 'posix' ? posixSingleQuote(arg) : powershellSingleQuote(arg);
  } catch (err) {
    if (err instanceof ShellLiteralError) throw new GitCommandError(err.message);
    throw err;
  }
}

/**
 * True for a value the WHATWG URL parser accepts, or for the scp-like syntax
 * git-clone's own "GIT URLS" section documents: `[<user>@]<host>:/<path>`,
 * "only recognized if there are no slashes before the first colon" -- the
 * same rule this function applies, which is why (as git's own page goes on
 * to say) a local path containing a colon before any slash, such as a
 * Windows drive path, is genuinely ambiguous with this syntax; this tool
 * does not try to resolve that ambiguity any better than git itself does.
 */
function looksLikeScpUrl(value: string): boolean {
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) return false;
  const before = value.slice(0, colonIndex);
  const after = value.slice(colonIndex + 1);
  if (before.includes('/') || before.includes(' ') || before.includes('\t')) return false;
  return after.length > 0;
}

function isValidGitUrl(value: string): boolean {
  if (value.startsWith('-')) return false;
  try {
    // eslint-disable-next-line no-new -- only used to validate; the URL object itself is not needed.
    new URL(value);
    return true;
  } catch {
    return looksLikeScpUrl(value);
  }
}

function flagValueToString(raw: string | number | boolean | undefined): string | undefined {
  if (raw === undefined || raw === false || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : undefined;
  if (raw === true) return undefined; // boolean flags are handled separately; a `true` value flag has no text.
  return raw;
}

/** Applies one flag spec against the request's flag map, mutating the accumulators when the flag is used. */
function applyFlag(
  spec: GitFlagSpec,
  flagsIn: Readonly<Record<string, string | number | boolean | undefined>>,
  argv: string[],
  explanations: BuildGitCommandResult['explanations'],
  warnings: string[],
): void {
  const raw = flagsIn[spec.flag];
  if (spec.value) {
    const value = flagValueToString(raw);
    if (value === undefined) return;
    assertNoNul(value, `The value for ${spec.flag}`);
    argv.push(`${spec.flag}=${value}`);
  } else {
    if (raw !== true) return;
    argv.push(spec.flag);
  }
  explanations.push({ flag: spec.flag, explanation: spec.explanation, docsUrl: spec.docsUrl });
  if (spec.danger) warnings.push(spec.danger);
}

/**
 * Assembles a git command from a chosen command, its flags and its
 * positionals, for either a POSIX shell or PowerShell (`buildGitCommand`,
 * per 07-01 AM3's own-words rule -- no git documentation sentence is copied
 * into this function; only option identifiers and this project's own
 * explanations appear here).
 *
 * Every valued flag is written in the stuck form (`--name=value`), which
 * gitcli's own OPTIONS section recommends: "When a command-line option takes
 * an argument, use the stuck form. ... write git foo --long-opt=Arg instead
 * of git foo --long-opt Arg for long options." Every argument is quoted
 * through the copied `posixSingleQuote`/`powershellSingleQuote` writer,
 * always quoting the WHOLE argument rather than only the part after `=`,
 * because PowerShell's own handling of a partly-quoted native argument
 * differs between versions. A ref-kind positional is checked with
 * `checkRefName`, which already refuses a leading hyphen on its own; a
 * revision-kind positional that starts with a hyphen is placed after a
 * literal `--end-of-options` (gitcli: "You can use --end-of-options for
 * this (it also works for commands that do not distinguish between
 * revisions in paths, in which case it is simply an alias for --)"); a
 * path-kind positional is always placed after a literal `--`; a url-kind
 * positional must parse as a URL or the documented scp-like form and may
 * not start with a hyphen. A NUL character anywhere throws `GitCommandError`
 * (via the copied `ShellLiteralError`), since no shell argument can hold one.
 */
export function buildGitCommand(request: BuildGitCommandRequest): BuildGitCommandResult {
  const spec = findCommand(request.command);
  if (!spec) throw new GitCommandError(`"${request.command}" is not one of the commands this tool knows.`);

  const argv: string[] = ['git', spec.name];
  const explanations: BuildGitCommandResult['explanations'] = [];
  const warnings: string[] = [];
  const flagsIn = request.flags ?? {};

  let flagSpecs: readonly GitFlagSpec[] = spec.flags;
  if (spec.subcommands) {
    const sub = spec.subcommands.find((s) => s.name === request.subcommand);
    if (!sub) {
      throw new GitCommandError(
        `"${request.command}" needs one of these subcommands: ${spec.subcommands.map((s) => s.name).join(', ')}.`,
      );
    }
    argv.push(sub.name);
    flagSpecs = sub.flags;
    if (sub.danger) warnings.push(sub.danger);
  }

  for (const flagSpec of flagSpecs) {
    applyFlag(flagSpec, flagsIn, argv, explanations, warnings);
  }

  const positionalsIn = request.positionals ?? [];
  const positionalArgs: string[] = [];
  let needsEndOfOptions = false;
  let hasPath = false;

  spec.positionals.forEach((posSpec, index) => {
    const raw = positionalsIn[index];
    const value = raw?.trim() ?? '';
    if (value === '') {
      if (!posSpec.optional) {
        throw new GitCommandError(`"${posSpec.name}" is required for git ${spec.name}.`);
      }
      return;
    }
    assertNoNul(value, `The value for "${posSpec.name}"`);

    switch (posSpec.kind) {
      case 'url':
        if (!isValidGitUrl(value)) {
          throw new GitCommandError(
            `"${value}" does not look like a URL git accepts (ssh://, git://, http(s)://, ftp(s)://, or the scp-like [user@]host:path form) or it starts with a hyphen.`,
          );
        }
        break;
      case 'ref':
        try {
          checkRefName(value);
        } catch (err) {
          if (err instanceof RefNameError) throw new GitCommandError(err.message);
          throw err;
        }
        break;
      case 'revision':
        if (value.startsWith('-')) needsEndOfOptions = true;
        break;
      case 'path':
        hasPath = true;
        break;
      default:
        break;
    }

    positionalArgs.push(value);
  });

  if (needsEndOfOptions) argv.push('--end-of-options');
  else if (hasPath) argv.push('--');
  argv.push(...positionalArgs);

  const text = argv.map((arg) => quoteArg(arg, request.shell)).join(' ');

  return { argv, text, explanations, warnings };
}
