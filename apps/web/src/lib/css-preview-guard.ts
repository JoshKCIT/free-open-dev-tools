/**
 * A second, independent fence in front of the live preview (D-118, D-111).
 * `CssPreview.tsx` calls this before ever adopting a stylesheet built from a
 * tool's own generated CSS text. Written without reading any tool
 * package's `css-safe.ts` -- the shared page layer must not depend on a
 * tool package -- so a bug in one fence is unlikely to be a bug in both.
 *
 * The preview renders on the live, unsandboxed page (see `CssPreview.tsx`'s
 * own comment for why): there is no content security policy here that
 * would stop a resource-loading CSS value from firing a real request the
 * moment the stylesheet is adopted. This function lists the function and
 * property names that can load a resource or break out of a rule, and
 * never holds a full network address, so `scripts/check-catalog.mjs`'s own
 * scan for a resource-loading function followed by an address never trips
 * on this file.
 */
export function previewHazard(css: string): string | null {
  const lower = css.toLowerCase();
  // Two normalised forms: `compact` removes every whitespace character
  // outright, which is what lets a spaced-out hazard ("URL (...)") be
  // caught by the plain substring checks below. That same removal is
  // wrong for the at-rule name check: stripping the space between
  // "@keyframes" and its own name would merge them into one run of
  // letters ("@keyframesspin"), so a real, harmless "@keyframes spin { ...
  // }" would misread as an unknown at-rule. `collapsed` keeps exactly one
  // space per run of whitespace instead, preserving that boundary.
  const compact = lower.replace(/\s+/g, '');
  const collapsed = lower.replace(/\s+/g, ' ');

  if (compact.includes('\\')) return 'a backslash';
  if (compact.includes('/*')) return 'a comment opener';
  if (compact.includes('<')) return 'a less-than sign';

  const atRuleRe = /@([a-z-]+)(?=[\s{(;]|$)/g;
  const reducedMotionPrelude = '@media (prefers-reduced-motion: reduce) {';
  let m: RegExpExecArray | null;
  while ((m = atRuleRe.exec(collapsed))) {
    const name = m[1]!;
    if (name === 'keyframes') continue;
    if (name === 'media' && collapsed.slice(m.index, m.index + reducedMotionPrelude.length) === reducedMotionPrelude) {
      continue;
    }
    return `an at-rule other than @keyframes or the reduced-motion prelude (@${name})`;
  }

  const hazardousTokens = [
    'url(',
    'image(',
    'image-set(',
    '-webkit-image-set(',
    'cross-fade(',
    '-webkit-cross-fade(',
    'element(',
    'src(',
    'expression(',
    'behavior:',
    '-moz-binding:',
  ];
  for (const token of hazardousTokens) {
    if (compact.includes(token)) return `a resource-loading or legacy token (${token})`;
  }

  return null;
}
