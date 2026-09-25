import { it, expect, beforeAll } from 'vitest';
import { compile } from 'tailwindcss';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolveClass, SUPPORTED_CANDIDATES } from '../src/utilities';
import { themeCssVariables } from '../src/theme';

/**
 * Uses the pinned `tailwindcss` package (a devDependency-only correctness
 * oracle -- never a runtime dependency, checked directly in this file's own
 * TAILWIND-PINNED gate in the plan's verify commands) as the ground truth
 * for every class this tool claims to support. This file never ships: it is
 * test-only, and `scripts/check-standalone.mjs` proves the folder still
 * installs, builds and tests outside the workspace with only its own
 * `devDependencies` (including this one) available.
 */

const require_ = createRequire(import.meta.url);
const packageJsonPath = require_.resolve('tailwindcss/package.json');
const TAILWIND_BASE = dirname(packageJsonPath);

async function loadStylesheet(id: string): Promise<{ path: string; base: string; content: string }> {
  const resolved = id === 'tailwindcss' ? `${TAILWIND_BASE}/index.css` : `${TAILWIND_BASE}/${id}`;
  const content = await readFile(resolved, 'utf8');
  return { path: resolved, base: dirname(resolved), content };
}

let compiledCss = '';

beforeAll(async () => {
  const { build } = await compile('@import "tailwindcss";', { base: TAILWIND_BASE, loadStylesheet });
  compiledCss = build(SUPPORTED_CANDIDATES);
}, 120_000);

// ---------------------------------------------------------------------------
// Extracting one class's own declarations from the real compiler's output
// ---------------------------------------------------------------------------

function findMatchingBrace(text: string, afterOpenBrace: number): number {
  let depth = 1;
  let i = afterOpenBrace;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
  }
  return i; // index just past the matching closing brace
}

function unescapeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, '$1');
}

/** Grabs every `property: value;` line inside a rule body, in document order, ignoring `@supports (...) {` wrapper lines and bare `}` lines -- so a later (modern-branch) declaration for the same property naturally overwrites an earlier (fallback) one, matching real browser cascade behaviour for two declarations of the same property in the same rule. */
function extractFlatDeclarations(blockBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = blockBody.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line === '}' || line.startsWith('@supports')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const property = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/;$/, '');
    out[property] = value;
  }
  return out;
}

