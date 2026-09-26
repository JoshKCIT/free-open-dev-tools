import {
  meta,
  buildGitCommand,
  GitCommandError,
  COMMANDS,
  type GitCommandSpec,
  type GitFlagSpec,
  type GitPositionalSpec,
} from '@fodt/git-command-builder';
import { defineTool, str, type Field, type OutputBlock, type OutputTable, type ToolResult } from '../lib/tool-ui';

const SHELL_OPTIONS = [
  { value: 'posix', label: 'bash, zsh and other POSIX shells' },
  { value: 'powershell', label: 'PowerShell' },
];

/** `flag.flag` with its leading dashes stripped, for use inside a field name. */
function flagKey(flag: string): string {
  return flag.replace(/^-+/, '');
}

function flagFieldName(command: string, subcommand: string | undefined, flag: GitFlagSpec): string {
  return subcommand ? `${command}-${subcommand}-${flagKey(flag.flag)}` : `${command}-${flagKey(flag.flag)}`;
}

function positionalFieldName(command: string, pos: GitPositionalSpec): string {
  return `${command}-${pos.name}`;
}

/**
 * Every boolean flag for one command (or stash subcommand) is typed into a
 * single space-separated text field, rather than one checkbox per flag.
 * Chosen deliberately over one checkbox per flag: this catalogue offers
 * around five to nine flags per command across sixteen commands, and a
 * checkbox is its own driveable state the site's privacy harness visits
 * individually (`e2e/privacy.spec.ts`'s control-state sweep) -- one text
 * field per command keeps this page's own state count comparable to every
 * other tool's, while a valued flag (a separate text field per flag, since
 * those carry no state of their own beyond their typed value) still gets
 * its own field.
 */
function boolFlagsFieldName(command: string, subcommand?: string): string {
  return subcommand ? `${command}-${subcommand}-flags` : `${command}-flags`;
}

function flagLabel(flag: GitFlagSpec): string {
  const name = flag.short ? `${flag.flag} (${flag.short})` : flag.flag;
  return flag.value && flag.placeholder ? `${name} ${flag.placeholder}` : name;
}

function positionalLabel(pos: GitPositionalSpec): string {
  const words = pos.name.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + (pos.optional ? ' (optional)' : '');
}

function fieldForValuedFlag(command: GitCommandSpec, subcommand: string | undefined, flag: GitFlagSpec): Field {
  const name = flagFieldName(command.name, subcommand, flag);
  const visible = subcommand
    ? (values: Record<string, unknown>) =>
        str(values, 'command') === command.name && str(values, 'stash-subcommand', 'push') === subcommand
    : (values: Record<string, unknown>) => str(values, 'command') === command.name;

  return {
    name,
    label: flagLabel(flag),
    type: flag.kind === 'number' ? 'number' : 'text',
    default: '',
    placeholder: flag.placeholder,
    visible,
  };
}

function fieldForBooleanFlags(
  command: GitCommandSpec,
  subcommand: string | undefined,
  flags: readonly GitFlagSpec[],
): Field | null {
  if (flags.length === 0) return null;
  const visible = subcommand
    ? (values: Record<string, unknown>) =>
        str(values, 'command') === command.name && str(values, 'stash-subcommand', 'push') === subcommand
    : (values: Record<string, unknown>) => str(values, 'command') === command.name;

  const names = flags.map((f) => f.flag).join(' ');
  return {
    name: boolFlagsFieldName(command.name, subcommand),
    label: 'Flags (space-separated)',
    type: 'text',
    default: '',
    placeholder: names,
    help: `Type any of: ${names}`,
    visible,
  };
}

function fieldForPositional(command: GitCommandSpec, pos: GitPositionalSpec): Field {
  return {
    name: positionalFieldName(command.name, pos),
    label: positionalLabel(pos),
    type: 'text',
    default: '',
    visible: (values) => str(values, 'command') === command.name,
  };
}

