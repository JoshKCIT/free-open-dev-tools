import * as acorn from 'acorn';
import metaJson from './meta.json';
import { readYaml, YamlSourceError } from './yaml-source';
import { hasOwn, setOwn } from './own-property';
import { readLiteralConfig, describeUnreadableNode, nodePosition } from './literal-reader';
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

/** Package names this tool treats as "inside the bundled plugin set" for an import declaration's own report line -- a best-effort match on common real package names, not the rule-name prefixes `MAPPED_PLUGINS` itself lists. */
const BUNDLED_IMPORT_HINTS = [
  '@eslint/js',
  '@typescript-eslint',
  'typescript-eslint',
  'eslint-plugin-react-hooks',
  'eslint-plugin-react',
  'eslint-plugin-jsx-a11y',
  'eslint-plugin-import',
  'eslint-plugin-unicorn',
];

function isBundledImportSource(source: string): boolean {
  return BUNDLED_IMPORT_HINTS.some((hint) => source === hint || source.startsWith(`${hint}/`));
}

interface AcornProgram extends acorn.Node {
  body: acorn.Node[];
}

interface ImportDeclarationNode extends acorn.Node {
  type: 'ImportDeclaration';
  source: { value: unknown };
}

interface ExportDefaultDeclarationNode extends acorn.Node {
  type: 'ExportDefaultDeclaration';
  declaration: acorn.Node;
}

interface AssignmentLike extends acorn.Node {
  type: 'ExpressionStatement';
  expression: { type: string; left?: acorn.Node; right?: acorn.Node };
}

interface MemberLike extends acorn.Node {
  type: 'MemberExpression';
  object: acorn.Node & { type: string; name?: string };
  property: acorn.Node & { type: string; name?: string };
  computed: boolean;
}

function isModuleExportsTarget(node: acorn.Node | undefined): boolean {
  if (!node || node.type !== 'MemberExpression') return false;
  const member = node as MemberLike;
  return (
    !member.computed &&
    member.object.type === 'Identifier' &&
    member.object.name === 'module' &&
    member.property.type === 'Identifier' &&
    member.property.name === 'exports'
  );
}

interface ArrayLikeNode extends acorn.Node {
  elements?: (acorn.Node | null)[];
  arguments?: acorn.Node[];
}

/**
 * Reads the flat config's exported value as a list of config entries. A
 * real array literal (`export default [...]`) reads each element directly.
 * A call expression (`export default tseslint.config(...)`, a common
 * helper-function pattern) is reported as a helper call, but its own
 * arguments are still walked exactly like array elements -- the same
 * "read from inside, effect unknown" treatment `literal-reader.ts` gives a
 * call's own object arguments. A bare single object is treated as a
 * one-entry array. Anything else is reported as could-not-read and yields
 * no entries.
 */
function extractConfigEntries(node: acorn.Node, couldNotRead: CouldNotReadReport[]): Record<string, unknown>[] {
  if (node.type === 'ObjectExpression') {
    const { value, couldNotRead: nested } = readLiteralConfig(node);
    couldNotRead.push(...nested);
    return isPlainObject(value) ? [value] : [];
  }

  let elements: (acorn.Node | null)[];
  if (node.type === 'ArrayExpression') {
    elements = (node as ArrayLikeNode).elements ?? [];
  } else if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    couldNotRead.push({ ...nodePosition(node), what: 'a helper call building the config array' });
    elements = (node as ArrayLikeNode).arguments ?? [];
  } else {
    couldNotRead.push({ ...nodePosition(node), what: describeUnreadableNode(node) });
    return [];
  }

  const entries: Record<string, unknown>[] = [];
  for (const el of elements) {
    if (el === null) continue;
    if (el.type === 'SpreadElement') {
      couldNotRead.push({ ...nodePosition(el), what: 'a spread' });
      continue;
    }
    if (el.type === 'ObjectExpression') {
      const { value, couldNotRead: nested } = readLiteralConfig(el);
      couldNotRead.push(...nested);
      if (isPlainObject(value)) entries.push(value);
      continue;
    }
    couldNotRead.push({ ...nodePosition(el), what: describeUnreadableNode(el) });
  }
  return entries;
}

interface FlatParseResult {
  entries: Record<string, unknown>[];
  couldNotRead: CouldNotReadReport[];
  notCarried: string[];
}

/**
 * Parses a flat `eslint.config.js`/`.mjs`/`.cjs` file's syntax tree only
 * (D-107): `acorn.parse` builds the tree, nothing is ever evaluated,
 * imported or required. Finds the default export (`export ... default`) or
 * a `module.exports = ...` assignment, and reads it as a list of config
 * entries. Each `import` declaration is listed under `notCarried` naming
 * its source and whether that source is inside or outside the bundled
 * plugin set.
 */
