/**
 * Test-side generator for `src/biome-rule-map.ts`: parses Biome's own
 * vendored generated migrate sources (`test/fixtures/biome/`) -- the exact
 * match arms Biome's `migrate eslint` CLI subcommand compiles from -- into
 * this tool's bundled rule map, scoped to ESLint core and the six bundled
 * plugins (`MAPPED_PLUGINS`, D-108). A required test asserts the committed
 * module is exactly what a fresh build from the vendored files produces.
 *
 * Only writes `src/biome-rule-map.ts` back to disk when
 * `process.env.FODT_REGENERATE === '1'`; every other run is read-only.
 *
 * This parses Rust source text with regular expressions, not a real Rust
 * parser -- it counts every match arm independently of what it manages to
 * understand (`countNamedArms`) and throws if a rule scoped into this
 * tool's bundle (core or a `MAPPED_PLUGINS` prefix) yields no Biome target,
 * so a shape this generator does not recognise fails loudly instead of
 * silently bundling an empty mapping.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures', 'biome');
const OUTPUT_PATH = join(ROOT, 'src', 'biome-rule-map.ts');

export const BIOME_TAG = '@biomejs/biome@2.5.14';
export const BIOME_COMMIT = 'af4365d2b80177d0e0434c0ed4fd2c9171afc56c';

/** ESLint core plus these plugin prefixes are the only rules this tool bundles a mapping for (D-108). */
export const MAPPED_PLUGINS = ['@typescript-eslint', 'react', 'react-hooks', 'jsx-a11y', 'import', 'unicorn'] as const;

/** `RuleSource` enum variant name (in Biome's own Rust source) to the ESLint plugin prefix it represents. */
const NAMESPACE_TO_PLUGIN: Record<string, string | undefined> = {
  Eslint: undefined,
  EslintTypeScript: '@typescript-eslint',
  EslintReact: 'react',
  EslintReactHooks: 'react-hooks',
  EslintJsxA11y: 'jsx-a11y',
  EslintImport: 'import',
  EslintUnicorn: 'unicorn',
};

export interface BiomeMapTarget {
  group: string;
  rule: string;
}

export interface BiomeMapEntry {
  eslint: string;
  plugin?: string;
  targets: BiomeMapTarget[];
  nursery: boolean;
  inspired: boolean;
}

export type BiomeUnsupportedReason = 'stylistic' | 'formatter-covers' | 'formatter-option';

export interface BiomeUnsupportedEntry {
  eslint: string;
  plugin?: string;
  reason: BiomeUnsupportedReason;
  detail?: string;
}

export interface BuildRuleMapStats {
  mappedCount: number;
  unsupportedCount: number;
  perPlugin: Record<string, number>;
}

export interface BuildRuleMapResult {
  map: BiomeMapEntry[];
  unsupported: BiomeUnsupportedEntry[];
  stats: BuildRuleMapStats;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Splits `eslint-name` at the first `/`: `undefined` plugin for a bare core rule name. */
function splitPluginName(name: string): { plugin?: string; eslint: string } {
  const slash = name.indexOf('/');
  if (slash === -1) return { eslint: name };
  return { plugin: name.slice(0, slash), eslint: name.slice(slash + 1) };
}

function isBundledName(name: string): boolean {
  const { plugin } = splitPluginName(name);
  return plugin === undefined || (MAPPED_PLUGINS as readonly string[]).includes(plugin);
}

interface RawArm {
  name: string;
  body: string;
}

/**
 * Splits the body of Biome's `match eslint_name { ... }` block into one
 * `RawArm` per `"name" => { ... }` arm, tracking brace depth so a `{`
 * inside an arm's own body never terminates the arm early. Stops at the
 * catch-all `_ => { ... }` arm, which this generator does not need.
 */
function splitArms(matchBody: string): RawArm[] {
  const arms: RawArm[] = [];
  const headerRe = /"((?:[^"\\]|\\.)*)"\s*=>\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(matchBody)) !== null) {
    const name = match[1]!;
    const bodyStart = headerRe.lastIndex;
    let depth = 1;
    let i = bodyStart;
    for (; i < matchBody.length && depth > 0; i++) {
      const ch = matchBody[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth !== 0) {
      throw new Error(`unbalanced braces in match arm "${name}" starting at offset ${match.index}`);
    }
    const body = matchBody.slice(bodyStart, i - 1);
    arms.push({ name, body });
    headerRe.lastIndex = i;
  }
  return arms;
}

