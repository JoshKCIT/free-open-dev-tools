import meta from './meta.json';
import { findOption, type TsConfigOption } from './options-catalogue';
import { findPreset } from './presets';

export { meta };
export { OPTIONS, findOption } from './options-catalogue';
export { PRESETS, findPreset } from './presets';

export class TsconfigBuilderError extends Error {}

export interface BuildTsconfigOptions {
  /** A `PRESETS` id, applied before `options`. */
  preset?: string;
  /**
   * Option name to value. A boolean-typed catalogue option accepts a real
   * boolean or the strings "true"/"false"; an enum-typed option accepts one
   * of its catalogue values (matched case-insensitively); a list-typed
   * option accepts an array, or a single comma-separated string.
   */
  options?: Readonly<Record<string, boolean | string | readonly string[]>>;
  include?: readonly string[];
  exclude?: readonly string[];
  extendsPath?: string;
  /** When true, writes a `//` comment above each option giving its explanation and reference link. */
  comments?: boolean;
}

export interface TsconfigConflict {
  /** The TypeScript compiler's own diagnostic code for this exact combination, cited so a reader can look it up. */
  code: number;
  /** The catalogue option names involved. */
  options: readonly string[];
  message: string;
}

export interface BuildTsconfigResult {
  /** The tsconfig.json text, ready to save. */
  output: string;
  /** The parsed configuration object `output` represents (post-comments). */
  object: {
    extends?: string;
    compilerOptions: Record<string, unknown>;
    include?: string[];
    exclude?: string[];
  };
  /** Problems with the input, and TypeScript 6.0 deprecation notices for anything written. */
  warnings: string[];
  /** Option combinations the pinned compiler itself reports a diagnostic for. */
  conflicts: TsconfigConflict[];
}

// --- Value coercion, checked against the catalogue ------------------------

function coerceBoolean(name: string, raw: unknown, warnings: string[]): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  warnings.push(`"${name}" takes true or false, not "${String(raw)}", so it was left out.`);
  return undefined;
}

function coerceEnum(name: string, raw: unknown, values: readonly string[], warnings: string[]): string | undefined {
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (typeof text !== 'string') {
    warnings.push(`"${name}" needs a single text value, so it was left out.`);
    return undefined;
  }
  const match = values.find((v) => v.toLowerCase() === text.trim().toLowerCase());
  if (!match) {
    warnings.push(`"${name}" does not accept "${text}"; accepted values are ${values.join(', ')}. It was left out.`);
    return undefined;
  }
  return match;
}

function coerceList(
  name: string,
  raw: unknown,
  values: readonly string[] | undefined,
  warnings: string[],
): string[] | undefined {
  const items = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  if (!items) {
    warnings.push(`"${name}" needs a comma-separated list, so it was left out.`);
    return undefined;
  }
  if (!values) return items;
  const result: string[] = [];
  for (const item of items) {
    const match = values.find((v) => v.toLowerCase() === item.toLowerCase());
    if (!match) {
      warnings.push(`"${name}" does not accept "${item}"; it was left out of the list.`);
      continue;
    }
    result.push(match);
  }
  return result;
}

function coerceString(name: string, raw: unknown, warnings: string[]): string | undefined {
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  warnings.push(`"${name}" needs a non-empty text value, so it was left out.`);
  return undefined;
}

function applyValue(option: TsConfigOption, raw: unknown, warnings: string[]): unknown {
  switch (option.type) {
    case 'boolean':
      return coerceBoolean(option.name, raw, warnings);
    case 'enum':
      return coerceEnum(option.name, raw, option.values ?? [], warnings);
    case 'list':
      return coerceList(option.name, raw, option.values, warnings);
    case 'string':
      return coerceString(option.name, raw, warnings);
    default:
      return undefined;
  }
}

// --- Conflict rules, each cited to the pinned compiler's own diagnostic ---

const NODENEXT_FAMILY = ['node16', 'node18', 'node20', 'nodenext'];
const MODERN_MODULES = [
  'preserve',
  'es2015',
  'es2016',
  'es2017',
  'es2018',
  'es2019',
  'es2020',
  'es2021',
  'es2022',
  'es2023',
  'es2024',
  'esnext',
];

interface ConflictRule {
  id: string;
  code: number;
  applies: (o: Record<string, unknown>) => boolean;
  message: (o: Record<string, unknown>) => string;
  options: (o: Record<string, unknown>) => string[];
}

