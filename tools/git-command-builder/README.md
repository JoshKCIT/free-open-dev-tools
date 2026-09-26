# Git Command Builder

Assemble a git command from options, with an explanation of each flag.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Pick a git command, fill in the options you want, and get back the exact command line for bash, zsh or PowerShell plus a plain-words explanation of every flag with a link to the git documentation for a pinned version. Every generated command splits back into exactly the intended arguments -- a branch name, path or message can never turn into an option by accident -- and destructive flags carry a warning before you run them.

## Supported

- 16 everyday commands (clone, commit, log, diff, switch, restore, branch, merge, rebase, cherry-pick, stash, reset, push, fetch, tag, clean), each with its most commonly reached-for flags
- An explanation and a documentation link for every flag, written in this project's own words
- POSIX shell (bash, zsh and similar) and PowerShell output, both always quoting the whole argument
- Branch and tag names checked against git's own check-ref-format rules before they are used
- A value that could be mistaken for an option (starts with a hyphen) is placed after a separator or refused outright
- A warning on every destructive flag this tool offers (--amend, --hard, --force, --delete, -D, clean's -x/-d/--force, stash drop)

## Limits

- This tool cannot see the visitor's repository, so it cannot tell what a command will actually change there -- only running it (with --dry-run first, where a command offers one) can show that.
- The options offered are those of git 2.55.0; an older installed git may not have every flag, and running an unrecognised flag will simply fail there.
- Windows cmd.exe quoting is not produced -- only POSIX shells and PowerShell.
- @{-1}-style shorthand (the previously checked-out branch) and other reflog-dependent shorthand are refused, because resolving them needs the visitor's own repository history.

## Ambiguous cases, and what this does about them

- The scp-like git URL syntax ([user@]host:path, recognised only when there is no slash before the first colon) is genuinely ambiguous with a local path containing a colon before any slash, such as a Windows drive path -- git's own documentation names the same ambiguity and does not resolve it either; this tool does not try to be smarter than git here.
- git diff's --staged flag is a real, accepted synonym of --cached, but git diff -h's own usage summary only lists --cached, never --staged -- confirmed directly by running both. diff and log are both excluded from the flag-appears-in-h check for this reason (see catalogue.ts): most of their flags come from the shared revision-walking and diff-output machinery, not each command's own parse-options table, so git's own -h summary for either command is a genuinely short, incomplete list.

## Defined by

- [git documentation, version 2.55.0](https://git-scm.com/docs/git/2.55.0)
- [gitcli(7): option conventions, --end-of-options](https://git-scm.com/docs/gitcli/2.55.0)
- [git-check-ref-format(1): ref name rules](https://git-scm.com/docs/git-check-ref-format/2.55.0)
- [POSIX Shell Command Language 2.2.2 (Single-Quotes)](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html)
- [PowerShell about_Quoting_Rules](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/git-command-builder git-command-builder
cd git-command-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/git-command-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildGitCommand } from '@fodt/git-command-builder';

const { text } = buildGitCommand({
  command: 'commit',
  flags: { '--message': 'fix: it is done' },
  shell: 'posix',
});
```

buildGitCommand({ command, subcommand?, flags, positionals, shell }) returns { argv, text, explanations, warnings }. flags is keyed by a flag's own canonical long name (e.g. "--message"); a boolean flag is included when its value is true, a valued flag when its value is a non-empty string or finite number. positionals is one value per positional in the command's own declared order. subcommand is required only for stash (push, pop, list or drop).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The split-back test decodes POSIX output with the shell-quote package (a second, independent word splitter, test-only) and PowerShell output with a test-only decoder implementing PowerShell's own single-quote doubling rule. A separate oracle test runs the installed git (git <command> -h) to confirm every offered flag for a parse-options command is real, and git check-ref-format --branch to confirm this tool's own ref-name rules agree with git's, over a battery of names.

## Licence

MIT. See [LICENSE](./LICENSE).