/** Counts `"name" => {` headers independently of `splitArms`'s own brace walk, as a cross-check that nothing was merged or skipped. */
function countNamedArms(matchBody: string): number {
  const re = /"(?:[^"\\]|\\.)*"\s*=>\s*\{/g;
  let count = 0;
  while (re.exec(matchBody) !== null) count++;
  return count;
}

/** Every `{ group, rule }` target an arm's body sets, in source order. */
function extractTargets(body: string): BiomeMapTarget[] {
  const targets: BiomeMapTarget[] = [];
  const re = /rules\.(\w+)\.get_or_insert_with\(Default::default\);[\s\S]*?\.unwrap_group_as_mut\(\)\s*\.(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    targets.push({ group: match[1]!, rule: snakeToCamel(match[2]!) });
  }
  return targets;
}

function extractFunctionBody(source: string, signature: RegExp): string {
  const sigMatch = signature.exec(source);
  if (!sigMatch) throw new Error(`could not find function matching ${signature}`);
  const braceStart = source.indexOf('{', sigMatch.index + sigMatch[0].length - 1);
  if (braceStart === -1) throw new Error('could not find function body opening brace');
  let depth = 1;
  let i = braceStart + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  return source.slice(braceStart + 1, i - 1);
}

function extractMatchBody(fnBody: string): string {
  const matchIdx = fnBody.indexOf('match eslint_name {');
  if (matchIdx === -1) throw new Error('could not find "match eslint_name {"');
  const braceStart = fnBody.indexOf('{', matchIdx);
  let depth = 1;
  let i = braceStart + 1;
  for (; i < fnBody.length && depth > 0; i++) {
    if (fnBody[i] === '{') depth++;
    else if (fnBody[i] === '}') depth--;
  }
  return fnBody.slice(braceStart + 1, i - 1);
}

function buildMap(ruleSourceText: string): { map: BiomeMapEntry[]; totalArms: number } {
  const fnBody = extractFunctionBody(ruleSourceText, /pub\(crate\) fn migrate_eslint_any_rule\(/);
  const matchBody = extractMatchBody(fnBody);

  const totalArms = countNamedArms(matchBody);
  const arms = splitArms(matchBody);
  if (arms.length !== totalArms) {
    throw new Error(`arm count mismatch: split ${arms.length} arms but counted ${totalArms} headers`);
  }

  const map: BiomeMapEntry[] = [];
  for (const arm of arms) {
    if (!isBundledName(arm.name)) continue;
    const { plugin, eslint } = splitPluginName(arm.name);
    const targets = extractTargets(arm.body);
    if (targets.length === 0) {
      throw new Error(`arm "${arm.name}" is in the bundled scope but no Biome target could be extracted from it`);
    }
    const nursery = /!options\.include_nursery/.test(arm.body);
    const inspired = /!options\.include_inspired/.test(arm.body);
    map.push({ eslint, plugin, targets, nursery, inspired });
  }

  map.sort((a, b) => (a.plugin ?? '').localeCompare(b.plugin ?? '') || a.eslint.localeCompare(b.eslint));
  return { map, totalArms };
}

/**
 * Parses `UnsupportedRule(<Namespace>("<name>"), <Reason>)` entries (some
 * split across lines) from `unsupported_rules.rs`, keeping only entries
 * whose namespace is `Eslint` (core) or one of `MAPPED_PLUGINS`'s Rust
 * enum variants.
 */
function buildUnsupported(unsupportedText: string): BiomeUnsupportedEntry[] {
  const entryRe =
    /UnsupportedRule\(\s*(\w+)\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*,\s*(FormatterCovers|Stylistic|FormatterOption\(\s*"((?:[^"\\]|\\.)*)"\s*\))\s*\)/g;
  const entries: BiomeUnsupportedEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(unsupportedText)) !== null) {
    const namespace = match[1]!;
    if (!(namespace in NAMESPACE_TO_PLUGIN)) continue;
    const plugin = NAMESPACE_TO_PLUGIN[namespace];
    const eslint = match[2]!;
    const reasonRaw = match[3]!;
    let reason: BiomeUnsupportedReason;
    let detail: string | undefined;
    if (reasonRaw === 'FormatterCovers') reason = 'formatter-covers';
    else if (reasonRaw === 'Stylistic') reason = 'stylistic';
    else {
      reason = 'formatter-option';
      detail = match[4];
    }
    entries.push({ eslint, plugin, reason, detail });
  }
  entries.sort((a, b) => (a.plugin ?? '').localeCompare(b.plugin ?? '') || a.eslint.localeCompare(b.eslint));
  return entries;
}