const commandFields: Field[] = [];
for (const command of COMMANDS) {
  if (command.subcommands) {
    const topValued = command.flags.filter((f) => f.value);
    const topBoolean = command.flags.filter((f) => !f.value);
    for (const flag of topValued) commandFields.push(fieldForValuedFlag(command, undefined, flag));
    const topBoolField = fieldForBooleanFlags(command, undefined, topBoolean);
    if (topBoolField) commandFields.push(topBoolField);

    for (const sub of command.subcommands) {
      const subValued = sub.flags.filter((f) => f.value);
      const subBoolean = sub.flags.filter((f) => !f.value);
      for (const flag of subValued) commandFields.push(fieldForValuedFlag(command, sub.name, flag));
      const subBoolField = fieldForBooleanFlags(command, sub.name, subBoolean);
      if (subBoolField) commandFields.push(subBoolField);
    }
  } else {
    const valued = command.flags.filter((f) => f.value);
    const boolean = command.flags.filter((f) => !f.value);
    for (const flag of valued) commandFields.push(fieldForValuedFlag(command, undefined, flag));
    const boolField = fieldForBooleanFlags(command, undefined, boolean);
    if (boolField) commandFields.push(boolField);
  }
  for (const pos of command.positionals) commandFields.push(fieldForPositional(command, pos));
}

/** Parses a space-separated "Flags" field into the set of flag identifiers (long or short form) it named. */
function parseFlagTokens(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t !== ''),
  );
}

export default defineTool({
  id: 'git-command-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'command',
      label: 'Command',
      type: 'select',
      default: 'commit',
      options: COMMANDS.map((c) => ({ value: c.name, label: `git ${c.name}` })),
    },
    {
      name: 'stash-subcommand',
      label: 'Stash action',
      type: 'select',
      default: 'push',
      options: [
        { value: 'push', label: 'push (save your current changes)' },
        { value: 'pop', label: 'pop (reapply and remove the most recent stash)' },
        { value: 'list', label: 'list (show every stash entry)' },
        { value: 'drop', label: 'drop (permanently discard a stash entry)' },
      ],
      visible: (values) => str(values, 'command') === 'stash',
    },
    {
      name: 'shell',
      label: 'Shell',
      type: 'radio',
      default: 'posix',
      options: SHELL_OPTIONS,
    },
    ...commandFields,
  ],
  examples: [
    {
      label: 'A commit message with an apostrophe, quoted correctly',
      values: { command: 'commit', 'commit-message': "fix: it's done", shell: 'posix' },
    },
  ],
  run(values): ToolResult {
    const command = str(values, 'command', 'commit');
    const shell = str(values, 'shell', 'posix') === 'powershell' ? 'powershell' : 'posix';
    const spec = COMMANDS.find((c) => c.name === command);
    if (!spec) return { outputs: [], errors: [{ message: `"${command}" is not a command this tool knows.` }] };

    const subcommand = spec.subcommands ? str(values, 'stash-subcommand', 'push') : undefined;
    const activeFlags = spec.subcommands ? (spec.subcommands.find((s) => s.name === subcommand)?.flags ?? []) : [];

    const flags: Record<string, string | number | boolean> = {};

    const applyGroup = (flagSpecs: readonly GitFlagSpec[], sub: string | undefined) => {
      const valued = flagSpecs.filter((f) => f.value);
      const boolean = flagSpecs.filter((f) => !f.value);
      for (const flagSpec of valued) {
        const fieldName = flagFieldName(command, sub, flagSpec);
        const raw = str(values, fieldName, '');
        if (raw.trim() !== '') flags[flagSpec.flag] = raw;
      }
      if (boolean.length > 0) {
        const tokens = parseFlagTokens(str(values, boolFlagsFieldName(command, sub), ''));
        for (const flagSpec of boolean) {
          if (tokens.has(flagSpec.flag) || (flagSpec.short && tokens.has(flagSpec.short))) {
            flags[flagSpec.flag] = true;
          }
        }
      }
    };

    applyGroup(spec.flags, undefined);
    if (subcommand) applyGroup(activeFlags, subcommand);

    const positionals = spec.positionals.map((pos) => str(values, positionalFieldName(command, pos), ''));

    try {
      const result = buildGitCommand({ command, subcommand, flags, positionals, shell });

      const table: OutputTable = {
        headers: ['Part', 'What it does', 'Reference'],
        rows: [
          [`git ${spec.name}`, 'The base command.', spec.docsUrl],
          ...result.explanations.map((e) => [e.flag, e.explanation, e.docsUrl]),
        ],
      };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Command', language: shell === 'posix' ? 'shell' : 'powershell', value: result.text },
        { kind: 'table', label: 'What each part does', table },
      ];
      for (const warning of result.warnings) {
        outputs.push({ kind: 'note', tone: 'warn', value: warning });
      }

      return { outputs, warnings: result.warnings };
    } catch (err) {
      if (err instanceof GitCommandError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not build that command.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
