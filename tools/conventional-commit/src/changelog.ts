import { MAX_ENTRY_CHARACTERS, MAX_SHOWN_CHARACTERS } from './limits';
import type { ParsedMessage } from './parse';
import { visible } from './visible';

/** Types that get a section of their own, in this order. The headings are a common convention, not the specification. */
const MAIN: ReadonlyArray<readonly [string, string]> = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance Improvements'],
  ['revert', 'Reverts'],
];

/** Types left out unless asked for, in this order. */
const HIDDEN: ReadonlyArray<readonly [string, string]> = [
  ['docs', 'Documentation'],
  ['style', 'Styles'],
  ['chore', 'Miscellaneous Chores'],
  ['test', 'Tests'],
  ['build', 'Build System'],
  ['ci', 'Continuous Integration'],
  ['refactor', 'Code Refactoring'],
];

export interface ChangelogOptions {
  /** Also list docs, style, chore, test, build, ci and refactor, and every other type under Other Changes. */
  includeHidden?: boolean;
}

/**
 * Drafts a Markdown changelog from the valid messages: Breaking Changes first (the text of the BREAKING CHANGE footer, or
 * the description when only the mark is used), then Features, Bug Fixes, Performance Improvements and Reverts, then, when
 * asked, the other types. Inside each section the entries keep the order of the messages, so equal input gives equal text.
 * A breaking message is listed under Breaking Changes and also under its own type. Entries are `- **scope:** description`
 * or `- description`; every text goes through `visible`, so a hidden character is written as an escape. An empty text means
 * there is nothing to list.
 */
export function changelogFor(messages: readonly ParsedMessage[], options: ChangelogOptions = {}): string {
  const includeHidden = options.includeHidden === true;
  const breaking: string[] = [];
  const groups = new Map<string, string[]>();
  const other: string[] = [];
  const known = new Set<string>(MAIN.map(([type]) => type));
  if (includeHidden) for (const [type] of HIDDEN) known.add(type);

  for (const message of messages) {
    if (!message.valid || message.type === null) continue;
    const key = message.type.toLowerCase();
    const scope = message.scope === null ? '' : `**${visible(message.scope, MAX_SHOWN_CHARACTERS)}:** `;
    if (message.breaking) {
      breaking.push(`- ${scope}${visible(message.breakingText ?? message.description, MAX_ENTRY_CHARACTERS)}`);
    }
    const text = visible(message.description, MAX_ENTRY_CHARACTERS);
    if (known.has(key)) {
      const list = groups.get(key) ?? [];
      list.push(`- ${scope}${text}`);
      groups.set(key, list);
    } else if (includeHidden) {
      const type = visible(message.type, MAX_SHOWN_CHARACTERS);
      const inside = message.scope === null ? type : `${type}(${visible(message.scope, MAX_SHOWN_CHARACTERS)})`;
      other.push(`- **${inside}:** ${text}`);
    }
  }

  const sections: string[] = [];
  const add = (heading: string, entries: readonly string[] | undefined): void => {
    if (entries !== undefined && entries.length > 0) sections.push(`### ${heading}\n\n${entries.join('\n')}`);
  };
  add('Breaking Changes', breaking);
  for (const [type, heading] of MAIN) add(heading, groups.get(type));
  if (includeHidden) {
    for (const [type, heading] of HIDDEN) add(heading, groups.get(type));
    add('Other Changes', other);
  }
  return sections.join('\n\n');
}