function extractUtilityRules(css: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  const marker = '@layer utilities {';
  const layerStart = css.indexOf(marker);
  if (layerStart === -1) return result;
  const bodyStart = layerStart + marker.length;
  const bodyEnd = findMatchingBrace(css, bodyStart);
  const body = css.slice(bodyStart, bodyEnd - 1);

  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;
    const braceIdx = body.indexOf('{', i);
    if (braceIdx === -1) break;
    const selector = body.slice(i, braceIdx).trim();
    const closeIdx = findMatchingBrace(body, braceIdx + 1);
    const blockBody = body.slice(braceIdx + 1, closeIdx - 1);
    if (selector.startsWith('.')) {
      const className = unescapeSelector(selector.slice(1));
      result.set(className, extractFlatDeclarations(blockBody));
    } else if (selector.startsWith('@media')) {
      // a variant candidate never appears in SUPPORTED_CANDIDATES, so this
      // branch exists only as a defensive skip, never expected to run.
      const nested = extractUtilityRules(`@layer utilities {${blockBody}}`);
      for (const [k, v] of nested) result.set(k, v);
    }
    i = closeIdx;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolving var() references and folding the spacing calc() shape
// ---------------------------------------------------------------------------

const THEME_VARS = themeCssVariables();

function resolveVars(text: string): string {
  let result = text;
  for (let pass = 0; pass < 6; pass++) {
    const before = result;
    result = result.replace(
      /var\((--[a-zA-Z0-9-]+)(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g,
      (whole, name: string, fallback: string | undefined) => {
        if (name === '--tw-border-style') return 'solid';
        if (Object.prototype.hasOwnProperty.call(THEME_VARS, name)) return THEME_VARS[name]!;
        if (fallback !== undefined) return fallback.trim();
        return whole;
      },
    );
    if (result === before) break;
  }
  return result;
}

/** Folds `calc(<length><unit> * <number>)` -- the specific shape `calc(var(--spacing) * N)` becomes once `--spacing` is resolved -- to one length. Never touches the unrelated `calc(<a> / <b> * 100%)` fraction shape, which this tool keeps as Tailwind writes it. */
function foldSpacingCalc(text: string): string {
  return text.replace(/calc\((-?\d+(?:\.\d+)?)(rem|px|em)\s*\*\s*(-?\d+(?:\.\d+)?)\)/g, (whole, num, unit, mult) => {
    const value = Number(num) * Number(mult);
    const rounded = Math.round(value * 10000) / 10000;
    const formatted = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return `${formatted}${unit}`;
  });
}

/** The documented normalisation this tool applies uniformly: theme variables resolved to their values, internal `--tw-*` variables resolved to their registered initial value (or their fallback, when unset), and `calc(<length> * <number>)` folded to one length. */
function normalizeRealDeclarations(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, value] of Object.entries(raw)) {
    if (property.startsWith('--')) continue; // internal custom-property setters never appear in this tool's own output
    out[property] = foldSpacingCalc(resolveVars(value));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Theme equality
// ---------------------------------------------------------------------------

/**
 * A namespace this tool transcribes: matches exactly the `--spacing`,
 * `--color-*`, `--text-*` (font size, with its `--text-*--line-height`
 * companion), `--font-weight-*`, `--font-{sans,serif,mono}` (family),
 * `--tracking-*`, `--leading-*`, `--radius-*` and `--container-*` custom
 * properties `theme.css` declares -- and nothing else (so `--text-shadow-*`,
 * `--shadow-*`, `--breakpoint-*`, `--blur-*` and every other namespace this
 * tool does not convert are correctly excluded from both sides).
 */
const RELEVANT_THEME_KEY_RE =
  /^--(spacing|color-[a-z]+(-[a-z0-9]+)?|container-[a-z0-9]+|text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(--line-height)?|font-weight-[a-z]+|font-(sans|serif|mono)|tracking-[a-z]+|leading-[a-z]+|radius-(xs|sm|md|lg|xl|2xl|3xl|4xl))$/;

/** Reads every top-level `--name: value;` custom property declared before the deprecated `@theme default inline reference` block, with wrapped values joined and internal whitespace collapsed -- the same normalisation `theme.ts`'s own values already carry. */
function readThemeCssVariables(): Record<string, string> {
  const raw = readFileSync(`${TAILWIND_BASE}/theme.css`, 'utf8');
  const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const mainBlock = withoutComments.split('@theme default inline reference')[0]!;
  const out: Record<string, string> = {};
  const re = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(mainBlock))) {
    const key = `--${match[1]}`;
    if (!RELEVANT_THEME_KEY_RE.test(key)) continue;
    out[key] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return out;
}

it('the bundled theme values equal the pinned tailwindcss theme.css', () => {
  const fromPackage = readThemeCssVariables();
  const ours = themeCssVariables();

  const missing = Object.keys(fromPackage).filter((k) => !(k in ours));
  const extra = Object.keys(ours).filter((k) => !(k in fromPackage));
  const mismatched = Object.keys(ours).filter((k) => fromPackage[k] !== undefined && fromPackage[k] !== ours[k]);

  expect(missing, 'keys present in theme.css but missing from theme.ts').toEqual([]);
  expect(extra, 'keys present in theme.ts but absent from theme.css').toEqual([]);
  expect(mismatched, 'keys whose value differs from theme.css').toEqual([]);
  expect(Object.keys(fromPackage).length).toBeGreaterThan(300);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it('every supported class gives the declarations the pinned Tailwind CSS 4 compiler gives, with theme variables resolved', () => {
  const realRules = extractUtilityRules(compiledCss);
  const mismatches: string[] = [];
  let checked = 0;
  for (const candidate of SUPPORTED_CANDIDATES) {
    const ours = resolveClass(candidate);
    expect(ours, `resolveClass(${candidate}) unexpectedly returned null`).not.toBeNull();
    const real = realRules.get(candidate);
    if (!real) {
      mismatches.push(`${candidate}: not found in the compiled output`);
      continue;
    }
    const normalizedReal = normalizeRealDeclarations(real);
    checked++;
    const oursKeys = Object.keys(ours!).sort();
    const realKeys = Object.keys(normalizedReal).sort();
    if (oursKeys.join(',') !== realKeys.join(',')) {
      mismatches.push(`${candidate}: property set differs. ours=${oursKeys.join(',')} real=${realKeys.join(',')}`);
      continue;
    }
    for (const key of oursKeys) {
      if (ours![key] !== normalizedReal[key]) {
        mismatches.push(`${candidate}: ${key} ours="${ours![key]}" real="${normalizedReal[key]}"`);
      }
    }
  }
  expect(mismatches.slice(0, 25), `${mismatches.length} of ${SUPPORTED_CANDIDATES.length} mismatched`).toEqual([]);
  expect(checked).toBe(SUPPORTED_CANDIDATES.length);
});

it('spacing classes accept every quarter step Tailwind CSS 4 accepts and resolve calc to a single length', () => {
  expect(resolveClass('p-4')).toEqual({ padding: '1rem' });
  expect(resolveClass('p-0')).toEqual({ padding: '0px' });
  expect(resolveClass('p-0.5')).toEqual({ padding: '0.125rem' });
  expect(resolveClass('p-1.5')).toEqual({ padding: '0.375rem' });
  expect(resolveClass('p-2.25')).toEqual({ padding: '0.5625rem' });
  expect(resolveClass('p-2.75')).toEqual({ padding: '0.6875rem' });
  expect(resolveClass('p-96')).toEqual({ padding: '24rem' });
  expect(resolveClass('p-px')).toEqual({ padding: '1px' });
  expect(resolveClass('-mt-2')).toEqual({ 'margin-top': '-0.5rem' });
  // Matches the pinned compiler's own output for the same class (verified this session):
  // `.p-4 { padding: calc(var(--spacing) * 4); }` with `--spacing: 0.25rem`
  // folds to `padding: 1rem`.
  expect(resolveClass('p-97')).toBeNull(); // past this tool's own closed 0-96 range
});

it('colour classes with an opacity modifier give the color-mix value Tailwind CSS 4 emits', () => {
  expect(resolveClass('bg-red-500/50')).toEqual({
    'background-color': 'color-mix(in oklab, oklch(63.7% 0.237 25.331) 50%, transparent)',
  });
  // At opacity 100 the pinned compiler emits the plain resolved colour with
  // no color-mix() at all -- confirmed directly this session (`bg-black/100`
  // compiles identically to bare `bg-black`).
  expect(resolveClass('bg-black/100')).toEqual({ 'background-color': '#000' });
  expect(resolveClass('bg-black')).toEqual({ 'background-color': '#000' });
  expect(resolveClass('text-current/50')).toEqual({ color: 'color-mix(in oklab, currentcolor 50%, transparent)' });
});

it('variants, arbitrary values and unknown classes are listed as not converted', () => {
  expect(resolveClass('hover:p-4')).toBeNull();
  expect(resolveClass('md:p-4')).toBeNull();
  expect(resolveClass('dark:bg-red-500')).toBeNull();
  expect(resolveClass('p-[3px]')).toBeNull();
  expect(resolveClass('bg-[#123456]')).toBeNull();
  expect(resolveClass('prose')).toBeNull();
  expect(resolveClass('container')).toBeNull();
});

it('nothing is written to the console while converting classes', async () => {
  const { vi } = await import('vitest');
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    for (const candidate of SUPPORTED_CANDIDATES.slice(0, 500)) resolveClass(candidate);
    resolveClass('hover:p-4');
    resolveClass('p-[3px]');
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});
