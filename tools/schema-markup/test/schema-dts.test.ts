/**
 * Uses the real TypeScript compiler (a devDependency-only test oracle) to
 * type-check generated JSON-LD against schema-dts's own generated types for
 * every one of the twelve content types -- the same real-module-resolution
 * pattern tools/sql-to-types/test/typecheck.test.ts established for
 * checking generated output against a real installed package's types
 * (rather than a hand-written stub of them).
 */
import path from 'node:path';
import ts from 'typescript';
import { it, expect } from 'vitest';
import { buildJsonLd, type ContentType } from '../src/index';

function normalizeSlashes(p: string): string {
  return p.split(path.sep).join('/');
}

function typeCheck(typeName: string, jsonLiteral: string): readonly ts.Diagnostic[] {
  const virtualPath = normalizeSlashes(path.join(__dirname, `__schema_dts_check_${typeName}__.ts`));
  const source = [
    `import type { ${typeName}, WithContext } from 'schema-dts';`,
    `const value: WithContext<${typeName}> = ${jsonLiteral};`,
    'void value;',
    '',
  ].join('\n');
  const files: Record<string, string> = { [virtualPath]: source };

  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);

  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const key = normalizeSlashes(fileName);
    if (files[key] !== undefined) return ts.createSourceFile(fileName, files[key]!, languageVersion, true);
    return origGetSourceFile(fileName, languageVersion, ...rest);
  };
  const origFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => normalizeSlashes(fileName) in files || origFileExists(fileName);
  const origReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => files[normalizeSlashes(fileName)] ?? origReadFile(fileName);

  const program = ts.createProgram([virtualPath], options, host);
  return ts.getPreEmitDiagnostics(program);
}

// One realistic property-line example per content type, each built through
// buildJsonLd first (so a nested-type or format bug is caught by index.test.ts
// too, not only here) and then compiled against schema-dts's own types.
const EXAMPLES: Record<ContentType, string> = {
  Article: 'name: A piece\ndatePublished: 2024-01-01\nauthor.name: Jane Doe',
  BlogPosting: 'name: A post\ndatePublished: 2024-01-01\nauthor.name: Jane Doe',
  Product: 'name: Widget\noffers.price: 19.99\noffers.priceCurrency: USD',
  Organization: 'name: Example Corp\nurl: https://www.example.com/',
  LocalBusiness: 'name: Example Cafe\naddress.streetAddress: 1 Main St\naddress.addressLocality: Springfield',
  Person: 'name: Jane Doe',
  Event: 'name: Launch Party\nstartDate: 2024-06-01T18:00:00Z',
  Recipe: 'name: Soup\nrecipeIngredient: Water\nstep.1.text: Boil the water.',
  FAQPage: 'mainEntity.1.name: What?\nmainEntity.1.acceptedAnswer.text: This.',
  BreadcrumbList:
    'itemListElement.1.position: 1\nitemListElement.1.name: Home\nitemListElement.1.item: https://example.com/\nitemListElement.2.position: 2\nitemListElement.2.name: Category\nitemListElement.2.item: https://example.com/category',
  WebSite:
    'name: Example Site\nurl: https://www.example.com/\npotentialAction.@type: SearchAction\npotentialAction.target.@type: EntryPoint\npotentialAction.target.urlTemplate: https://query.example.com/search?q={search_term_string}\npotentialAction.query-input: required name=search_term_string',
  HowTo: 'name: Make tea\nstep.1.text: Boil water.\nstep.2.text: Add tea leaves.',
};

/**
 * Any type whose generated JSON-LD does not type-check cleanly against
 * schema-dts, with the reason.
 *
 * WebSite: the example's "query-input" key is schema.org's own actions
 * documentation shorthand for the `<property>-input` annotation convention
 * (https://schema.org/docs/actions.html, Part 4) -- a real, documented
 * schema.org JSON-LD convention this tool implements, but not a registered
 * schema:domainIncludes property of SearchAction, so schema-dts's generator
 * (which reads the same core graph this tool's own subset does) never adds
 * it to `SearchActionLeaf`'s known keys, and TypeScript's excess-property
 * check on the object literal then flags it. This is a genuine schema-dts
 * coverage gap for the actions "-input"/"-output" convention, not a bug in
 * this tool's own output.
 */
const KNOWN_DIFFERENCES: string[] = ['WebSite'];

it('generated JSON-LD for every type type-checks against schema-dts', () => {
  // Twelve separate ts.createProgram calls against schema-dts's own (large)
  // generated declaration file take longer than vitest's 5s default.
  for (const type of Object.keys(EXAMPLES) as ContentType[]) {
    const result = buildJsonLd(type, EXAMPLES[type]);
    expect(result.problems, `${type}'s own example should build with no problems`).toEqual([]);

    const diagnostics = typeCheck(type, result.json);
    const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    if (KNOWN_DIFFERENCES.includes(type)) {
      // The known gap must still be genuinely present and of the expected
      // shape -- an empty diagnostic set here would mean the gap silently
      // closed and this entry should be removed, not skipped forever.
      expect(messages.length, `${type} was listed in KNOWN_DIFFERENCES but now type-checks cleanly`).toBeGreaterThan(0);
      expect(messages.join(' '), `${type}'s diagnostics no longer match the documented gap`).toContain('query-input');
      continue;
    }
    expect(messages, `${type} should type-check against schema-dts cleanly`).toEqual([]);
  }
}, 60000);
