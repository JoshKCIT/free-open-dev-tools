import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';
import { NEEDS, inlineScriptHashes, policyFor } from '../lib/csp.mjs';
import { gradeCsp } from '../../tools/security-headers/src/csp-grade.ts';
import { checkHtml } from '../check-csp.mjs';

/**
 * Every page policy the site can generate is graded by the site's own policy grader (the security headers tool). The
 * grader is a mirror held up to the generator: a policy may differ from a perfect one only by four named allowances,
 * each earned only by the need that explains it, and any other finding fails the test.
 *
 * - frame-ancestors: a policy in a meta tag cannot carry it, so it is never written.
 * - upgrade-insecure-requests: deliberately absent, because everything a page loads is from its own address.
 * - script-unsafe-eval: only on a page that declares eval.
 * - style-unsafe-inline: only on a page that declares sandboxed-html or mermaid-frame (the preview frame's own policy
 *   asks for inline styles, and a parent that forbids them would cancel them).
 *
 * The test sits outside the tool folders on purpose: the packaging rule binds the folders, not repository tests.
 */

// Stand-in hashes of the right shape: the grader reads the form of a hash, never its value.
const [THEME_HASH] = inlineScriptHashes('<script>theme</script>');
const FRAME_HASHES = inlineScriptHashes('<script>frame one</script><script>frame two</script>');

const policyOf = (needs) => policyFor({ needs, scriptHashes: [THEME_HASH], frameHashes: FRAME_HASHES });

/** The finding rule ids a policy with these needs may carry, sorted. */
function allowancesFor(needs) {
  const allowed = ['frame-ancestors', 'upgrade-insecure-requests'];
  if (needs.includes('eval')) allowed.push('script-unsafe-eval');
  if (needs.includes('sandboxed-html') || needs.includes('mermaid-frame')) allowed.push('style-unsafe-inline');
  return allowed.sort();
}

const findingIds = (grade) => grade.findings.map((f) => f.rule).sort();
const unexpectedIn = (policy, needs) => findingIds(gradeCsp(policy)).filter((id) => !allowancesFor(needs).includes(id));

/** Every distinct needs combination declared in the catalog's meta files, as sorted comma lists. */
function catalogCombinations() {
  const found = new Set();
  const toolsDir = join(ROOT, 'tools');
  for (const id of readdirSync(toolsDir)) {
    const metaPath = join(toolsDir, id, 'src', 'meta.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    found.add((meta.needs ?? []).join(','));
  }
  return found;
}

// The two combinations planned for later tools: the font inspector and the mail file viewer.
const PLANNED = ['eval,wasm,workers', 'sandboxed-html,workers'];
const combinations = [...new Set([...catalogCombinations(), ...PLANNED])].sort();

describe('the policies the site generates, graded by the site grader', () => {
  it('covers every combination in the catalog and the two planned ones', () => {
    expect(combinations.length).toBeGreaterThanOrEqual(10);
    for (const planned of PLANNED) expect(combinations).toContain(planned);
    expect(combinations).toContain('');
    for (const combo of combinations) {
      for (const term of combo.split(',').filter(Boolean)) expect(NEEDS).toContain(term);
    }
  });

  it.each(combinations.map((combo) => [combo === '' ? 'baseline' : combo, combo.split(',').filter(Boolean)]))(
    'grades %s with only the allowances its needs earn',
    (_label, needs) => {
      const grade = gradeCsp(policyOf(needs));
      expect(grade.empty).toBe(false);
      expect(findingIds(grade)).toEqual(allowancesFor(needs));
      // Nothing worse than the eval allowance may ever appear, and a page without eval has no medium finding at all.
      for (const finding of grade.findings) {
        expect(['info', 'low'].includes(finding.severity) || finding.rule === 'script-unsafe-eval').toBe(true);
      }
    },
  );

  it('adds nothing for workers or WebAssembly alone', () => {
    const baseline = findingIds(gradeCsp(policyOf([])));
    expect(findingIds(gradeCsp(policyOf(['workers'])))).toEqual(baseline);
    expect(findingIds(gradeCsp(policyOf(['wasm', 'workers'])))).toEqual(baseline);
  });

  it('adds exactly the eval finding for eval and exactly the inline style finding for previews and Mermaid', () => {
    const baseline = findingIds(gradeCsp(policyOf([])));
    expect(findingIds(gradeCsp(policyOf(['eval'])))).toEqual([...baseline, 'script-unsafe-eval'].sort());
    expect(findingIds(gradeCsp(policyOf(['sandboxed-html'])))).toEqual([...baseline, 'style-unsafe-inline'].sort());
    expect(findingIds(gradeCsp(policyOf(['mermaid-frame'])))).toEqual([...baseline, 'style-unsafe-inline'].sort());
  });

  it('grades the baseline with exactly the two always-allowed findings', () => {
    expect(findingIds(gradeCsp(policyOf([])))).toEqual(['frame-ancestors', 'upgrade-insecure-requests']);
  });
});

describe('a weakened policy is rejected by the same assertion', () => {
  const real = policyOf(['workers']);

  it.each([
    ['unsafe-inline in script-src', "script-src 'self'", "script-src 'self' 'unsafe-inline'"],
    ['a wildcard in script-src', "script-src 'self'", "script-src * 'self'"],
    ['a wildcard worker source', 'worker-src blob:', 'worker-src *'],
    ['an open default source', "default-src 'none'", 'default-src *'],
    ['an open object source', "object-src 'none'", 'object-src *'],
    ['eval on a page that does not declare it', "script-src 'self'", "script-src 'self' 'unsafe-eval'"],
  ])('finds a problem in %s', (_label, from, to) => {
    expect(real).toContain(from);
    const weakened = real.replace(from, to);
    expect(weakened).not.toBe(real);
    expect(unexpectedIn(weakened, ['workers']).length).toBeGreaterThan(0);
  });

  it('shows the real policy has no unexpected finding, so the rejection above is the change and not the baseline', () => {
    expect(unexpectedIn(real, ['workers'])).toEqual([]);
  });
});

describe('what the grader cannot see is held by the build gate', () => {
  it('does not flag a same-origin worker source, so the gate refuses it instead', () => {
    const page = (policy) =>
      `<!doctype html><html><head>\n<meta http-equiv="Content-Security-Policy" content="${policy}" />\n<meta charset="utf-8" />\n</head><body></body></html>`;
    const real = policyOf(['workers']);
    const loose = real.replace('worker-src blob:', "worker-src 'self'");
    expect(findingIds(gradeCsp(loose))).toEqual(findingIds(gradeCsp(real)));
    expect(checkHtml({ file: 'p.html', html: page(real), needs: ['workers'] }).join(' ')).not.toContain('worker-src');
    expect(checkHtml({ file: 'p.html', html: page(loose), needs: ['workers'] }).join(' ')).toContain(
      "worker-src must be exactly 'none' or blob:",
    );
  });
});
