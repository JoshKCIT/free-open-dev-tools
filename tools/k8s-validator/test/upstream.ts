/**
 * Test-only helper that proves a vendored upstream file has not drifted from
 * the commit its `UPSTREAM.md` records: parses the `- <path>: <sha>` lines
 * `UPSTREAM.md` writes for every vendored file, and computes the git blob
 * SHA-1 of a file's bytes the same way `git hash-object` does, so the two
 * can be compared directly.
 *
 * Copied byte for byte into every tool in this phase that vendors upstream
 * data. This header names no tool folder so it stays true wherever it lands.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** One `- <path>: <sha>` line read from an `UPSTREAM.md` file. */
export interface UpstreamEntry {
  path: string;
  sha: string;
}

/**
 * Parses every `- <path>: <40-hex-sha>` line out of an `UPSTREAM.md` file's
 * text, reading only the lines after the `## Files` heading -- the file's
 * own header lines (`- Repository: ...`, `- Commit: <40-hex-sha>`) would
 * otherwise false-positive-match the same bullet-list shape.
 */
export function readUpstreamShas(upstreamMdText: string): UpstreamEntry[] {
  const filesHeading = upstreamMdText.indexOf('## Files');
  const searchText = filesHeading === -1 ? upstreamMdText : upstreamMdText.slice(filesHeading);
  const entries: UpstreamEntry[] = [];
  const pattern = /^-\s+(.+?):\s+([0-9a-f]{40})\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(searchText)) !== null) {
    entries.push({ path: match[1]!, sha: match[2]! });
  }
  return entries;
}

/**
 * Computes the git blob SHA-1 of `bytes`: a SHA-1 over the ASCII header
 * `blob <byte length>`, a NUL byte, then the bytes themselves -- exactly
 * what `git hash-object` computes for a file, so this can be compared
 * directly against a blob SHA read from the GitHub API.
 */
export function gitBlobSha(bytes: Buffer | Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'ascii');
  const hash = createHash('sha1');
  hash.update(header);
  hash.update(bytes);
  return hash.digest('hex');
}

/** Reads a file from disk and computes its git blob SHA-1. */
export function gitBlobShaOfFile(path: string): string {
  return gitBlobSha(readFileSync(path));
}