function parseFlatConfig(text: string): FlatParseResult {
  let program: AcornProgram;
  try {
    program = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as AcornProgram;
  } catch (err) {
    const parseError = err as { message?: string; loc?: { line: number; column: number } };
    throw new EslintToBiomeError(parseError.message ?? 'This could not be parsed as JavaScript.', {
      line: parseError.loc?.line,
      column: parseError.loc ? parseError.loc.column + 1 : undefined,
    });
  }

  const notCarried: string[] = [];
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration') {
      const source = String((stmt as ImportDeclarationNode).source.value);
      notCarried.push(
        isBundledImportSource(source)
          ? `Import "${source}" is inside the bundled plugin set.`
          : `Import "${source}" is outside the bundled plugin set.`,
      );
    }
  }

  let exportNode: acorn.Node | undefined;
  for (const stmt of program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      exportNode = (stmt as ExportDefaultDeclarationNode).declaration;
      break;
    }
    if (stmt.type === 'ExpressionStatement') {
      const expr = (stmt as AssignmentLike).expression;
      if (expr.type === 'AssignmentExpression' && isModuleExportsTarget(expr.left) && expr.right) {
        exportNode = expr.right;
        break;
      }
    }
  }

  if (!exportNode) {
    throw new EslintToBiomeError('No default export or module.exports assignment was found.');
  }

  const couldNotRead: CouldNotReadReport[] = [];
  const entries = extractConfigEntries(exportNode, couldNotRead);
  return { entries, couldNotRead, notCarried };
}

const FLAT_HANDLED_KEYS = new Set(['rules', 'languageOptions', 'files', 'ignores', 'plugins', 'linterOptions', 'name']);

/** Applies one flat config array entry's `rules` and `languageOptions.globals` into `state`/`globalNames`, and lists every other recognised key (`files`, `ignores`, `plugins`, `linterOptions`, and anything else) under `notCarried` -- `files` and `ignores` name their own patterns. */
function applyFlatEntry(
  entry: Record<string, unknown>,
  options: TranslateEslintConfigOptions,
  state: RuleTranslationState,
  globalNames: Record<string, true>,
): void {
  applyRules(entry.rules, options, state);

  if (isPlainObject(entry.languageOptions)) {
    collectGlobalNames(entry.languageOptions.globals, globalNames);
    if (Object.keys(entry.languageOptions).some((k) => k !== 'globals')) {
      state.notCarried.push('"languageOptions" (apart from globals) is not carried over.');
    }
  }

  if (hasOwn(entry, 'files')) {
    state.notCarried.push(`A "files" pattern (${JSON.stringify(entry.files)}) is not carried over.`);
  }
  if (hasOwn(entry, 'ignores')) {
    state.notCarried.push(`An "ignores" pattern (${JSON.stringify(entry.ignores)}) is not carried over.`);
  }
  if (hasOwn(entry, 'plugins')) {
    state.notCarried.push('"plugins" is not carried over; it has no equivalent in a Biome configuration.');
  }
  if (hasOwn(entry, 'linterOptions')) {
    state.notCarried.push('"linterOptions" is not carried over; it has no equivalent in a Biome configuration.');
  }
  for (const key of Object.keys(entry)) {
    if (FLAT_HANDLED_KEYS.has(key)) continue;
    state.notCarried.push(`"${key}" is not carried over; it has no equivalent in a Biome configuration.`);
  }
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

  if (requestedFormat === 'json') formatUsed = 'json';
  else if (requestedFormat === 'yaml') formatUsed = 'yaml';
  else if (requestedFormat === 'flat') formatUsed = 'flat';
  else {
    const asJson = tryParseJsonLike(text);
    if (asJson) formatUsed = 'json';
    else if (tryParseYaml(text)) formatUsed = 'yaml';
    else formatUsed = 'flat';
  }

  const state: RuleTranslationState = { biomeRules: {}, mapped: [], unmapped: [], notCarried: [] };
  const globalNames: Record<string, true> = {};
  let couldNotRead: CouldNotReadReport[] = [];

  if (formatUsed === 'flat') {
    const parsed = parseFlatConfig(text);
    couldNotRead = parsed.couldNotRead;
    state.notCarried.push(...parsed.notCarried);
    for (const entry of parsed.entries) {
      applyFlatEntry(entry, options, state, globalNames);
    }
  } else {
    let rawConfig: unknown;
    if (formatUsed === 'json') {
      const parsed = tryParseJsonLike(text);
      if (!parsed) throw new EslintToBiomeError('This does not look like a single JSON object.');
      rawConfig = parsed.config;
      couldNotRead = parsed.couldNotRead;
    } else {
      const parsed = tryParseYaml(text);
      if (!parsed) throw new EslintToBiomeError('This could not be read as YAML.');
      rawConfig = parsed.config;
    }

    const config = unwrapPackageJson(rawConfig);
    if (!isPlainObject(config)) {
      throw new EslintToBiomeError('This does not look like an ESLint configuration object.');
    }

    applyRules(config.rules, options, state);
    applyNotCarriedTopLevelKeys(config, state.notCarried);
    collectGlobalNames(config.globals, globalNames);
  }

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
