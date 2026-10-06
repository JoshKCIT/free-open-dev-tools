/**
 * Real files carried inline inside a tool's own fixture JSON, so a later tool
 * can ship a binary or text fixture (a font, a WebAssembly module, a mail
 * message, a source map, a DER certificate) by adding one `<id>.json` file
 * and editing no shared spec or helper.
 *
 * Why inline and not a file next to the fixture: the changed-only rule
 * (`scripts/lib/affected.mjs`) classifies `e2e/live-fixtures/<id>.json` and
 * `e2e/privacy-fixtures/<id>.json` as that one tool's fixture, while any file
 * in a subfolder counts as touching everything. Bytes therefore travel as
 * base64 text, and text files as plain text, inside the same JSON file.
 *
 * Shape of one entry (`InlineFixtureFile`): `name` and `mimeType` as the page
 * will see them, and exactly one of `base64` (the bytes, standard alphabet) or
 * `text` (UTF-8). Every `{{MARKER}}` in `text` is replaced by the run's
 * marker (the live harness uses `FODT-LIVE-FIXTURE`; the privacy harness uses
 * the page's own canary), so a leak of a file's content is something the
 * privacy checks can actually find.
 *
 * This module imports only a type, so a Vitest file can load it without a
 * browser.
 */
import type { FixtureFile } from './fixture-files';

export interface InlineFixtureFile {
  name: string;
  mimeType: string;
  base64?: string;
  text?: string;
}

/** The text a fixture writes where the run's marker belongs. */
export const MARKER_PLACEHOLDER = '{{MARKER}}';

const ALLOWED_KEYS = new Set(['name', 'mimeType', 'base64', 'text']);
const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Everything wrong with a list of inline files, each problem naming `where`
 * (the fixture file and field) so a mistake in a later tool's JSON is found
 * when the specs load, never silently skipped. An empty result means the list
 * is well formed.
 */
export function inlineFileProblems(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) return [`${where} must be an array of inline files`];
  if (value.length === 0) return [`${where} is an empty array: list at least one file or leave the field out`];
  const problems: string[] = [];
  value.forEach((entry, index) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${at} must be an object with name, mimeType and one of base64 or text`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_KEYS.has(key)) problems.push(`${at} has an unknown key "${key}"`);
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      problems.push(`${at}.name must be a non-empty string`);
    } else if (/[\\/]/.test(entry.name)) {
      problems.push(`${at}.name must be a plain file name with no slash`);
    }
    if (typeof entry.mimeType !== 'string' || entry.mimeType.length === 0) {
      problems.push(`${at}.mimeType must be a non-empty string`);
    }
    const hasBase64 = Object.prototype.hasOwnProperty.call(entry, 'base64');
    const hasText = Object.prototype.hasOwnProperty.call(entry, 'text');
    if (hasBase64 && hasText) {
      problems.push(`${at} has both base64 and text: give exactly one`);
    } else if (!hasBase64 && !hasText) {
      problems.push(`${at} has neither base64 nor text: give exactly one`);
    } else if (hasBase64) {
      if (typeof entry.base64 !== 'string') problems.push(`${at}.base64 must be a string`);
      else if (!BASE64_TEXT.test(entry.base64)) problems.push(`${at}.base64 is not valid standard base64`);
    } else if (typeof entry.text !== 'string') {
      problems.push(`${at}.text must be a string`);
    }
  });
  return problems;
}

/**
 * Turns well formed inline files into the `FixtureFile` shape the harnesses
 * attach: `text` with every `{{MARKER}}` replaced by `marker` and encoded as
 * UTF-8, `base64` decoded exactly. Throws on a malformed list, naming it.
 */
export function buildInlineFiles(files: InlineFixtureFile[], marker: string): FixtureFile[] {
  const problems = inlineFileProblems(files, 'inline files');
  if (problems.length > 0) throw new Error(problems.join('; '));
  return files.map((file) => {
    const buffer =
      file.base64 !== undefined
        ? new Uint8Array(Buffer.from(file.base64, 'base64'))
        : new Uint8Array(Buffer.from((file.text ?? '').split(MARKER_PLACEHOLDER).join(marker), 'utf8'));
    return { name: file.name, mimeType: file.mimeType, buffer };
  });
}

export interface FixtureCoverageInput {
  /** Every id in `docs/catalog.json`. */
  catalogIds: readonly string[];
  /** Every id with a built page under `apps/web/src/tools`. */
  builtIds: readonly string[];
  /** The id each file under `e2e/live-fixtures` declares, one per file. */
  fixtureIds: readonly string[];
  /** The frozen set of ids the old hard-coded lists named. */
  legacyIds: readonly string[];
}

function counts(ids: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

/**
 * The rule that replaces a hard-coded list of live fixtures. An id in the
 * frozen legacy set keeps strict equality (it must have exactly one fixture).
 * Every other catalog tool must have exactly one fixture too, every fixture id
 * must be a catalog id with a built page, and no catalog id may repeat. A new
 * tool is therefore accepted the moment its own fixture file exists, with no
 * list to edit. Returns every problem found, sorted; empty means the shape is
 * right.
 */
export function fixtureCoverageProblems({
  catalogIds,
  builtIds,
  fixtureIds,
  legacyIds,
}: FixtureCoverageInput): string[] {
  const problems: string[] = [];
  const catalog = counts(catalogIds);
  const built = new Set(builtIds);
  const fixtures = counts(fixtureIds);
  const legacy = new Set(legacyIds);

  for (const [id, n] of catalog) {
    if (n > 1) problems.push(`catalog id "${id}" appears ${n} times`);
  }
  for (const id of legacy) {
    if (!catalog.has(id)) problems.push(`legacy id "${id}" is not a catalog id`);
    if (!fixtures.has(id))
      problems.push(`legacy id "${id}" has no live fixture (strict equality inside the legacy set)`);
  }
  for (const id of catalog.keys()) {
    if (!built.has(id)) problems.push(`catalog tool "${id}" has no built page`);
    const n = fixtures.get(id) ?? 0;
    if (!legacy.has(id) && n === 0)
      problems.push(`catalog tool "${id}" has no live fixture: add e2e/live-fixtures/${id}.json`);
  }
  for (const [id, n] of fixtures) {
    if (n > 1) problems.push(`live fixture id "${id}" is declared ${n} times: exactly one fixture per tool`);
    if (!catalog.has(id)) problems.push(`live fixture id "${id}" is not a catalog id`);
    else if (!built.has(id)) problems.push(`live fixture id "${id}" has no built page`);
  }
  return [...new Set(problems)].sort();
}
