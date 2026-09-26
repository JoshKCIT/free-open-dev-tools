/**
 * Commands and flags this tool can assemble, each flag explained in this
 * project's own words (git's own documentation is GPL-2.0, so its sentences
 * are never copied into this file -- 07-01 AM3) with a link to the git
 * documentation for the pinned version. Every synopsis line a test cites is
 * quoted in that test's own comment, never here.
 *
 * `GIT_DOCS_VERSION` is the newest git release tag that is not a release
 * candidate at the time this catalogue was written (resolved with
 * `git ls-remote --tags https://github.com/git/git`). git-scm.com only
 * republishes a command's page when its text actually changes, so several of
 * these pages redirect `/2.55.0` to the last version whose text changed
 * (2.54.0, 2.52.0, 2.51.0 or 2.45.0 below) -- confirmed by fetching every
 * page this file cites and following the redirect. git-scm.com's own
 * redirect script re-appends the page's URL fragment after following it, so
 * a `#<anchor>` link built against `/2.55.0` still lands on the right
 * option after the browser follows the redirect.
 */

export const GIT_DOCS_VERSION = '2.55.0';

/** What kind of value a valued flag or positional takes, for light validation and the page's own field type. */
export type GitValueKind = 'string' | 'number' | 'ref' | 'revision' | 'path' | 'url' | 'date' | 'key-id';

export interface GitFlagSpec {
  /** Canonical long form, e.g. "--message". Keys the visitor-facing field and the build request. */
  readonly flag: string;
  /** Short form git also accepts, e.g. "-m", shown next to the long form. */
  readonly short?: string;
  /** True when the flag takes a value; omitted (or false) for a plain boolean flag. */
  readonly value?: boolean;
  /** The value's kind, when `value` is true. */
  readonly kind?: GitValueKind;
  /** Placeholder text for the value, e.g. "<msg>". */
  readonly placeholder?: string;
  /** One or two sentences in this project's own words. */
  readonly explanation: string;
  /** The git documentation page and anchor for the pinned version. */
  readonly docsUrl: string;
  /** Present, and shown as a warning, only for a destructive or history-rewriting flag. */
  readonly danger?: string;
}

export interface GitPositionalSpec {
  readonly name: string;
  readonly kind: GitValueKind;
  readonly optional?: boolean;
  /** True when real git accepts more than one; this tool still takes one value per positional (a documented simplification, AQ). */
  readonly repeatable?: boolean;
}

/** One of `git stash`'s subcommands, each with its own flag set (AM: stash has no single flat option list). */
export interface GitSubcommandSpec {
  readonly name: string;
  readonly flags: readonly GitFlagSpec[];
  readonly danger?: string;
}

export interface GitCommandSpec {
  readonly name: string;
  readonly docsUrl: string;
  /** True when `git <name> -h` prints a parse-options usage summary (confirmed by running the installed git for every command here). */
  readonly parseOptions: boolean;
  readonly flags: readonly GitFlagSpec[];
  readonly positionals: readonly GitPositionalSpec[];
  /** Present only for `stash`. */
  readonly subcommands?: readonly GitSubcommandSpec[];
}

const V = GIT_DOCS_VERSION;

