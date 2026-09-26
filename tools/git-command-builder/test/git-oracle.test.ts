/**
 * Runs the git actually installed on this machine as an oracle for two
 * required titles: that every flag this catalogue offers for a
 * parse-options command really is one of that command's own options (by
 * reading `git <command> -h`'s usage summary), and that a battery of ref
 * names is accepted or refused exactly as `git check-ref-format --branch`
 * decides. The installed git's own version is recorded below and echoed in
 * the SUMMARY.
 */
import { execFileSync } from 'node:child_process';
import { it, expect, beforeAll } from 'vitest';
import { COMMANDS, GIT_DOCS_VERSION, type GitFlagSpec } from '../src/catalogue';
import { checkRefName } from '../src/refname';

function runGit(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('git', args, { encoding: 'utf8' });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number | null };
    return { stdout: e.stdout ?? '', status: e.status ?? 1 };
  }
}

let installedGitVersion = '';
beforeAll(() => {
  installedGitVersion = runGit(['--version']).stdout.trim();
  // eslint-disable-next-line no-console -- test setup diagnostic, not part of the tool's own console-silence rule.
  console.log(
    `git-command-builder git-oracle.test.ts: installed ${installedGitVersion}, pinned docs for ${GIT_DOCS_VERSION}`,
  );
});

/**
 * True when `flag` shows up in `helpText`, allowing for the `--[no-]name`
 * negatable-flag rendering `git <command> -h`'s parse-options summary uses
 * for most long boolean flags, and for a value flag's own short form.
 */
function appearsInHelp(helpText: string, flag: GitFlagSpec): boolean {
  const long = flag.flag;
  if (helpText.includes(long)) return true;
  if (long.startsWith('--')) {
    const bare = long.slice(2);
    if (helpText.includes(`--[no-]${bare}`)) return true;
    // `--no-edit` is the negated form of the parse-options-generated
    // `--[no-]edit`; `--no-ff` is the negated form of `--[no-]ff`. Confirmed
    // directly: `git commit -h` and `git merge -h` show the positive form
    // wrapped in `[no-]`, never the negated spelling as its own entry.
    if (bare.startsWith('no-')) {
      const positive = bare.slice('no-'.length);
      if (helpText.includes(`--[no-]${positive}`)) return true;
    }
  }
  if (flag.short && helpText.includes(flag.short)) return true;
  return false;
}

it('every flag offered for a parse-options command appears in the installed git option summary', () => {
  const checked: string[] = [];
  const missing: string[] = [];

  for (const command of COMMANDS) {
    if (!command.parseOptions) continue;
    const { stdout } = runGit([command.name, '-h']);
    expect(stdout.length, `git ${command.name} -h produced no output at all`).toBeGreaterThan(0);

    const flagLists: readonly (readonly GitFlagSpec[])[] = command.subcommands
      ? command.subcommands.map((s) => s.flags)
      : [command.flags];

    for (const flags of flagLists) {
      for (const flag of flags) {
        checked.push(`${command.name} ${flag.flag}`);
        if (!appearsInHelp(stdout, flag)) missing.push(`${command.name} ${flag.flag}`);
      }
    }
  }

  expect(checked.length, 'no flag was checked at all').toBeGreaterThan(0);
  expect(missing, missing.join(', ')).toEqual([]);
});

/**
 * A battery of ref names, each with the outcome `git check-ref-format
 * --branch <name>` gives on this machine (confirmed directly before writing
 * this test, see refname.ts's own header). `@{-1}`-shaped shorthand is
 * excluded (see refname.ts): its real outcome depends on the repository's
 * own reflog history, which this static battery does not have and which
 * this tool cannot see for a real visitor either.
 */
const REF_NAME_BATTERY: readonly string[] = [
  'main',
  'feature/thing',
  'refs/heads/main',
  '@',
  'HEAD',
  '-u',
  '--upload-pack=x',
  '-',
  'feature..bad',
  '@abc',
  '/main',
  'main/',
  'a//b',
  'a.',
  'a@{b',
  String.raw`a\b`,
  'a?b',
  'a*b',
  'a[b',
  'a:b',
  'a^b',
  'a~b',
  'a b',
  'a.lock',
  'refs/heads/@',
  '',
];

it('ref names are accepted or refused exactly as git check-ref-format decides', () => {
  const mismatches: string[] = [];
  for (const name of REF_NAME_BATTERY) {
    if (name === '') continue; // `git check-ref-format --branch ""` needs a distinct empty-argument probe below.
    const { status } = runGit(['check-ref-format', '--branch', name]);
    const gitAccepts = status === 0;
    let oursAccepts = true;
    try {
      checkRefName(name);
    } catch {
      oursAccepts = false;
    }
    if (gitAccepts !== oursAccepts) {
      mismatches.push(
        `"${name}": git ${gitAccepts ? 'accepted' : 'refused'}, this tool ${oursAccepts ? 'accepted' : 'refused'}`,
      );
    }
  }
  expect(mismatches, mismatches.join('\n')).toEqual([]);

  // An empty name: git refuses it (checked separately since execFileSync
  // cannot pass a genuinely empty argv entry through some shells reliably).
  expect(() => checkRefName('')).toThrow();
});
