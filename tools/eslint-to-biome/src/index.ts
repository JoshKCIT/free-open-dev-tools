import * as acorn from 'acorn';
import metaJson from './meta.json';
import { readYaml, YamlSourceError } from './yaml-source';
import { hasOwn, setOwn } from './own-property';
import { readLiteralConfig } from './literal-reader';
import { BIOME_RULE_MAP, BIOME_UNSUPPORTED_RULES, BIOME_VERSION, MAPPED_PLUGINS } from './biome-rule-map';

export const meta = metaJson;
export { BIOME_RULE_MAP, BIOME_UNSUPPORTED_RULES, BIOME_VERSION, MAPPED_PLUGINS };

/** The published schema URL convention for a Biome release, `https://biomejs.dev/schemas/<version>/schema.json`. */
const BIOME_SEMVER = BIOME_VERSION.replace(/^@biomejs\/biome@/, '');
const BIOME_SCHEMA_URL = `https://biomejs.dev/schemas/${BIOME_SEMVER}/schema.json`;

/** Input over this many bytes is refused before parsing, to avoid freezing the tab on a pathological paste. */
export const MAX_INPUT_BYTES = 1 * 1024 * 1024;

export class EslintToBiomeError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'EslintToBiomeError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type EslintConfigFormat = 'auto' | 'json' | 'yaml' | 'flat';

export interface TranslateEslintConfigOptions {
  format?: EslintConfigFormat;
  /** Migrate rules Biome marks nursery, matching Biome's own `--include-nursery` migrate flag. Default false. */
  includeNursery?: boolean;
  /** Migrate rules Biome marks inspired-by-another-tool, matching `--include-inspired`. Default false. */
  includeInspired?: boolean;
}

export interface MappedRuleReport {
  eslint: string;
  biome: string;
  level: 'warn' | 'error';
}

export interface UnmappedRuleReport {
  eslint: string;
  reason: string;
}

export interface CouldNotReadReport {
  line: number;
  column: number;
  what: string;
}