const CONFLICTS: readonly ConflictRule[] = [
  {
    id: 'bundler-resolution-needs-modern-module',
    code: 5095,
    applies: (o) =>
      o.moduleResolution === 'bundler' && typeof o.module === 'string' && !MODERN_MODULES.includes(o.module),
    message: (o) =>
      `moduleResolution "bundler" can only be used when module is "preserve" or "es2015" or later, not "${o.module}" (ts(5095)).`,
    options: () => ['moduleResolution', 'module'],
  },
  {
    id: 'nodenext-module-needs-matching-resolution',
    code: 5109,
    applies: (o) =>
      typeof o.module === 'string' &&
      NODENEXT_FAMILY.includes(o.module) &&
      typeof o.moduleResolution === 'string' &&
      !NODENEXT_FAMILY.includes(o.moduleResolution),
    message: (o) =>
      `moduleResolution must be left unset or match module ("${o.module}") when module is node16, node18, node20 or nodenext (ts(5109)).`,
    options: () => ['module', 'moduleResolution'],
  },
  {
    id: 'emit-declaration-only-needs-declaration',
    code: 5069,
    applies: (o) => o.emitDeclarationOnly === true && o.declaration !== true && o.composite !== true,
    message: () => `emitDeclarationOnly cannot be specified without declaration or composite (ts(5069)).`,
    options: () => ['emitDeclarationOnly', 'declaration'],
  },
  {
    id: 'isolated-declarations-needs-declaration',
    code: 5069,
    applies: (o) => o.isolatedDeclarations === true && o.declaration !== true && o.composite !== true,
    message: () => `isolatedDeclarations cannot be specified without declaration or composite (ts(5069)).`,
    options: () => ['isolatedDeclarations', 'declaration'],
  },
  {
    id: 'declaration-map-needs-declaration',
    code: 5069,
    applies: (o) => o.declarationMap === true && o.declaration !== true && o.composite !== true,
    message: () => `declarationMap cannot be specified without declaration or composite (ts(5069)).`,
    options: () => ['declarationMap', 'declaration'],
  },
  {
    id: 'allow-importing-ts-extensions-needs-no-emit',
    code: 5096,
    applies: (o) => o.allowImportingTsExtensions === true && o.noEmit !== true && o.emitDeclarationOnly !== true,
    message: () => `allowImportingTsExtensions can only be used when noEmit or emitDeclarationOnly is set (ts(5096)).`,
    options: () => ['allowImportingTsExtensions', 'noEmit'],
  },
  {
    id: 'out-file-needs-concatenatable-module',
    code: 6082,
    applies: (o) =>
      typeof o.outFile === 'string' &&
      o.outFile !== '' &&
      typeof o.module === 'string' &&
      !['amd', 'system'].includes(o.module),
    message: () => `Only "amd" and "system" modules are supported alongside outFile (ts(6082)).`,
    options: () => ['outFile', 'module'],
  },
  {
    id: 'inline-source-map-conflicts-with-source-map',
    code: 5053,
    applies: (o) => o.inlineSourceMap === true && o.sourceMap === true,
    message: () => `sourceMap cannot be specified with inlineSourceMap (ts(5053)).`,
    options: () => ['inlineSourceMap', 'sourceMap'],
  },
  {
    id: 'composite-cannot-disable-declaration',
    code: 6304,
    applies: (o) => o.composite === true && o.declaration === false,
    message: () => `A composite project may not disable declaration emit (ts(6304)).`,
    options: () => ['composite', 'declaration'],
  },
];

// --- Serialization ----------------------------------------------------

function withComments(plainText: string): string {
  const lines = plainText.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const match = /^(\s+)"([A-Za-z0-9]+)":/.exec(line);
    if (match && match[1]!.length === 4) {
      const option = findOption(match[2]!);
      if (option) {
        out.push(`${match[1]}// ${option.explanation} (${option.docsUrl})`);
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

export function buildTsconfig(input: BuildTsconfigOptions): BuildTsconfigResult {
  const warnings: string[] = [];
  const raw: Record<string, unknown> = {};

  if (input.preset !== undefined) {
    const preset = findPreset(input.preset);
    if (!preset) throw new TsconfigBuilderError(`"${input.preset}" is not a known preset.`);
    Object.assign(raw, preset.options);
  }
  if (input.options) Object.assign(raw, input.options);

  const compilerOptions: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const option = findOption(name);
    if (!option) {
      warnings.push(`"${name}" is not a tsconfig option this tool recognises, so it was left out.`);
      continue;
    }
    const coerced = applyValue(option, value, warnings);
    if (coerced === undefined) continue;
    if (Array.isArray(coerced) && coerced.length === 0) continue;
    compilerOptions[name] = coerced;

    if (option.ts6) {
      for (const flag of option.ts6) {
        const affected = flag.values
          ? flag.values.some((v) => v.toLowerCase() === String(coerced).toLowerCase())
          : true;
        if (affected) {
          const verb = flag.status === 'removed' ? 'removed by' : 'deprecated by';
          warnings.push(`"${name}" is ${verb} TypeScript 6.0: ${flag.note}`);
        }
      }
    }
  }

  const conflicts: TsconfigConflict[] = [];
  for (const rule of CONFLICTS) {
    if (rule.applies(compilerOptions)) {
      conflicts.push({
        code: rule.code,
        options: rule.options(compilerOptions),
        message: rule.message(compilerOptions),
      });
    }
  }

  const object: BuildTsconfigResult['object'] = { compilerOptions };
  if (input.extendsPath && input.extendsPath.trim() !== '') object.extends = input.extendsPath.trim();
  const include = (input.include ?? []).map((s) => s.trim()).filter(Boolean);
  const exclude = (input.exclude ?? []).map((s) => s.trim()).filter(Boolean);
  if (include.length > 0) object.include = include;
  if (exclude.length > 0) object.exclude = exclude;

  // Key order matches common tsconfig.json convention: extends, compilerOptions, include, exclude.
  const ordered: Record<string, unknown> = {};
  if (object.extends !== undefined) ordered.extends = object.extends;
  ordered.compilerOptions = object.compilerOptions;
  if (object.include !== undefined) ordered.include = object.include;
  if (object.exclude !== undefined) ordered.exclude = object.exclude;

  const plainText = JSON.stringify(ordered, null, 2) + '\n';
  const output = input.comments ? withComments(plainText) : plainText;

  return { output, object, warnings, conflicts };
}
