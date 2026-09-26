import meta from './meta.json';
import { FIELDS } from './fields-catalogue';
import { checkPackageName } from './npm-name';
import { isValidVersion, isValidRange, classifySpecifier } from './semver-syntax';
import { setOwn } from './own-property';

export { meta };
export { FIELDS, findField } from './fields-catalogue';
export { checkPackageName } from './npm-name';
export { isValidVersion, isValidRange, classifySpecifier } from './semver-syntax';

export class PackageJsonError extends Error {}

/**
 * SPDX identifiers offered on the page, each verified this session against
 * the fetched SPDX License List (https://spdx.org/licenses/) by its exact
 * `licenseId`.
 */
export const SPDX_LICENSES: readonly string[] = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'GPL-3.0-only',
  'GPL-2.0-only',
  'LGPL-3.0-only',
  'MPL-2.0',
  'CC0-1.0',
  'Unlicense',
];

export interface BuildPackageJsonOptions {
  name?: string;
  /** Defaults to "1.0.0" when omitted. */
  version?: string;
  description?: string;
  keywords?: readonly string[];
  homepage?: string;
  author?: string;
  /** An SPDX identifier from SPDX_LICENSES, "UNLICENSED", or "SEE LICENSE IN <file>". */
  license?: string;
  /** A repository URL; written as `{ type: 'git', url }`. */
  repository?: string;
  main?: string;
  type?: 'module' | 'commonjs';
  /** "subpath=target" lines, one per export. */
  exports?: readonly { subpath: string; target: string }[];
  /** "command=path" lines. */
  bin?: readonly { command: string; path: string }[];
  scripts?: readonly { name: string; command: string }[];
  dependencies?: readonly { name: string; specifier: string }[];
  devDependencies?: readonly { name: string; specifier: string }[];
  peerDependencies?: readonly { name: string; specifier: string }[];
  files?: readonly string[];
  engineNode?: string;
  packageManager?: string;
  private?: boolean;
}

export interface BuildPackageJsonResult {
  output: string;
  object: Record<string, unknown>;
  /** Values refused outright: never written. */
  problems: string[];
  /** Values written, but worth a second look. */
  warnings: string[];
}

function addDependencyMap(
  target: Record<string, unknown>,
  fieldName: string,
  entries: readonly { name: string; specifier: string }[] | undefined,
  problems: string[],
  warnings: string[],
): void {
  if (!entries || entries.length === 0) return;
  const map: Record<string, unknown> = {};
  let any = false;
  for (const { name, specifier } of entries) {
    if (!name) continue;
    const classified = classifySpecifier(specifier);
    if (classified.kind === 'problem') {
      problems.push(
        `${fieldName}.${name}: "${specifier}" is not a specifier npm reads (not a range, tag, npm: alias, file:, git URL or tarball URL), so it was left out.`,
      );
      continue;
    }
    if (classified.warning) warnings.push(`${fieldName}.${name}: ${classified.warning}`);
    setOwn(map, name, specifier);
    any = true;
  }
  if (any) target[fieldName] = map;
}

export function buildPackageJson(input: BuildPackageJsonOptions): BuildPackageJsonResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const object: Record<string, unknown> = {};

  const name = input.name?.trim();
  if (name) {
    const check = checkPackageName(name);
    if (!check.validForNewPackages) {
      problems.push(`name: ${[...check.errors, ...check.warnings].join('; ') || 'not a valid package name'}`);
    } else {
      object.name = name;
    }
  }

  const version = (input.version?.trim() || '1.0.0').trim();
  if (!isValidVersion(version)) {
    problems.push(`version: "${version}" is not a Semantic Versioning 2.0.0 version, so it was left out.`);
  } else {
    object.version = version;
  }

  if (input.description?.trim()) object.description = input.description.trim();
  if (input.keywords && input.keywords.length > 0) {
    object.keywords = input.keywords.map((k) => k.trim()).filter(Boolean);
  }
  if (input.homepage?.trim()) object.homepage = input.homepage.trim();
  if (input.author?.trim()) object.author = input.author.trim();

  if (input.license?.trim()) {
    const license = input.license.trim();
    const isSpdx = SPDX_LICENSES.includes(license);
    const isUnlicensed = license === 'UNLICENSED';
    const isSeeLicenseIn = /^SEE LICENSE IN .+/.test(license);
    if (isSpdx || isUnlicensed || isSeeLicenseIn) {
      object.license = license;
    } else {
      problems.push(
        `license: "${license}" is not one of the offered SPDX identifiers, UNLICENSED, or SEE LICENSE IN <file>, so it was left out.`,
      );
    }
  }

  if (input.repository?.trim()) {
    object.repository = { type: 'git', url: input.repository.trim() };
  }

  if (input.main?.trim()) object.main = input.main.trim();
  if (input.type) object.type = input.type;

  if (input.exports && input.exports.length > 0) {
    const map: Record<string, unknown> = {};
    let any = false;
    for (const { subpath, target } of input.exports) {
      if (!subpath || !target) continue;
      setOwn(map, subpath, target);
      any = true;
    }
    if (any) object.exports = map;
  }

  if (input.bin && input.bin.length > 0) {
    const map: Record<string, unknown> = {};
    let any = false;
    for (const { command, path } of input.bin) {
      if (!command || !path) continue;
      setOwn(map, command, path);
      any = true;
    }
    if (any) object.bin = map;
  }

  if (input.scripts && input.scripts.length > 0) {
    const map: Record<string, unknown> = {};
    let any = false;
    for (const { name: scriptName, command } of input.scripts) {
      if (!scriptName || !command) continue;
      setOwn(map, scriptName, command);
      any = true;
    }
    if (any) object.scripts = map;
  }

  addDependencyMap(object, 'dependencies', input.dependencies, problems, warnings);
  addDependencyMap(object, 'devDependencies', input.devDependencies, problems, warnings);
  addDependencyMap(object, 'peerDependencies', input.peerDependencies, problems, warnings);

  if (input.files && input.files.length > 0) {
    object.files = input.files.map((f) => f.trim()).filter(Boolean);
  }

  if (input.engineNode?.trim()) {
    const range = input.engineNode.trim();
    if (!isValidRange(range)) {
      problems.push(
        `engines.node: "${range}" is not a version range npm's semver package accepts, so it was left out.`,
      );
    } else {
      object.engines = { node: range };
    }
  }

  if (input.packageManager?.trim()) object.packageManager = input.packageManager.trim();
  if (input.private) object.private = true;

  // Written in the field-catalogue's own order, which follows npm's documentation order.
  const ordered: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (Object.hasOwn(object, field.name)) ordered[field.name] = object[field.name];
  }
  // Anything present in `object` but not in FIELDS would be a programmer
  // error in this file, never visitor input, so no separate handling exists.

  const output = JSON.stringify(ordered, null, 2) + '\n';
  return { output, object: ordered, problems, warnings };
}
