#!/usr/bin/env node
/**
 * Release gate: no reference to a surveyed source site may reach the public
 * repository, the deployed bundle, or a commit message.
 *
 * This gate deliberately never learns the forbidden names itself. It reads
 * them out of band (a CI repository variable, or a git-ignored local file),
 * so this file can be the mechanism without ever being the record. See
 * `.planning/phases/01-provenance-removal/01-CONTEXT.md` D-20 for the full
 * reasoning; that document is git-ignored and never enters this repository.
 *
 * Three independent layers, all collected before anything is reported:
 *   1. Names   — the out-of-band denylist, matched against tracked file
 *                contents, tracked file names, the built bundle, the
 *                prerendered HTML, and the commit message being made.
 *   2. Structure — a regenerated derivation story written in fresh field
 *                names (a survey-count block, a per-tool source list) is
 *                rejected even when no forbidden name is present anywhere.
 *                This is the layer that keeps working after the names are
 *                gone from this repository for good.
 *   3. Phrases — derivation wording written in fresh words ("source site",
 *                "surveyed", ...), independent of the name list entirely.
 *
 * Every layer calls note() and keeps going; nothing here ever throws or
 * exits mid-scan. A single report-and-exit block runs once, at the end.
 *
 * This script never prints a matched token, a matching line, or the
 * resolved denylist. Every problem names only the file and the layer that
 * matched. CI logs on this repository are public, and echoing the very
 * thing this gate exists to remove would defeat the point of running it.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { ROOT } from './lib/catalog.mjs';
import { redactDenylistTokens, extractCatalogEntries } from './lib/provenance.mjs';

/** Extensions the built-output scan (layers 1 and 3) reads, in one shared place. */
const DIST_EXTENSIONS = new Set(['.js', '.html', '.css', '.json', '.xml', '.txt', '.map']);

const problems = [];
// Single choke point: every problem message is redacted against the resolved
// denylist before it is stored, so no call site -- present or future -- can
// leak a matched token into stderr, a hook's output, or a public CI log
// (CR-01, 01-REVIEW.md). `denylistTokens` is declared with `let` below; this
// closure reads its value at call time, which is always after resolution.
const note = (msg) => problems.push(redactDenylistTokens(msg, denylistTokens));

/**
 * Files that hold the gate's own logic and the phrase-pattern list by
 * definition, and would otherwise flag themselves in the phrase layer.
 * Both hooks invoke this same script with the same flags, so they carry no
 * forbidden name or phrase pattern of their own — but excluding them here
 * keeps the phrase layer honest about what it actually found versus what
 * is simply this gate describing itself.
 */
const SELF_EXEMPT = new Set(['scripts/check-provenance.mjs', '.githooks/pre-commit', '.githooks/commit-msg']);

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** Derivation wording written in fresh words, independent of any name list (D-21 layer 3). */
const PHRASE_PATTERNS = ['source site', 'source tools', 'surveyed', 'inventoried', 'four sites'];
// Deliberately omits "deduplicate": one of the catalog's own tools legitimately sorts and
// deduplicates lines, and a tool test asserts on that word. A gate that fires on legitimate
// content is a gate someone switches off, which is worse than no gate at all (D-22).

