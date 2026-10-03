import { it, expect } from 'vitest';
import { compileStylesheet } from '../src/index';
import { LESS_CASES, LESS_COMMIT, SASS_CASES, SASS_SPEC_COMMIT } from './fixtures/published-cases';

/**
 * Cases published by the two compilers' own projects. The expected value of each is the project's published output,
 * quoted with its upstream path and commit (see fixtures/README.md); nothing here treats this package's output as the
 * answer.
 *
 * Sass: https://github.com/sass/sass-spec (MIT), spec/directives/for/for.hrx (inclusive_forward and
 * inclusive_backward), spec/variables/semi_global.hrx (in_local/double_nested), spec/directives/extend/pseudo.hrx
 * (into_pseudo/extends_after), spec/non_conformant/scss/while_directive.hrx, spec/directives/if/sass.hrx and
 * spec/directives/each.hrx, at the commit named in SASS_SPEC_COMMIT.
 */
it('Sass-spec cases for loops, conditionals, variables and extend compile to their published output', async () => {
  expect(SASS_SPEC_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  expect(SASS_CASES.length).toBeGreaterThanOrEqual(6);
  for (const published of SASS_CASES) {
    const result = await compileStylesheet(published.source, { language: published.syntax, style: 'expanded' });
    expect(result.css, published.path).toBe(published.expected);
    expect(result.warnings, published.path).toEqual([]);
    expect(result.engine).toBe('Sass 1.103.1');
  }
  // The first case is the one the plan names: a @for from 1 through 5 writes five b declarations.
  expect(SASS_CASES[0]!.path).toContain('inclusive_forward');
  expect(SASS_CASES[0]!.expected).toBe('a {\n  b: 1;\n  b: 2;\n  b: 3;\n  b: 4;\n  b: 5;\n}');
}, 60_000);

/**
 * Less: https://github.com/less/less.js (Apache-2.0), packages/test-data/tests-unit/{operations,scope,strings,
 * css-guards,merge,lazy-eval}, at the commit named in LESS_COMMIT. Each input has the published `.css` output beside it.
 */
it('Less test-data cases compile to their published output', async () => {
  expect(LESS_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  expect(LESS_CASES.length).toBeGreaterThanOrEqual(6);
  for (const published of LESS_CASES) {
    const result = await compileStylesheet(published.source, { language: 'less', style: 'expanded' });
    expect(result.css.replace(/\r\n/g, '\n').trim(), published.path).toBe(published.expected);
    expect(result.engine).toBe('Less 4.9.1');
  }
}, 60_000);