export interface TranslateEslintConfigResult {
  output: string;
  biome: Record<string, unknown>;
  mapped: MappedRuleReport[];
  unmapped: UnmappedRuleReport[];
  notCarried: string[];
  couldNotRead: CouldNotReadReport[];
  formatUsed: Exclude<EslintConfigFormat, 'auto'>;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strips `//` line comments and `/* *\/` block comments for the "did acorn consume the whole input" trailing check only -- never used for the actual parse, which reads comments as ordinary trivia. */
function stripCommentsForTrailingCheck(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Parses `text` as a single JSON or JSON-with-comments object literal using
 * acorn's expression parser (never a module, never evaluated): comments are
 * ordinary trivia to a JS tokenizer, so this one path covers both plain
 * JSON and JSON-with-comments legacy `.eslintrc` files. Returns `undefined`
 * (never throws) when the text is not a single object literal covering the
 * whole input, so `auto` detection can fall through to YAML.
 */
function tryParseJsonLike(text: string): { config: unknown; couldNotRead: CouldNotReadReport[] } | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  let ast: acorn.Node;
  try {
    ast = acorn.parseExpressionAt(trimmed, 0, { ecmaVersion: 'latest', locations: true });
  } catch {
    return undefined;
  }
  if (ast.type !== 'ObjectExpression') return undefined;
  const remainder = trimmed.slice(ast.end);
  if (stripCommentsForTrailingCheck(remainder).trim() !== '') return undefined;
  const { value, couldNotRead } = readLiteralConfig(ast);
  return { config: value, couldNotRead };
}

function tryParseYaml(text: string): { config: unknown } | undefined {
  try {
    const result = readYaml(text);
    const doc = result.documents[0];
    if (!doc) return undefined;
    return { config: doc.value };
  } catch (err) {
    if (err instanceof YamlSourceError) return undefined;
    throw err;
  }
}

/** Unwraps a package.json's `eslintConfig` key, recognised the same way ESLint itself recognises it: a top-level object carrying that key. */
function unwrapPackageJson(config: unknown): unknown {
  if (isPlainObject(config) && hasOwn(config, 'eslintConfig') && isPlainObject(config.eslintConfig)) {
    return config.eslintConfig;
  }
  return config;
}

type BiomeLevel = 'off' | 'warn' | 'error';

const LEVEL_RANK: Record<BiomeLevel, number> = { off: 0, warn: 1, error: 2 };

function parseSeverity(raw: unknown): { level: BiomeLevel; hasOptions: boolean } | undefined {
  const severityValue = Array.isArray(raw) ? raw[0] : raw;
  const hasOptions = Array.isArray(raw) && raw.length > 1;
  if (severityValue === 0 || severityValue === 'off') return { level: 'off', hasOptions };
  if (severityValue === 1 || severityValue === 'warn') return { level: 'warn', hasOptions };
  if (severityValue === 2 || severityValue === 'error') return { level: 'error', hasOptions };
  return undefined;
}

function findMapEntry(pluginName: string | undefined, ruleName: string) {
  return BIOME_RULE_MAP.find((e) => e.plugin === pluginName && e.eslint === ruleName);
}

function findUnsupportedEntry(pluginName: string | undefined, ruleName: string) {
  return BIOME_UNSUPPORTED_RULES.find((e) => e.plugin === pluginName && e.eslint === ruleName);
}

function unsupportedReasonText(reason: string, detail: string | undefined): string {
  if (reason === 'stylistic') return 'Stylistic, incompatible with Biome’s formatter.';
  if (reason === 'formatter-covers') return 'Redundant, completely covered by Biome’s formatter.';
  if (reason === 'formatter-option') return `Covered by Biome's "${detail}" formatter option.`;
  return 'Not implemented in this version of Biome.';
}

/** Splits `name` at its first `/`, matching how a scoped ESLint rule name (`@scope/plugin/rule` never occurs; `plugin/rule` always has exactly one meaningful slash) names its plugin. */
function splitRuleName(name: string): { plugin?: string; eslint: string } {
  const slash = name.indexOf('/');
  if (slash === -1) return { eslint: name };
  return { plugin: name.slice(0, slash), eslint: name.slice(slash + 1) };
}

interface RuleTranslationState {
  biomeRules: Record<string, Record<string, BiomeLevel>>;
  mapped: MappedRuleReport[];
  unmapped: UnmappedRuleReport[];
  notCarried: string[];
}

function applyRules(rulesValue: unknown, options: TranslateEslintConfigOptions, state: RuleTranslationState): void {
  if (!isPlainObject(rulesValue)) return;
  const includeNursery = options.includeNursery ?? false;
  const includeInspired = options.includeInspired ?? false;

  for (const fullName of Object.keys(rulesValue)) {
    const severity = parseSeverity(rulesValue[fullName]);
    if (!severity) continue; // not a real severity value -- nothing to report or carry
    const { plugin, eslint } = splitRuleName(fullName);

    if (severity.hasOptions) {
      state.notCarried.push(`Options for "${fullName}" are not carried over.`);
    }

    if (severity.level === 'off') continue; // nothing to migrate for a disabled rule

    const entry = findMapEntry(plugin, eslint);
    if (entry) {
      if (entry.nursery && !includeNursery) {
        state.unmapped.push({
          eslint: fullName,
          reason: 'Left out because it is a Biome nursery rule; ask again with nursery rules included.',
        });
        continue;
      }
      if (entry.inspired && !includeInspired) {
        state.unmapped.push({
          eslint: fullName,
          reason: 'Left out because it is inspired by another tool; ask again with inspired rules included.',
        });
        continue;
      }
      for (const target of entry.targets) {
        const group = state.biomeRules[target.group] ?? {};
        const existing = group[target.rule];
        const winner = existing && LEVEL_RANK[existing] > LEVEL_RANK[severity.level] ? existing : severity.level;
        setOwn(group as unknown as Record<string, unknown>, target.rule, winner);
        state.biomeRules[target.group] = group;
        state.mapped.push({
          eslint: fullName,
          biome: `${target.group}.${target.rule}`,
          level: winner as 'warn' | 'error',
        });
      }
      continue;
    }

    const unsupported = findUnsupportedEntry(plugin, eslint);
    if (unsupported) {
      state.unmapped.push({ eslint: fullName, reason: unsupportedReasonText(unsupported.reason, unsupported.detail) });
      continue;
    }

    if (plugin && !(MAPPED_PLUGINS as readonly string[]).includes(plugin)) {
      state.unmapped.push({ eslint: fullName, reason: `outside the bundled plugins: ${plugin}` });
      continue;
    }

    state.unmapped.push({ eslint: fullName, reason: `no Biome equivalent in Biome ${BIOME_SEMVER}` });
  }
}

const NOT_CARRIED_KEYS: Record<string, string> = {
  extends: 'extends',
  plugins: 'plugins',
  parser: 'parser',
  parserOptions: 'parserOptions',
  env: 'env',
  settings: 'settings',
  overrides: 'overrides',
  ignorePatterns: 'ignorePatterns',
  root: 'root',
};

function applyNotCarriedTopLevelKeys(config: Record<string, unknown>, notCarried: string[]): void {
  for (const key of Object.keys(NOT_CARRIED_KEYS)) {
    if (hasOwn(config, key)) {
      notCarried.push(`"${key}" is not carried over; it has no equivalent in a Biome configuration.`);
    }
  }
  for (const key of Object.keys(config)) {
    if (key === 'rules' || key === 'globals' || key in NOT_CARRIED_KEYS) continue;
    notCarried.push(`"${key}" is not carried over; it has no equivalent in a Biome configuration.`);
  }
}

/** Collects every own key of `globalsValue` into `acc` (a plain object used only as a de-duplicating set), guarding a visitor-supplied key like `__proto__` with `setOwn`. */
function collectGlobalNames(globalsValue: unknown, acc: Record<string, true>): void {
  if (!isPlainObject(globalsValue)) return;
  for (const key of Object.keys(globalsValue)) {
    setOwn(acc, key, true);
  }
}

function parseFlatConfig(_text: string): never {
  throw new EslintToBiomeError('Flat config file support is not available yet.');
}

/**
 * Translates an ESLint configuration (legacy JSON/JSON-with-comments,
 * legacy YAML, a `package.json`'s `eslintConfig` key, or -- once
 * implemented -- a flat `eslint.config.js`) into the closest Biome
 * `biome.json`, using the bundled rule map for a pinned Biome version.
 * Every rule is either mapped or listed as unmapped with a reason; every
 * other recognised key is listed under `notCarried`. Nothing in `text` is
 * ever evaluated, imported or required (D-107).
 */
export function translateEslintConfig(
  text: string,
  options: TranslateEslintConfigOptions = {},
): TranslateEslintConfigResult {
  if (byteLength(text) > MAX_INPUT_BYTES) {
    throw new EslintToBiomeError(
      'This input is larger than 1 MB, so it was refused rather than risk freezing the tab.',
    );
  }

  const requestedFormat = options.format ?? 'auto';
  let formatUsed: Exclude<EslintConfigFormat, 'auto'>;
  let rawConfig: unknown;
  let couldNotRead: CouldNotReadReport[] = [];

  if (requestedFormat === 'json') {
    const parsed = tryParseJsonLike(text);
    if (!parsed) throw new EslintToBiomeError('This does not look like a single JSON object.');
    rawConfig = parsed.config;
    couldNotRead = parsed.couldNotRead;
    formatUsed = 'json';
  } else if (requestedFormat === 'yaml') {
    const parsed = tryParseYaml(text);
    if (!parsed) throw new EslintToBiomeError('This could not be read as YAML.');
    rawConfig = parsed.config;
    formatUsed = 'yaml';
  } else if (requestedFormat === 'flat') {
    rawConfig = parseFlatConfig(text);
    formatUsed = 'flat';
  } else {
    const asJson = tryParseJsonLike(text);
    if (asJson) {
      rawConfig = asJson.config;
      couldNotRead = asJson.couldNotRead;
      formatUsed = 'json';
    } else {
      const asYaml = tryParseYaml(text);
      if (asYaml) {
        rawConfig = asYaml.config;
        formatUsed = 'yaml';
      } else {
        rawConfig = parseFlatConfig(text);
        formatUsed = 'flat';
      }
    }
  }

  const config = unwrapPackageJson(rawConfig);
  if (!isPlainObject(config)) {
    throw new EslintToBiomeError('This does not look like an ESLint configuration object.');
  }

  const state: RuleTranslationState = { biomeRules: {}, mapped: [], unmapped: [], notCarried: [] };
  applyRules(config.rules, options, state);
  applyNotCarriedTopLevelKeys(config, state.notCarried);

  const globalNames: Record<string, true> = {};
  collectGlobalNames(config.globals, globalNames);
  const globals = Object.keys(globalNames).sort();

  const biome: Record<string, unknown> = {
    $schema: BIOME_SCHEMA_URL,
    linter: { rules: { recommended: false, ...state.biomeRules } },
  };
  if (globals.length > 0) {
    biome.javascript = { globals };
  }

  state.mapped.sort((a, b) => a.eslint.localeCompare(b.eslint));
  state.unmapped.sort((a, b) => a.eslint.localeCompare(b.eslint));

  return {
    output: JSON.stringify(biome, null, 2),
    biome,
    mapped: state.mapped,
    unmapped: state.unmapped,
    notCarried: state.notCarried,
    couldNotRead,
    formatUsed,
  };
}