function report() {
  if (problems.length > 0) {
    console.error(`Provenance check failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('Provenance check passed.');
}

// --- commit-message layer (parsed early; used in the names layer below) ---
function parseArgs(argv) {
  const out = { commitMessageFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--commit-message-file') {
      out.commitMessageFile = argv[i + 1] ?? null;
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// --- denylist resolution ---------------------------------------------------
function parseDenylistText(text) {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith('#'))
    .map((t) => t.toLowerCase());
}

let denylistTokens = parseDenylistText(process.env.PROVENANCE_DENYLIST ?? '');
const LOCAL_DENYLIST_PATH = join(ROOT, '.provenance-denylist');
if (denylistTokens.length === 0 && existsSync(LOCAL_DENYLIST_PATH)) {
  denylistTokens = parseDenylistText(readFileSync(LOCAL_DENYLIST_PATH, 'utf8'));
}

let skipNameLayer = false;
if (denylistTokens.length === 0) {
  // GitHub Actions interpolates an UNSET repository variable into the environment as an
  // empty string — there is no way for a workflow to distinguish "unset" from "set to
  // empty" (docs.github.com/en/actions/learn-github-actions/variables). `undefined` is a
  // state CI will never actually hand this script, so checking for it here would be
  // checking for a condition that can never fire on `main`. Checking for an empty string
  // is the only implementation CI can ever observe, and it already covers both cases.
  if (process.env.CI) {
    console.error(
      'PROVENANCE_DENYLIST is empty. The gate cannot check anything against a list it was not given. ' +
        'Set the PROVENANCE_DENYLIST repository variable.',
    );
    process.exit(1);
  }
  console.warn(
    'Warning: no provenance denylist found (PROVENANCE_DENYLIST is unset and .provenance-denylist does not ' +
      'exist). Skipping the name layer. Layers 2 and 3 still run.',
  );
  skipNameLayer = true;
}

// --- tracked file inventory -------------------------------------------------
let trackedFiles;
try {
  trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
} catch {
  note('Could not list tracked files with `git ls-files -z`. The gate cannot run without a working git checkout.');
  report();
}

/**
 * Narrow, non-general detector for pure-ASCII-range UTF-16 text (e.g. saved
 * by Windows Notepad, or produced by a tool that defaults to UTF-16 on
 * Windows). Such a file is mostly NUL bytes interleaved with ASCII code
 * points, and a plain "any NUL byte means binary" check would otherwise
 * skip it in every layer (WR-04, 01-REVIEW.md). Returns 'LE', 'BE', or null
 * (not recognised -- still treated as binary and skipped). This does not
 * attempt general encoding detection: non-ASCII UTF-16 content, or other
 * wide encodings, still falls through to the binary path.
 */
function detectAsciiUtf16Endianness(buf) {
  if (buf.length < 4 || buf.length % 2 !== 0) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  let nonZeroEven = 0;
  let nonZeroOdd = 0;
  for (let i = 0; i < buf.length; i++) {
    const isZero = buf[i] === 0;
    if (i % 2 === 0) {
      if (isZero) zeroEven++;
      else nonZeroEven++;
    } else if (isZero) zeroOdd++;
    else nonZeroOdd++;
  }
  // UTF-16LE ASCII text: the low byte of each code unit is non-zero (even
  // offsets) and the high byte is always zero (odd offsets).
  if (zeroOdd > 0 && nonZeroEven > 0 && zeroEven === 0 && nonZeroOdd === 0) return 'LE';
  // UTF-16BE ASCII text: the reverse.
  if (zeroEven > 0 && nonZeroOdd > 0 && zeroOdd === 0 && nonZeroEven === 0) return 'BE';
  return null;
}

/**
 * Reads a file's contents once and returns them lower-cased, or null when the
 * file should be treated as out of scope for content scanning (too large,
 * binary, or vanished since it was listed).
 */
function readScannableText(fullPath) {
  let stat;
  try {
    stat = statSync(fullPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return null;
  const buf = readFileSync(fullPath);
  if (buf.includes(0)) {
    const endianness = detectAsciiUtf16Endianness(buf);
    if (endianness === 'LE') return buf.toString('utf16le').toLowerCase();
    if (endianness === 'BE') {
      const swapped = Buffer.from(buf);
      swapped.swap16();
      return swapped.toString('utf16le').toLowerCase();
    }
    return null; // not recognised as ASCII-range UTF-16 text; treat as binary
  }
  return buf.toString('utf8').toLowerCase();
}

// --- layer 1: names ---------------------------------------------------------
if (!skipNameLayer) {
  for (const rel of trackedFiles) {
    const lowerPath = rel.toLowerCase();
    if (denylistTokens.some((t) => lowerPath.includes(t))) {
      note(`${rel}: file name matches the provenance denylist (layer 1, name).`);
    }
  }

  for (const rel of trackedFiles) {
    const text = readScannableText(join(ROOT, rel));
    if (text === null) continue;
    if (denylistTokens.some((t) => text.includes(t))) {
      note(`${rel}: file contents match the provenance denylist (layer 1, name).`);
    }
  }

  // The built bundle and the prerendered HTML — `pnpm verify` does not build the web app,
  // so this directory is often absent locally, and that is not itself a problem.
  const distDir = join(ROOT, 'apps', 'web', 'dist');
  if (existsSync(distDir)) {
    const distFiles = [];
    const walkDist = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walkDist(full);
        else if (DIST_EXTENSIONS.has(extname(entry).toLowerCase())) distFiles.push(full);
      }
    };
    walkDist(distDir);

    for (const full of distFiles) {
      const text = readScannableText(full);
      if (text === null) continue;
      const rel = relative(ROOT, full).split('\\').join('/');
      if (denylistTokens.some((t) => text.includes(t))) {
        note(`${rel}: built output matches the provenance denylist (layer 1, name).`);
      }
    }
  }
}

// --- layer 2: structure -----------------------------------------------------
const GENERATED_CATALOG_PATH = join(ROOT, 'apps', 'web', 'src', 'generated-catalog.json');
if (existsSync(GENERATED_CATALOG_PATH)) {
  const rel = 'apps/web/src/generated-catalog.json';
  try {
    const data = JSON.parse(readFileSync(GENERATED_CATALOG_PATH, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, 'counts')) {
      note(`${rel}: carries a top-level survey-count block (layer 2, structure).`);
    }
    const { entries, found } = extractCatalogEntries(data);
    if (!found) {
      // Silently treating "could not locate the entry array" as "there are
      // no entries to check" is exactly how this layer went dead the last
      // time the catalog's shape changed (CR-02, 01-REVIEW.md). Make that
      // state loud instead of a silent pass.
      note(
        `${rel}: could not locate a catalog entry array under any known shape (layer 2, structure). ` +
          'The per-entry source-attribution check cannot run until this is fixed.',
      );
    } else {
      const FORBIDDEN_ENTRY_KEYS = ['sources', 'feeds', 'replacesDiscoveredTools'];
      if (entries.some((e) => e && typeof e === 'object' && FORBIDDEN_ENTRY_KEYS.some((k) => Object.hasOwn(e, k)))) {
        note(`${rel}: a catalog entry carries a per-tool source-attribution field (layer 2, structure).`);
      }
    }
  } catch {
    note(`${rel}: could not be parsed as JSON (layer 2, structure).`);
  }
}

const RELEASE_MANIFEST_PATH = join(ROOT, 'docs', 'RELEASE-MANIFEST.json');
if (existsSync(RELEASE_MANIFEST_PATH)) {
  const rel = 'docs/RELEASE-MANIFEST.json';
  try {
    const data = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, 'counts')) {
      note(`${rel}: carries a top-level counts block (layer 2, structure).`);
    }
  } catch {
    note(`${rel}: could not be parsed as JSON (layer 2, structure).`);
  }
}

// --- layer 3: phrases --------------------------------------------------------
function scanTextForPhrases(rel, text) {
  if (SELF_EXEMPT.has(rel)) return;
  if (PHRASE_PATTERNS.some((p) => text.includes(p))) {
    note(`${rel}: contains derivation phrasing (layer 3, phrase).`);
  }
}

for (const rel of trackedFiles) {
  if (SELF_EXEMPT.has(rel)) continue;
  const text = readScannableText(join(ROOT, rel));
  if (text === null) continue;
  scanTextForPhrases(rel, text);
}

{
  const distDir = join(ROOT, 'apps', 'web', 'dist');
  if (existsSync(distDir)) {
    const distFiles = [];
    const walkDist = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walkDist(full);
        else if (DIST_EXTENSIONS.has(extname(entry).toLowerCase())) distFiles.push(full);
      }
    };
    walkDist(distDir);

    for (const full of distFiles) {
      const rel = relative(ROOT, full).split('\\').join('/');
      if (SELF_EXEMPT.has(rel)) continue;
      const text = readScannableText(full);
      if (text === null) continue;
      scanTextForPhrases(rel, text);
    }
  }
}

// --- commit-message layer ---------------------------------------------------
if (!args.commitMessageFile) {
  console.log('Commit-message layer: skipped, no --commit-message-file was given.');
} else if (!existsSync(args.commitMessageFile)) {
  note(`${args.commitMessageFile}: commit-message file does not exist (commit-message layer).`);
} else {
  const message = readFileSync(args.commitMessageFile, 'utf8').toLowerCase();
  const nameHit = !skipNameLayer && denylistTokens.some((t) => message.includes(t));
  const phraseHit = PHRASE_PATTERNS.some((p) => message.includes(p));
  if (nameHit || phraseHit) {
    note('commit message: matches the provenance denylist or derivation phrasing (commit-message layer).');
  } else {
    console.log('Commit-message layer: ran, no match.');
  }
}

report();
