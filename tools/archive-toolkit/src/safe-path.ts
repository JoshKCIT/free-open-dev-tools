/**
 * Neutralises an archive entry's own stored name before it is ever used as
 * a download name (D-135, T-09-50, the "zip-slip" family of vulnerabilities:
 * a crafted entry name that climbs out of the intended extraction directory
 * with `../` segments, or writes to an absolute path, letting an archive
 * overwrite an arbitrary file when a naive extractor joins the name onto a
 * destination directory without checking it first).
 *
 * This package never writes to a real filesystem -- results are offered as
 * browser downloads -- but D-135 requires this defense unconditionally, both
 * because a hostile name can otherwise produce confusing or colliding
 * entries in the list of files a visitor is offered, and because it is what
 * makes this reader's own output safe to hand to any later feature (a
 * directory-picker-based extraction, for instance) without redoing this
 * analysis.
 */

const MAX_NAME_LENGTH = 1024;

export interface SafeEntryPathOk {
  path: string;
  warnings: string[];
}

export interface SafeEntryPathRefused {
  refused: string;
}

export type SafeEntryPathResult = SafeEntryPathOk | SafeEntryPathRefused;

function hasControlCharacter(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Converts backslashes to slashes, strips a leading drive letter (`C:`), a
 * UNC prefix (`\\server\share` becomes `server/share` once backslashes are
 * already slashes) and any number of leading slashes, drops `.` and empty
 * segments, and refuses the whole entry when any remaining segment is `..`
 * (there is no safe way to neutralise a parent-directory reference without
 * changing which file it names, unlike an absolute path, which can be made
 * relative without ambiguity). The returned path, when not refused, never
 * starts with a slash, never contains a `..` segment, and is never empty.
 */
export function safeEntryPath(rawName: string): SafeEntryPathResult {
  if (rawName.length === 0) {
    return { refused: 'this entry has an empty name' };
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return { refused: 'this entry name is too long' };
  }
  if (hasControlCharacter(rawName)) {
    return { refused: 'this entry name contains a control character' };
  }

  const warnings: string[] = [];
  let normalized = rawName.replace(/\\/g, '/');

  // A Windows drive letter, e.g. "C:" or "c:", at the very start.
  const driveLetterMatch = /^[a-zA-Z]:/.exec(normalized);
  let sawAbsolute = false;
  if (driveLetterMatch) {
    normalized = normalized.slice(driveLetterMatch[0].length);
    sawAbsolute = true;
  }

  // Leading slashes: a UNC path ("//server/share/...", already
  // backslash-converted) or a plain absolute path ("/etc/x.txt").
  if (normalized.startsWith('/')) {
    sawAbsolute = true;
    normalized = normalized.replace(/^\/+/, '');
  }

  if (sawAbsolute) {
    warnings.push('absolute path made relative');
  }

  const rawSegments = normalized.split('/');
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      return { refused: "this entry's path climbs out of the archive, so it was not extracted" };
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return { refused: 'this entry has an empty name' };
  }

  return { path: segments.join('/'), warnings };
}

export interface DedupeResult {
  path: string;
  /** True when `path` differs from the name originally asked for, because it collided with an earlier one. */
  deduped: boolean;
}

/**
 * Appends a disambiguating suffix (` (2)`, ` (3)`, ...) before a path's own
 * extension when it collides with a name already used in this run, tracked
 * in the given `Set` (which the caller mutates by continuing to pass the
 * same instance across every entry of one archive). Returns the original
 * path unchanged, and records it, when there is no collision.
 */
export function dedupePath(path: string, used: Set<string>): DedupeResult {
  if (!used.has(path)) {
    used.add(path);
    return { path, deduped: false };
  }
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1);
  const base = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let n = 2;
  let candidate = `${dir}${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n++;
    candidate = `${dir}${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return { path: candidate, deduped: true };
}