/**
 * Builds `BIOME_RULE_MAP` and `BIOME_UNSUPPORTED_RULES` from the vendored
 * Biome migrate sources under `sourceDir`. Counts every match arm
 * independently of what it understood (`stats`) and throws if a rule in
 * this tool's bundled scope cannot be parsed.
 */
export function buildRuleMap(sourceDir: string): BuildRuleMapResult {
  const ruleSourceText = readFileSync(join(sourceDir, 'eslint_any_rule_to_biome.rs'), 'utf8');
  const unsupportedText = readFileSync(join(sourceDir, 'unsupported_rules.rs'), 'utf8');

  const { map } = buildMap(ruleSourceText);
  const unsupported = buildUnsupported(unsupportedText);

  const perPlugin: Record<string, number> = {};
  for (const entry of map) {
    const key = entry.plugin ?? 'eslint-core';
    perPlugin[key] = (perPlugin[key] ?? 0) + 1;
  }

  return {
    map,
    unsupported,
    stats: { mappedCount: map.length, unsupportedCount: unsupported.length, perPlugin },
  };
}

function renderEntry(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Renders `src/biome-rule-map.ts`'s exact source text from a built result. */
export function renderBiomeRuleMapModule(result: BuildRuleMapResult): string {
  return [
    '/**',
    " * A rule-mapping table generated from Biome's own generated ESLint migrate",
    ' * match arms (MIT OR Apache-2.0), bundled for a pinned Biome version and',
    ' * scoped to ESLint core plus six common plugins (D-108). Vendored byte for',
    ' * byte at test/fixtures/biome/; this module is a generated copy with an',
    ' * explicit wide type so the compiler never infers a literal type for it.',
    ' * See test/build-rule-map.ts for the generator this module must equal,',
    ' * and src/biome-rule-map-NOTICE.txt for the full attribution notice.',
    ' */',
    '',
    `export const BIOME_VERSION = ${JSON.stringify(BIOME_TAG)};`,
    `export const BIOME_COMMIT = ${JSON.stringify(BIOME_COMMIT)};`,
    `export const MAPPED_PLUGINS = ${JSON.stringify(MAPPED_PLUGINS)} as const;`,
    '',
    `export const BIOME_RULE_MAP: Readonly<{ eslint: string; plugin?: string; targets: { group: string; rule: string }[]; nursery: boolean; inspired: boolean }[]> = ${renderEntry(result.map)} as const;`,
    '',
    `export const BIOME_UNSUPPORTED_RULES: Readonly<{ eslint: string; plugin?: string; reason: string; detail?: string }[]> = ${renderEntry(result.unsupported)} as const;`,
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  const result = buildRuleMap(FIXTURES_DIR);
  writeFileSync(OUTPUT_PATH, renderBiomeRuleMapModule(result));
}
