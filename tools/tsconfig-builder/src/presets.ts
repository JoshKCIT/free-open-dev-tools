/**
 * Preset bundles of compiler options, each citing the line of the fetched
 * TypeScript handbook page (Modules - Choosing Compiler Options,
 * https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html,
 * fetched this session) that recommends it. Every value here is also a
 * value `options-catalogue.ts` accepts, so applying a preset can never
 * write an option or value the catalogue itself would refuse.
 */

export interface Preset {
  id: string;
  label: string;
  /** One or two sentences on when to reach for this preset. */
  about: string;
  /** The fetched page's own recommendation this preset is built from, quoted. */
  source: string;
  options: Readonly<Record<string, string | boolean>>;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'node-library',
    label: 'Node.js library',
    about:
      'A package published for other projects to import, checked against the strictest settings you can reasonably ask a consumer to also use.',
    source:
      'The handbook\'s "I\'m writing a library" section: "you can instead use the strictest possible settings, since satisfying those tends to satisfy all others" -- module: "node18", strict: true, verbatimModuleSyntax: true, declaration: true, sourceMap: true, declarationMap: true. This preset uses module/moduleResolution "nodenext" rather than the page\'s own "node18" example, since nodenext is the same algorithm kept current with each new Node.js release rather than frozen at one version.',
    options: {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'es2022',
      strict: true,
      verbatimModuleSyntax: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      skipLibCheck: true,
    },
  },
  {
    id: 'node-app',
    label: 'Node.js application',
    about: 'Code that is compiled and then run directly with node, not published for anyone else to import.',
    source:
      'The handbook\'s "I\'m compiling and running the outputs in Node.js" section: "module: \\"nodenext\\" ... Implied by \\"module\\": \\"nodenext\\": moduleResolution: nodenext, esModuleInterop: true, target: esnext ... Recommended: verbatimModuleSyntax: true."',
    options: {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'esnext',
      esModuleInterop: true,
      verbatimModuleSyntax: true,
      strict: true,
      skipLibCheck: true,
    },
  },
  {
    id: 'bundler-app',
    label: 'Bundled for the browser',
    about:
      'Code a bundler (Vite, esbuild, webpack and similar) will process before it ever runs, so TypeScript only needs to type-check it, not decide how it resolves at runtime.',
    source:
      'The handbook\'s "I\'m using a bundler" section: "Required: module: \\"esnext\\", moduleResolution: \\"bundler\\", esModuleInterop: true ... Recommended: noEmit: true, // or emitDeclarationOnly ... allowImportingTsExtensions: true ... verbatimModuleSyntax: true."',
    options: {
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'esnext',
      esModuleInterop: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
    },
  },
  {
    id: 'strict-checks',
    label: 'Every strict-family and extra type-checking rule',
    about:
      'Adds every optional Type Checking rule on top of strict, for a project that wants the compiler to catch as much as it possibly can.',
    source:
      'The TSConfig Reference\'s own "strict" entry: "The strict flag enables a wide range of type checking behavior that results in stronger guarantees of program correctness." This preset turns on every Type Checking option strict itself does not already imply.',
    options: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitOverride: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