export const COMMANDS: readonly GitCommandSpec[] = [
  {
    name: 'clone',
    docsUrl: `https://git-scm.com/docs/git-clone/${V}`,
    parseOptions: true,
    positionals: [
      { name: 'url', kind: 'url' },
      { name: 'directory', kind: 'path', optional: true },
    ],
    flags: [
      {
        flag: '--depth',
        value: true,
        kind: 'number',
        placeholder: '<depth>',
        explanation:
          'Fetches only the given number of most recent commits instead of the whole history, making the clone much smaller and faster.',
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode--depthcodeemltdepthgtemspan`,
      },
      {
        flag: '--branch',
        short: '-b',
        value: true,
        kind: 'ref',
        placeholder: '<name>',
        explanation: "Checks out the named branch or tag instead of the source repository's own default branch.",
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode-bcodeemltnamegtemspan`,
      },
      {
        flag: '--single-branch',
        explanation:
          'Fetches the history of only one branch (the one checked out, or the one --branch names) instead of every branch on the remote.',
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode--single-branchcodespan`,
      },
      {
        flag: '--recurse-submodules',
        explanation:
          'Also initialises and clones every submodule the repository declares, right after the clone finishes.',
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode--recurse-submodulescodecodecodeemltpathspecgtemspan`,
      },
      {
        flag: '--filter',
        value: true,
        kind: 'string',
        placeholder: '<filter-spec>',
        explanation:
          'Requests a partial clone: the server sends only the subset of objects the given filter spec describes, and the rest are fetched later on demand.',
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode--filtercodeemltfilter-specgtemspan`,
      },
      {
        flag: '--bare',
        explanation:
          'Creates a bare repository (no working tree) with the repository data directly in the target directory instead of inside a .git subfolder.',
        docsUrl: `https://git-scm.com/docs/git-clone/${V}#Documentation/git-clone.txt-spanclasssynopsiscode--barecodespan`,
      },
    ],
  },
  {
    name: 'commit',
    docsUrl: `https://git-scm.com/docs/git-commit/${V}`,
    parseOptions: true,
    positionals: [],
    flags: [
      {
        flag: '--message',
        short: '-m',
        value: true,
        kind: 'string',
        placeholder: '<msg>',
        explanation: 'Sets the commit message directly instead of opening an editor.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--messagecodeemltmsggtemspan`,
      },
      {
        flag: '--all',
        short: '-a',
        explanation:
          'Stages every already-tracked file that was modified or deleted before committing, without needing a separate git add.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode-acodespan`,
      },
      {
        flag: '--amend',
        explanation:
          'Replaces the branch tip with a new commit that starts from the previous commit, instead of adding a new one on top.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--amendcodespan`,
        danger:
          'Rewrites the tip commit. If it was already pushed and shared, anyone else with that branch will need to reconcile the rewritten history.',
      },
      {
        flag: '--no-edit',
        explanation:
          'Reuses the existing commit message as-is (most often together with --amend) instead of opening an editor.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--no-editcodespan`,
      },
      {
        flag: '--allow-empty',
        explanation:
          'Allows creating a commit whose tree is identical to its parent, which git normally refuses as a likely mistake.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--allow-emptycodespan`,
      },
      {
        flag: '--fixup',
        value: true,
        kind: 'revision',
        placeholder: '<commit>',
        explanation:
          'Creates a "fixup!" commit that a later interactive rebase\'s autosquash can fold into the named commit.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--fixupcodecodeamendcodecoderewordcodecodecodeemltcommitgtemspan`,
      },
      {
        flag: '--author',
        value: true,
        kind: 'string',
        placeholder: '<author>',
        explanation:
          'Overrides the recorded author, given as "Name <email>", instead of using the committer identity from git config.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--authorcodeemltauthorgtemspan`,
      },
      {
        flag: '--no-verify',
        short: '-n',
        explanation: 'Skips the pre-commit and commit-msg hooks for this commit.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode-ncodespan`,
      },
      {
        flag: '--dry-run',
        explanation: 'Reports what would be committed without actually creating a commit.',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode--dry-runcodespan`,
      },
      {
        flag: '--gpg-sign',
        short: '-S',
        value: true,
        kind: 'key-id',
        placeholder: '<key-id>',
        explanation:
          'Cryptographically signs the commit with the given key (or the default signing identity when no key is given).',
        docsUrl: `https://git-scm.com/docs/git-commit/${V}#Documentation/git-commit.txt-spanclasssynopsiscode-Scodeemltkey-idgtemspan`,
      },
    ],
  },
  {
    name: 'log',
    docsUrl: `https://git-scm.com/docs/git-log/${V}`,
    // Confirmed by running the installed git: `git log -h` prints a usage
    // summary, but its body lists only diff-output-control flags (-q,
    // --source, --decorate...); the pretty-print and revision-walking flags
    // this catalogue offers (--oneline, --graph, --all, --max-count,
    // --since, --author, --grep, --patch, --follow) are parsed by the
    // shared revision-walking machinery (setup_revisions), not git log's own
    // parse-options table, so they never appear there. `false` scopes this
    // command out of the "every flag appears in the installed git option
    // summary" oracle check rather than asserting something not true.
    parseOptions: false,
    positionals: [{ name: 'path', kind: 'path', optional: true }],
    flags: [
      {
        flag: '--oneline',
        explanation: 'Shows each commit as a single line: its abbreviated hash and its subject line.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--onelinecodespan`,
      },
      {
        flag: '--graph',
        explanation:
          'Draws a text graph of the branch and merge structure alongside the log, so you can see where history diverged and came back together.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--graphcodespan`,
      },
      {
        flag: '--all',
        explanation: 'Shows history reachable from every ref, not only the current branch.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--allcodespan`,
      },
      {
        flag: '--max-count',
        short: '-n',
        value: true,
        kind: 'number',
        placeholder: '<number>',
        explanation: 'Limits the output to the given number of commits.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode-codeemltnumbergtemspan`,
      },
      {
        flag: '--since',
        value: true,
        kind: 'date',
        placeholder: '<date>',
        explanation: 'Shows only commits made after the given date.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--sincecodeemltdategtemspan`,
      },
      {
        flag: '--author',
        value: true,
        kind: 'string',
        placeholder: '<pattern>',
        explanation: 'Shows only commits whose author line matches the given pattern.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--authorcodeemltpatterngtemspan`,
      },
      {
        flag: '--grep',
        value: true,
        kind: 'string',
        placeholder: '<pattern>',
        explanation: 'Shows only commits whose message matches the given pattern.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--grepcodeemltpatterngtemspan`,
      },
      {
        flag: '--stat',
        explanation: 'Adds a per-file line-change summary (a diffstat) after each commit.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--statcodecodecodeemltwidthgtemcodecodeemltname-widthgtemcodecodeemltcountgtemspan`,
      },
      {
        flag: '--patch',
        short: '-p',
        explanation: 'Shows the actual diff for each commit, not only its message.',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode-pcodespan`,
      },
      {
        flag: '--follow',
        explanation:
          'Keeps following one file across the renames in its history (only works when exactly one file path is given).',
        docsUrl: `https://git-scm.com/docs/git-log/${V}#Documentation/git-log.txt-spanclasssynopsiscode--followcodespan`,
      },
    ],
  },
  {
    name: 'diff',
    docsUrl: `https://git-scm.com/docs/git-diff/${V}`,
    // Confirmed by running the installed git: `git diff -h` prints a fixed,
    // short "common diff options" list (through -a/--text) that is
    // genuinely shorter than diff's real option set -- it never lists
    // --staged, --word-diff or --ignore-all-space, all three still real,
    // documented, accepted flags. Excluded from the per-flag oracle check
    // for the same reason as `log` above.
    parseOptions: false,
    positionals: [{ name: 'commit', kind: 'revision', optional: true }],
    flags: [
      {
        flag: '--staged',
        explanation:
          'Compares the index (what has been staged with git add) against the last commit, instead of comparing the working tree.',
        docsUrl: `https://git-scm.com/docs/git-diff/${V}#Documentation/git-diff.txt-spanclasssynopsiscodegitcodecodediffcodecode--cachedcodespan`,
      },
      {
        flag: '--stat',
        explanation: 'Shows a per-file line-change summary instead of the full diff text.',
        docsUrl: `https://git-scm.com/docs/git-diff/${V}#Documentation/git-diff.txt-spanclasssynopsiscode--statcodecodecodeemltwidthgtemcodecodeemltname-widthgtemcodecodeemltcountgtemspan`,
      },
      {
        flag: '--name-only',
        explanation: 'Lists only the names of the changed files, with none of the diff content.',
        docsUrl: `https://git-scm.com/docs/git-diff/${V}#Documentation/git-diff.txt-spanclasssynopsiscode--name-onlycodespan`,
      },
      {
        flag: '--word-diff',
        explanation: 'Shows changed words within a line instead of marking the whole line as added or removed.',
        docsUrl: `https://git-scm.com/docs/git-diff/${V}#Documentation/git-diff.txt-spanclasssynopsiscode--word-diffcodecodecodeemltmodegtemspan`,
      },
      {
        flag: '--ignore-all-space',
        short: '-w',
        explanation: 'Treats lines that differ only in whitespace as unchanged.',
        docsUrl: `https://git-scm.com/docs/git-diff/${V}#Documentation/git-diff.txt-spanclasssynopsiscode-wcodespan`,
      },
    ],
  },
  {
    name: 'switch',
    docsUrl: `https://git-scm.com/docs/git-switch/${V}`,
    parseOptions: true,
    positionals: [{ name: 'branch', kind: 'ref', optional: true }],
    flags: [
      {
        flag: '--create',
        short: '-c',
        value: true,
        kind: 'ref',
        placeholder: '<new-branch>',
        explanation:
          'Creates the named branch starting at the current commit (or the branch positional, if given) and switches to it in one step.',
        docsUrl: `https://git-scm.com/docs/git-switch/${V}#Documentation/git-switch.txt-spanclasssynopsiscode-ccodeemltnew-branchgtemspan`,
      },
      {
        flag: '--detach',
        short: '-d',
        explanation:
          'Checks out a commit directly rather than a branch, for inspecting or experimenting without moving any branch pointer.',
        docsUrl: `https://git-scm.com/docs/git-switch/${V}#Documentation/git-switch.txt-spanclasssynopsiscode-dcodespan`,
      },
    ],
  },
  {
    name: 'restore',
    docsUrl: `https://git-scm.com/docs/git-restore/${V}`,
    parseOptions: true,
    positionals: [{ name: 'file', kind: 'path' }],
    flags: [
      {
        flag: '--staged',
        short: '-S',
        explanation: 'Restores the index (the staged copy) instead of the working tree.',
        docsUrl: `https://git-scm.com/docs/git-restore/${V}#Documentation/git-restore.txt-spanclasssynopsiscode-Wcodespan`,
        danger:
          'Unstages the named file back to how it is in the source commit; any staged changes to it are discarded from the index.',
      },
      {
        flag: '--worktree',
        short: '-W',
        explanation:
          'Restores the working tree copy of the file (the default location when neither --staged nor --worktree is given).',
        docsUrl: `https://git-scm.com/docs/git-restore/${V}#Documentation/git-restore.txt-spanclasssynopsiscode-Wcodespan`,
        danger: 'Overwrites the file in the working tree with the source version; unsaved edits to it are lost.',
      },
      {
        flag: '--source',
        short: '-s',
        value: true,
        kind: 'revision',
        placeholder: '<tree>',
        explanation: 'Restores from the given commit, branch or tag instead of from HEAD or the index.',
        docsUrl: `https://git-scm.com/docs/git-restore/${V}#Documentation/git-restore.txt-spanclasssynopsiscode-scodeemlttreegtemspan`,
      },
    ],
  },
  {
    name: 'branch',
    docsUrl: `https://git-scm.com/docs/git-branch/${V}`,
    parseOptions: true,
    positionals: [
      { name: 'branch-name', kind: 'ref', optional: true },
      { name: 'start-point', kind: 'revision', optional: true },
    ],
    flags: [
      {
        flag: '--delete',
        short: '-d',
        explanation:
          'Deletes the named branch. Refused unless it is already fully merged into its upstream (or HEAD, if it has none).',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-dcodespan`,
        danger:
          "Removes the branch pointer. Any commits only reachable from it become unreachable once git's own reflog expiry runs.",
      },
      {
        flag: '--force',
        short: '-f',
        explanation:
          'Combined with --delete, deletes the branch even if it is not merged; combined with a new branch name, resets an existing branch to the given start point.',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-fcodespan`,
        danger:
          'With --delete, force-deletes an unmerged branch, discarding every commit only reachable from it once the reflog expires. Prefer reviewing what would be lost first.',
      },
      {
        flag: '--move',
        short: '-m',
        explanation: 'Renames the branch, carrying its configuration and reflog to the new name.',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-mcodespan`,
      },
      {
        flag: '--list',
        short: '-l',
        explanation: 'Lists branches instead of creating, deleting or renaming one.',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-lcodespan`,
      },
      {
        flag: '--all',
        short: '-a',
        explanation: 'Lists both local branches and remote-tracking branches.',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-acodespan`,
      },
      {
        flag: '--set-upstream-to',
        short: '-u',
        value: true,
        kind: 'ref',
        placeholder: '<upstream>',
        explanation: 'Sets which remote-tracking branch this branch follows, used by commands like a plain git pull.',
        docsUrl: `https://git-scm.com/docs/git-branch/${V}#Documentation/git-branch.txt-spanclasssynopsiscode-ucodeemltupstreamgtemspan`,
      },
    ],
  },
  {
    name: 'merge',
    docsUrl: `https://git-scm.com/docs/git-merge/${V}`,
    parseOptions: true,
    positionals: [{ name: 'commit', kind: 'ref', optional: true }],
    flags: [
      {
        flag: '--no-ff',
        explanation:
          'Always creates a merge commit, even when the current branch could simply fast-forward to the other side.',
        docsUrl: `https://git-scm.com/docs/git-merge/${V}#Documentation/git-merge.txt-spanclasssynopsiscode--ffcodespan`,
      },
      {
        flag: '--ff-only',
        explanation: 'Only completes the merge if it can fast-forward; refuses rather than create a merge commit.',
        docsUrl: `https://git-scm.com/docs/git-merge/${V}#Documentation/git-merge.txt-spanclasssynopsiscode--ffcodespan`,
      },
      {
        flag: '--squash',
        explanation:
          "Applies the other side's changes to the working tree and index without recording a merge commit or moving HEAD, so you can commit them yourself as one plain commit.",
        docsUrl: `https://git-scm.com/docs/git-merge/${V}#Documentation/git-merge.txt-spanclasssynopsiscode--squashcodespan`,
      },
      {
        flag: '--abort',
        explanation:
          'Cancels an in-progress merge with conflicts and tries to restore the state from before it started.',
        docsUrl: `https://git-scm.com/docs/git-merge/${V}#Documentation/git-merge.txt-spanclasssynopsiscode--abortcodespan`,
      },
    ],
  },
  {
    name: 'rebase',
    docsUrl: `https://git-scm.com/docs/git-rebase/${V}`,
    parseOptions: true,
    positionals: [
      { name: 'upstream', kind: 'revision', optional: true },
      { name: 'branch', kind: 'ref', optional: true },
    ],
    flags: [
      {
        flag: '--onto',
        value: true,
        kind: 'revision',
        placeholder: '<newbase>',
        explanation: 'Replays the commits onto the given commit instead of onto upstream.',
        docsUrl: `https://git-scm.com/docs/git-rebase/${V}#Documentation/git-rebase.txt---ontoltnewbasegt`,
      },
      {
        flag: '--autosquash',
        explanation:
          'Automatically reorders and folds commits whose message starts with "squash!", "fixup!" or "amend!" into the commit they name.',
        docsUrl: `https://git-scm.com/docs/git-rebase/${V}#Documentation/git-rebase.txt---autosquash`,
      },
      {
        flag: '--continue',
        explanation: 'Resumes a rebase after you have resolved a conflict it stopped on.',
        docsUrl: `https://git-scm.com/docs/git-rebase/${V}#Documentation/git-rebase.txt---continue`,
      },
      {
        flag: '--abort',
        explanation: 'Cancels the rebase and puts the branch back exactly where it was before it started.',
        docsUrl: `https://git-scm.com/docs/git-rebase/${V}#Documentation/git-rebase.txt---abort`,
      },
      {
        flag: '--rebase-merges',
        explanation:
          'Tries to preserve the branching structure (the merge commits) of the history being rebased, instead of flattening it into one line.',
        docsUrl: `https://git-scm.com/docs/git-rebase/${V}#Documentation/git-rebase.txt--r`,
        danger:
          'Rewrites every replayed commit with a new hash, including merge commits. This project does not offer interactive rebase (-i); combine this flag manually with -i in a real shell if you need to reorder commits, which opens an editor.',
      },
    ],
  },
  {
    name: 'cherry-pick',
    docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}`,
    parseOptions: true,
    positionals: [{ name: 'commit', kind: 'revision' }],
    flags: [
      {
        flag: '-x',
        explanation: 'Appends a line naming the original commit this change was cherry-picked from.',
        docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}#Documentation/git-cherry-pick.txt--x`,
      },
      {
        flag: '--no-commit',
        short: '-n',
        explanation:
          'Applies the change to the working tree and index without creating a commit, so you can inspect or combine it first.',
        docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}#Documentation/git-cherry-pick.txt--n`,
      },
      {
        flag: '--mainline',
        short: '-m',
        value: true,
        kind: 'number',
        placeholder: '<parent-number>',
        explanation:
          'Required when cherry-picking a merge commit: names which parent (counting from 1) is the mainline to diff against.',
        docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}#Documentation/git-cherry-pick.txt--mltparent-numbergt`,
      },
      {
        flag: '--continue',
        explanation: 'Resumes a cherry-pick (or revert) after resolving the conflict it stopped on.',
        docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}#Documentation/git-cherry-pick.txt---continue`,
      },
      {
        flag: '--abort',
        explanation: 'Cancels the cherry-pick and returns to the state from before it started.',
        docsUrl: `https://git-scm.com/docs/git-cherry-pick/${V}#Documentation/git-cherry-pick.txt---abort`,
      },
    ],
  },
  {
    name: 'stash',
    docsUrl: `https://git-scm.com/docs/git-stash/${V}`,
    parseOptions: true,
    positionals: [],
    flags: [],
    subcommands: [
      {
        name: 'push',
        flags: [
          {
            flag: '--message',
            short: '-m',
            value: true,
            kind: 'string',
            placeholder: '<message>',
            explanation: 'Gives the stash entry a description instead of the default "WIP on <branch>" message.',
            docsUrl: `https://git-scm.com/docs/git-stash/${V}#Documentation/git-stash.txt-spanclasssynopsiscodepushcodecode-pcodecode--patchcodecode-Scodecode--stagedcodecode-kcodecode--codecodeno-codecodekeep-indexcodecode-ucodecode--include-untrackedcodecode-acodecode--allcodecode-qcodecode--quietcodecode-mcodecode--messagecodeemltmessagegtemcode--pathspec-from-filecodeemltfilegtemcode--pathspec-file-nulcodecode--codeemltpathspecgtemspan`,
          },
          {
            flag: '--include-untracked',
            short: '-u',
            explanation:
              'Also stashes untracked files, then cleans them from the working tree the way git clean would.',
            docsUrl: `https://git-scm.com/docs/git-stash/${V}#Documentation/git-stash.txt-spanclasssynopsiscode-ucodespan`,
          },
          {
            flag: '--keep-index',
            short: '-k',
            explanation: 'Leaves already-staged changes in place in the working tree and index after stashing.',
            docsUrl: `https://git-scm.com/docs/git-stash/${V}#Documentation/git-stash.txt-spanclasssynopsiscode-kcodespan`,
          },
        ],
      },
      { name: 'pop', flags: [] },
      { name: 'list', flags: [] },
      {
        name: 'drop',
        flags: [],
        danger:
          "Permanently discards the most recent stash entry (or the one you name); once dropped, its changes are gone once git's own reflog for the stash expires.",
      },
    ],
  },
  {
    name: 'reset',
    docsUrl: `https://git-scm.com/docs/git-reset/${V}`,
    parseOptions: true,
    positionals: [{ name: 'commit', kind: 'revision', optional: true }],
    flags: [
      {
        flag: '--soft',
        explanation:
          "Moves the branch pointer only; the index and working tree are left exactly as they are, so the previous commits' changes appear staged.",
        docsUrl: `https://git-scm.com/docs/git-reset/${V}#Documentation/git-reset.txt-spanclasssynopsiscode--softcodespan`,
      },
      {
        flag: '--mixed',
        explanation:
          "Moves the branch pointer and resets the index to match it, but leaves the working tree files untouched (git reset's own default mode).",
        docsUrl: `https://git-scm.com/docs/git-reset/${V}#_synopsis`,
      },
      {
        flag: '--hard',
        explanation: 'Moves the branch pointer and makes both the index and the working tree match it exactly.',
        docsUrl: `https://git-scm.com/docs/git-reset/${V}#Documentation/git-reset.txt-spanclasssynopsiscode--hardcodespan`,
        danger:
          'Overwrites tracked files and discards uncommitted changes in both the index and the working tree, with no way to recover them from git afterward.',
      },
      {
        flag: '--keep',
        explanation:
          'Moves the branch pointer like --hard, but refuses if you have local changes that the move would touch, instead of overwriting them.',
        docsUrl: `https://git-scm.com/docs/git-reset/${V}#Documentation/git-reset.txt-spanclasssynopsiscode--keepcodespan`,
      },
    ],
  },
  {
    name: 'push',
    docsUrl: `https://git-scm.com/docs/git-push/${V}`,
    parseOptions: true,
    positionals: [{ name: 'repository', kind: 'url', optional: true }],
    flags: [
      {
        flag: '--set-upstream',
        short: '-u',
        explanation:
          "Records the remote branch as this branch's upstream, so a later plain git push or git pull knows where to go.",
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode-ucodespan`,
      },
      {
        flag: '--force-with-lease',
        explanation:
          "Force-pushes, but refuses if the remote branch has moved since you last fetched it -- so it won't silently overwrite someone else's push the way plain --force can.",
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode--force-with-leasecodespan`,
        danger:
          "Still rewrites the remote branch's history when it succeeds. Safer than --force, but anyone who already fetched the old history will need to reconcile it.",
      },
      {
        flag: '--force',
        short: '-f',
        explanation:
          'Pushes even when the remote branch is not a descendant of what you have locally, overwriting whatever is there.',
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode-fcodespan`,
        danger:
          "Overwrites the remote branch's history unconditionally, which can silently discard commits someone else already pushed. --force-with-lease is offered above as a safer alternative.",
      },
      {
        flag: '--tags',
        explanation: 'Pushes every tag in addition to whatever branches or refspecs are given.',
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode--tagscodespan`,
      },
      {
        flag: '--delete',
        short: '-d',
        explanation: 'Deletes the named ref from the remote instead of updating it.',
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode-dcodespan`,
        danger: 'Removes the branch or tag from the remote repository for everyone who fetches from it.',
      },
      {
        flag: '--dry-run',
        short: '-n',
        explanation: 'Shows what would be pushed without actually sending anything.',
        docsUrl: `https://git-scm.com/docs/git-push/${V}#Documentation/git-push.txt-spanclasssynopsiscode-ncodespan`,
      },
    ],
  },
  {
    name: 'fetch',
    docsUrl: `https://git-scm.com/docs/git-fetch/${V}`,
    parseOptions: true,
    positionals: [{ name: 'repository', kind: 'url', optional: true }],
    flags: [
      {
        flag: '--prune',
        short: '-p',
        explanation: 'Removes local remote-tracking references for branches that no longer exist on the remote.',
        docsUrl: `https://git-scm.com/docs/git-fetch/${V}#Documentation/git-fetch.txt-spanclasssynopsiscode-pcodespan`,
      },
      {
        flag: '--all',
        explanation: 'Fetches from every configured remote instead of just one.',
        docsUrl: `https://git-scm.com/docs/git-fetch/${V}#Documentation/git-fetch.txt-spanclasssynopsiscode--allcodespan`,
      },
      {
        flag: '--tags',
        short: '-t',
        explanation:
          'Also fetches every tag from the remote, in addition to whatever else this fetch would bring down.',
        docsUrl: `https://git-scm.com/docs/git-fetch/${V}#Documentation/git-fetch.txt-spanclasssynopsiscode-tcodespan`,
      },
      {
        flag: '--depth',
        value: true,
        kind: 'number',
        placeholder: '<depth>',
        explanation:
          'Limits (or, on an already-shallow clone, changes) how much history is fetched from the tip of each branch.',
        docsUrl: `https://git-scm.com/docs/git-fetch/${V}#Documentation/git-fetch.txt-spanclasssynopsiscode--depthcodeemltdepthgtemspan`,
      },
    ],
  },
  {
    name: 'tag',
    docsUrl: `https://git-scm.com/docs/git-tag/${V}`,
    parseOptions: true,
    positionals: [
      { name: 'tagname', kind: 'ref' },
      { name: 'commit', kind: 'revision', optional: true },
    ],
    flags: [
      {
        flag: '--annotate',
        short: '-a',
        explanation:
          'Creates a full annotated tag object (with its own message, tagger and date) instead of a lightweight tag.',
        docsUrl: `https://git-scm.com/docs/git-tag/${V}#Documentation/git-tag.txt-spanclasssynopsiscode-acodespan`,
      },
      {
        flag: '--message',
        short: '-m',
        value: true,
        kind: 'string',
        placeholder: '<msg>',
        explanation: 'Sets the annotation message directly (and implies --annotate) instead of opening an editor.',
        docsUrl: `https://git-scm.com/docs/git-tag/${V}#Documentation/git-tag.txt-spanclasssynopsiscode-mcodeemltmsggtemspan`,
      },
      {
        flag: '--delete',
        short: '-d',
        explanation: 'Deletes the named tags instead of creating one.',
        docsUrl: `https://git-scm.com/docs/git-tag/${V}#Documentation/git-tag.txt-spanclasssynopsiscode-dcodespan`,
        danger:
          'Removes the tag locally. If it was already pushed, it will need a separate push --delete to remove it from the remote too.',
      },
      {
        flag: '--sign',
        short: '-s',
        explanation: 'Cryptographically signs the tag with the default signing identity.',
        docsUrl: `https://git-scm.com/docs/git-tag/${V}#Documentation/git-tag.txt-spanclasssynopsiscode-scodespan`,
      },
      {
        flag: '--list',
        short: '-l',
        explanation: 'Lists tags instead of creating or deleting one.',
        docsUrl: `https://git-scm.com/docs/git-tag/${V}#Documentation/git-tag.txt-spanclasssynopsiscode-lcodespan`,
      },
    ],
  },
  {
    name: 'clean',
    docsUrl: `https://git-scm.com/docs/git-clean/${V}`,
    parseOptions: true,
    positionals: [{ name: 'path', kind: 'path', optional: true, repeatable: true }],
    flags: [
      {
        flag: '--dry-run',
        short: '-n',
        explanation: 'Shows which untracked files would be removed, without removing anything.',
        docsUrl: `https://git-scm.com/docs/git-clean/${V}#Documentation/git-clean.txt--n`,
      },
      {
        flag: '--force',
        short: '-f',
        explanation:
          'Actually removes the files. git clean refuses to delete anything without this, even when a path is given, unless the clean.requireForce config variable is turned off.',
        docsUrl: `https://git-scm.com/docs/git-clean/${V}#Documentation/git-clean.txt--f`,
        danger:
          'Permanently deletes untracked files from the working tree; they are not committed anywhere, so git cannot bring them back.',
      },
      {
        flag: '-d',
        explanation: 'Also recurses into untracked directories, instead of leaving them alone.',
        docsUrl: `https://git-scm.com/docs/git-clean/${V}#Documentation/git-clean.txt--d`,
        danger: 'Removes whole untracked directories, including everything inside them.',
      },
      {
        flag: '-x',
        explanation:
          'Also removes files git would normally leave alone because .gitignore excludes them, such as build output.',
        docsUrl: `https://git-scm.com/docs/git-clean/${V}#Documentation/git-clean.txt--x`,
        danger:
          'Deletes ignored files too, which often include build artifacts or local configuration you did not mean to lose.',
      },
    ],
  },
];

/** Looks up a command spec by name, or returns undefined. */
export function findCommand(name: string): GitCommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
