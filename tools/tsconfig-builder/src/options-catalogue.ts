/**
 * The TypeScript compiler's own tsconfig options, one entry per option this
 * tool offers, transcribed from two sources fetched this session: the
 * category headings and per-option pages of the TSConfig Reference
 * (https://www.typescriptlang.org/tsconfig/), and the pinned compiler's own
 * `ts.optionDeclarations` table (the exact enum spellings, types and
 * documented defaults the installed TypeScript 5.x accepts -- the same
 * table that page is generated from, so the two never disagree). Every
 * explanation below is written in this project's own words; the compiler
 * and the reference page are cited by category and by link, never quoted
 * into this file (AM3).
 *
 * `ts6` flags come from the TypeScript 6.0 release notes' own "Breaking
 * Changes and Deprecations" section
 * (https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html),
 * fetched and quoted in `test/compiler.test.ts`.
 */

export type OptionType = 'boolean' | 'enum' | 'string' | 'list';

export interface Ts6Flag {
  status: 'deprecated' | 'removed';
  /** The release note's own wording, quoted, for the SUMMARY and the flagged-option test. */
  note: string;
  /** Restricts the flag to specific values of this option. Absent means the whole option. */
  values?: readonly string[];
}

export interface TsConfigOption {
  name: string;
  /** The TSConfig Reference's own category heading for this option, fetched this session. */
  category: string;
  type: OptionType;
  /** Accepted values for an 'enum' option, or the accepted element values for a 'list' option's entries. */
  values?: readonly string[];
  /** The documented default, as prose, exactly as short as the reference states it. */
  default?: string;
  explanation: string;
  docsUrl: string;
  ts6?: readonly Ts6Flag[];
}

const TS_URL = 'https://www.typescriptlang.org/tsconfig/#';

export const OPTIONS: readonly TsConfigOption[] = [
  // --- Type Checking (the whole category, 20 options) ------------------
  {
    name: 'strict',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Turns on every strict-mode family check below at once (and any new one a later compiler version adds), so a project catches the widest range of type mistakes.',
    docsUrl: TS_URL + 'strict',
  },
  {
    name: 'noImplicitAny',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Refuses to silently fall back to the any type when a parameter or variable has no annotation and none can be inferred, so a typo like a missing method never slips through unnoticed.',
    docsUrl: TS_URL + 'noImplicitAny',
  },
  {
    name: 'strictNullChecks',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Makes null and undefined their own distinct types instead of assignable to everything, so a value that might be missing has to be checked before it is used.',
    docsUrl: TS_URL + 'strictNullChecks',
  },
  {
    name: 'strictFunctionTypes',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Checks a function value against the type it is assigned to using the stricter, contravariant rule for its parameters, catching an unsafe function substitution that the looser rule would allow.',
    docsUrl: TS_URL + 'strictFunctionTypes',
  },
  {
    name: 'strictBindCallApply',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      "Type-checks the arguments passed to a function's own .call, .bind and .apply methods against that function's real parameter list, instead of accepting anything.",
    docsUrl: TS_URL + 'strictBindCallApply',
  },
  {
    name: 'strictPropertyInitialization',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Reports a class property that is declared but never assigned in the constructor, so a field cannot be silently undefined at runtime while its type claims otherwise.',
    docsUrl: TS_URL + 'strictPropertyInitialization',
  },
  {
    name: 'strictBuiltinIteratorReturn',
    category: 'Type Checking',
    type: 'boolean',
    default: 'true if strict; false otherwise',
    explanation:
      "Gives a built-in iterator's return type as undefined instead of any, so code that reads past the end of an iterator keeps its normal type checking instead of losing it.",
    docsUrl: TS_URL + 'strictBuiltinIteratorReturn',
  },
  {
    name: 'noImplicitThis',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Reports a use of this whose type the compiler cannot work out, which usually means the function was detached from the object it was written to run on.',
    docsUrl: TS_URL + 'noImplicitThis',
  },
  {
    name: 'useUnknownInCatchVariables',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Gives a caught exception the type unknown instead of any, so the code has to narrow it (for example with instanceof Error) before reading anything off it.',
    docsUrl: TS_URL + 'useUnknownInCatchVariables',
  },
  {
    name: 'alwaysStrict',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false, unless strict is set',
    explanation:
      'Parses every file under JavaScript\'s own strict mode and writes "use strict" into the output, so mistakes strict mode turns into errors (like assigning to a read-only global) are caught instead of silently ignored.',
    docsUrl: TS_URL + 'alwaysStrict',
    ts6: [
      {
        status: 'deprecated',
        values: ['false'],
        note: 'Deprecated: --alwaysStrict false. "In TypeScript 6.0, all code will be assumed to be in JavaScript strict mode."',
      },
    ],
  },
  {
    name: 'noUnusedLocals',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Reports a local variable that is declared but never read, the way an unused-variable lint rule would.',
    docsUrl: TS_URL + 'noUnusedLocals',
  },
  {
    name: 'noUnusedParameters',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Reports a function parameter that is never read inside the function body; a parameter name starting with an underscore is exempt, matching the compiler\'s own convention for "intentionally unused".',
    docsUrl: TS_URL + 'noUnusedParameters',
  },
  {
    name: 'exactOptionalPropertyTypes',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Makes an optional property (written with a ?) mean the key may be absent, not that it may also be explicitly set to undefined -- the two stop being treated as the same thing.',
    docsUrl: TS_URL + 'exactOptionalPropertyTypes',
  },
  {
    name: 'noImplicitReturns',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Checks every code path through a function that returns a value, so a branch that forgets its own return statement is reported instead of silently returning undefined.',
    docsUrl: TS_URL + 'noImplicitReturns',
  },
  {
    name: 'noFallthroughCasesInSwitch',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Reports a non-empty switch case that falls through to the next one without a break, return or throw, catching the classic missing-break bug.',
    docsUrl: TS_URL + 'noFallthroughCasesInSwitch',
  },
  {
    name: 'noUncheckedIndexedAccess',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Adds undefined to the type of a value read through an index signature (for example obj[key]), reflecting that the key might not actually be present.',
    docsUrl: TS_URL + 'noUncheckedIndexedAccess',
  },
  {
    name: 'noImplicitOverride',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Requires a subclass method that replaces a base class method to be marked override, so renaming the base method surfaces every place that silently stopped overriding it.',
    docsUrl: TS_URL + 'noImplicitOverride',
  },
  {
    name: 'noPropertyAccessFromIndexSignature',
    category: 'Type Checking',
    type: 'boolean',
    default: 'false',
    explanation:
      'Requires a property that only exists because of an index signature to be read with obj["key"] rather than obj.key, so a real typo\'d property name is not silently absorbed by the index signature.',
    docsUrl: TS_URL + 'noPropertyAccessFromIndexSignature',
  },
  {
    name: 'allowUnusedLabels',
    category: 'Type Checking',
    type: 'boolean',
    explanation:
      'Set to false, turns an unused statement label -- almost always a typo for an object literal -- into a compiler error instead of an editor suggestion.',
    docsUrl: TS_URL + 'allowUnusedLabels',
  },
  {
    name: 'allowUnreachableCode',
    category: 'Type Checking',
    type: 'boolean',
    explanation:
      'Set to false, turns code the compiler can prove will never run (for example, after every branch of an if/else already returned) into a compiler error instead of an editor suggestion.',
    docsUrl: TS_URL + 'allowUnreachableCode',
  },

  // --- Modules (11 common options) --------------------------------------
  {
    name: 'module',
    category: 'Modules',
    type: 'enum',
    values: [
      'none',
      'commonjs',
      'amd',
      'system',
      'umd',
      'es6',
      'es2015',
      'es2020',
      'es2022',
      'esnext',
      'node16',
      'node18',
      'node20',
      'nodenext',
      'preserve',
    ],
    explanation:
      'Chooses the module system the emitted JavaScript uses (CommonJS require, an ES module import, or one of the Node.js-specific modes that pick per file), which also changes how imports resolve.',
    docsUrl: TS_URL + 'module',
    ts6: [
      {
        status: 'removed',
        values: ['amd', 'umd', 'systemjs', 'none'],
        note: '"The following flag values are no longer supported: --module amd --module umd --module systemjs --module none."',
      },
    ],
  },
  {
    name: 'moduleResolution',
    category: 'Modules',
    type: 'enum',
    values: ['node10', 'node', 'classic', 'node16', 'nodenext', 'bundler'],
    explanation:
      "Chooses the algorithm used to turn an import specifier into a real file: Node.js's classic CommonJS algorithm, its newer dual ESM/CommonJS-aware algorithm, or the more permissive algorithm a bundler uses.",
    docsUrl: TS_URL + 'moduleResolution',
    ts6: [
      {
        status: 'deprecated',
        values: ['node', 'node10'],
        note: '"In TypeScript 6.0, --moduleResolution node (specifically, --moduleResolution node10) is deprecated."',
      },
      {
        status: 'removed',
        values: ['classic'],
        note: '"The moduleResolution: classic setting has been removed."',
      },
    ],
  },
  {
    name: 'baseUrl',
    category: 'Modules',
    type: 'string',
    explanation:
      'Sets a directory that a bare import specifier (one with no ./ or ../ prefix) is looked up against, before node_modules is tried.',
    docsUrl: TS_URL + 'baseUrl',
    ts6: [
      {
        status: 'deprecated',
        note: '"Deprecated: --baseUrl. ... baseUrl is also considered a look-up root for module resolution," which TypeScript 6.0 deprecates as a source of surprising, environment-dependent import resolution.',
      },
    ],
  },
  {
    name: 'rootDir',
    category: 'Modules',
    type: 'string',
    default: 'the longest common path of all non-declaration input files',
    explanation:
      'Names the input directory whose structure the emitted output directory mirrors, so a file two folders deep stays two folders deep in the build output.',
    docsUrl: TS_URL + 'rootDir',
  },
  {
    name: 'rootDirs',
    category: 'Modules',
    type: 'list',
    explanation:
      'Tells the compiler to treat several directories as though their contents were merged into one, so a relative import can cross between generated and hand-written source trees.',
    docsUrl: TS_URL + 'rootDirs',
  },
  {
    name: 'typeRoots',
    category: 'Modules',
    type: 'list',
    explanation:
      'Replaces the default rule of pulling in every @types package found in any enclosing node_modules with an explicit list of directories to look in instead.',
    docsUrl: TS_URL + 'typeRoots',
  },
  {
    name: 'types',
    category: 'Modules',
    type: 'list',
    explanation:
      'Limits which @types packages are added to the global scope automatically to just the ones named here, instead of every @types package the project happens to have installed.',
    docsUrl: TS_URL + 'types',
  },
  {
    name: 'resolveJsonModule',
    category: 'Modules',
    type: 'boolean',
    default: 'false',
    explanation: "Allows importing a .json file directly, with its shape used as the imported value's type.",
    docsUrl: TS_URL + 'resolveJsonModule',
  },
  {
    name: 'noResolve',
    category: 'Modules',
    type: 'boolean',
    default: 'false',
    explanation:
      "Stops the compiler from following a file's own imports to discover more files to include, while still checking that each import resolves to something valid.",
    docsUrl: TS_URL + 'noResolve',
  },
  {
    name: 'allowImportingTsExtensions',
    category: 'Modules',
    type: 'boolean',
    default: 'false',
    explanation:
      'Allows one TypeScript file to import another by its literal .ts, .mts or .tsx extension, on the understanding that only noEmit or emitDeclarationOnly is in use, since a real JavaScript runtime cannot resolve a .ts import.',
    docsUrl: TS_URL + 'allowImportingTsExtensions',
  },

  // --- Emit (12 common options) ------------------------------------------
  {
    name: 'declaration',
    category: 'Emit',
    type: 'boolean',
    default: 'false, unless composite is set',
    explanation:
      "Generates a .d.ts type declaration file alongside each output file, which is what lets a package's own consumers get real types and editor intellisense for it.",
    docsUrl: TS_URL + 'declaration',
  },
  {
    name: 'declarationMap',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Generates a source map for each .d.ts file pointing back at the original .ts source, so an editor\'s "go to definition" on a published package can jump into its real source.',
    docsUrl: TS_URL + 'declarationMap',
  },
  {
    name: 'emitDeclarationOnly',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Emits only .d.ts declaration files and no JavaScript, for the case where a separate tool (a bundler, or another transpiler) is producing the runnable output.',
    docsUrl: TS_URL + 'emitDeclarationOnly',
  },
  {
    name: 'sourceMap',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Emits a .js.map file next to each output file, so a debugger shows the original TypeScript source instead of the compiled JavaScript.',
    docsUrl: TS_URL + 'sourceMap',
  },
  {
    name: 'inlineSourceMap',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Embeds the source map directly inside each output file instead of writing a separate .js.map file, at the cost of a larger output file. Mutually exclusive with sourceMap.',
    docsUrl: TS_URL + 'inlineSourceMap',
  },
  {
    name: 'noEmit',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Runs the compiler only for type checking and never writes any JavaScript, declaration or map file, leaving the actual conversion to another tool such as a bundler.',
    docsUrl: TS_URL + 'noEmit',
  },
  {
    name: 'outDir',
    category: 'Emit',
    type: 'string',
    explanation:
      'Names the directory every emitted file is written into, keeping compiled output separate from the hand-written source tree.',
    docsUrl: TS_URL + 'outDir',
  },
  {
    name: 'outFile',
    category: 'Emit',
    type: 'string',
    explanation:
      'Concatenates every module into one output file; only usable when module is none, system or amd, since those are the only formats the compiler itself knows how to concatenate.',
    docsUrl: TS_URL + 'outFile',
    ts6: [{ status: 'removed', note: '"The --outFile option has been removed from TypeScript 6.0."' }],
  },
  {
    name: 'removeComments',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation: 'Strips every comment out of the emitted JavaScript, including JSDoc comments.',
    docsUrl: TS_URL + 'removeComments',
  },
  {
    name: 'importHelpers',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      "Imports the compiler's helper functions (used for older-target class extension, spreading, and similar) from the tslib package instead of writing a fresh copy of them into every file that needs one.",
    docsUrl: TS_URL + 'importHelpers',
  },
  {
    name: 'downlevelIteration',
    category: 'Emit',
    type: 'boolean',
    default: 'false',
    explanation:
      'Makes for-of, array spread and similar iteration constructs behave correctly on older JavaScript targets, at the cost of somewhat larger and slower emitted code.',
    docsUrl: TS_URL + 'downlevelIteration',
    ts6: [
      {
        status: 'deprecated',
        note: '"--downlevelIteration only has effects on ES5 emit, and since --target es5 has been deprecated, --downlevelIteration no longer serves a purpose. ... In TypeScript 6.0, setting --downlevelIteration at all will lead to a deprecation error."',
      },
    ],
  },
  {
    name: 'newLine',
    category: 'Emit',
    type: 'enum',
    values: ['crlf', 'lf'],
    default: 'lf',
    explanation: 'Chooses the line-ending sequence the compiler writes into every file it emits.',
    docsUrl: TS_URL + 'newLine',
  },

  // --- Interop Constraints (8 common options) -----------------------------
  {
    name: 'isolatedModules',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'true if verbatimModuleSyntax; false otherwise',
    explanation:
      "Warns about any construct that a single-file transpiler (one that never looks at other files, such as Babel) could not compile correctly on its own, so this project's code stays safe to run through one.",
    docsUrl: TS_URL + 'isolatedModules',
  },
  {
    name: 'verbatimModuleSyntax',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'false',
    explanation:
      'Requires every import or export to be written exactly as it should be emitted -- a type-only import needs an explicit import type -- so a single-file transpiler never has to guess which imports to erase.',
    docsUrl: TS_URL + 'verbatimModuleSyntax',
  },
  {
    name: 'isolatedDeclarations',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'false',
    explanation:
      'Requires every exported value to carry enough of its own type annotation that a .d.ts file could be generated for it without running the full type checker, which is what lets faster, parallel declaration-file generators work.',
    docsUrl: TS_URL + 'isolatedDeclarations',
  },
  {
    name: 'erasableSyntaxOnly',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'false',
    explanation:
      "Refuses TypeScript syntax that has its own runtime behaviour -- enums, namespaces with runtime code, constructor-parameter properties -- so the file stays runnable by simply deleting its type syntax, the way Node.js's own built-in TypeScript support requires.",
    docsUrl: TS_URL + 'erasableSyntaxOnly',
  },
  {
    name: 'esModuleInterop',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'true if module is node16, nodenext, or preserve; false otherwise',
    explanation:
      "Changes how a CommonJS module's default export is imported so that import x from 'pkg' behaves the way a real ES module consumer would expect, instead of matching CommonJS's own require() shape too literally.",
    docsUrl: TS_URL + 'esModuleInterop',
    ts6: [
      {
        status: 'deprecated',
        values: ['false'],
        note: '"Deprecated: --esModuleInterop false and --allowSyntheticDefaultImports false. The following settings can no longer be set to false: esModuleInterop allowSyntheticDefaultImports."',
      },
    ],
  },
  {
    name: 'allowSyntheticDefaultImports',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'true if module is system, or esModuleInterop is set; false otherwise',
    explanation:
      "Allows writing import x from 'pkg' for a module that has no real default export, on the understanding that the module loader will synthesize one -- the type-checking half of esModuleInterop.",
    docsUrl: TS_URL + 'allowSyntheticDefaultImports',
    ts6: [
      {
        status: 'deprecated',
        values: ['false'],
        note: '"Deprecated: --esModuleInterop false and --allowSyntheticDefaultImports false. The following settings can no longer be set to false: esModuleInterop allowSyntheticDefaultImports."',
      },
    ],
  },
  {
    name: 'forceConsistentCasingInFileNames',
    category: 'Interop Constraints',
    type: 'boolean',
    default: 'true',
    explanation:
      "Reports an import whose casing does not match the file's real name on disk, catching a bug that only shows up when someone else checks the project out on a case-sensitive file system.",
    docsUrl: TS_URL + 'forceConsistentCasingInFileNames',
  },

  // --- Language and Environment (8 common options) ------------------------
  {
    name: 'target',
    category: 'Language and Environment',
    type: 'enum',
    values: [
      'es3',
      'es5',
      'es6',
      'es2015',
      'es2016',
      'es2017',
      'es2018',
      'es2019',
      'es2020',
      'es2021',
      'es2022',
      'es2023',
      'es2024',
      'esnext',
    ],
    explanation:
      'Chooses the oldest ECMAScript version the emitted JavaScript needs to run on, which decides which newer language features get rewritten into older equivalents and which built-in types are assumed to exist.',
    docsUrl: TS_URL + 'target',
    ts6: [
      {
        status: 'deprecated',
        values: ['es3', 'es5'],
        note: '"TypeScript\'s lowest target will now be ES2015, and the target: es5 option is deprecated." (es3 was already below the reference\'s own documented minimum.)',
      },
    ],
  },
  {
    name: 'jsx',
    category: 'Language and Environment',
    type: 'enum',
    values: ['preserve', 'react-native', 'react-jsx', 'react-jsxdev', 'react'],
    explanation:
      'Chooses how JSX syntax in a .tsx file is emitted: left untouched for a bundler to handle, rewritten to explicit React.createElement calls, or rewritten to the newer automatic JSX runtime import.',
    docsUrl: TS_URL + 'jsx',
  },
  {
    name: 'useDefineForClassFields',
    category: 'Language and Environment',
    type: 'boolean',
    default: 'true if target is ES2022 or higher, including ESNext; false otherwise',
    explanation:
      "Emits a class field using the real ECMAScript class-fields semantics (define) instead of TypeScript's own older, slightly different emulation, matching how a modern JavaScript engine actually runs the code.",
    docsUrl: TS_URL + 'useDefineForClassFields',
  },
  {
    name: 'moduleDetection',
    category: 'Language and Environment',
    type: 'enum',
    values: ['auto', 'legacy', 'force'],
    default: 'auto',
    explanation:
      'Decides whether a file with no import or export statement is still treated as a module (rather than a global script), which changes whether its top-level declarations leak into every other file.',
    docsUrl: TS_URL + 'moduleDetection',
  },
  {
    name: 'experimentalDecorators',
    category: 'Language and Environment',
    type: 'boolean',
    default: 'false',
    explanation:
      "Enables TypeScript's original, pre-standard decorator syntax and semantics, for a codebase that adopted decorators before the current TC39 proposal existed.",
    docsUrl: TS_URL + 'experimentalDecorators',
  },
  {
    name: 'emitDecoratorMetadata',
    category: 'Language and Environment',
    type: 'boolean',
    default: 'false',
    explanation:
      'Emits extra type metadata alongside a decorated declaration, for use by a reflection-based library such as one built on reflect-metadata.',
    docsUrl: TS_URL + 'emitDecoratorMetadata',
  },
  {
    name: 'noLib',
    category: 'Language and Environment',
    type: 'boolean',
    default: 'false',
    explanation:
      'Skips including any built-in type declarations at all (not even Array or String), for the rare case of a project that supplies its own complete replacement set.',
    docsUrl: TS_URL + 'noLib',
  },
  {
    name: 'lib',
    category: 'Language and Environment',
    type: 'list',
    values: [
      'es5',
      'es6',
      'es2015',
      'es7',
      'es2016',
      'es2017',
      'es2018',
      'es2019',
      'es2020',
      'es2021',
      'es2022',
      'es2023',
      'es2024',
      'esnext',
      'dom',
      'dom.iterable',
      'dom.asynciterable',
      'webworker',
      'webworker.importscripts',
      'webworker.iterable',
      'webworker.asynciterable',
      'scripthost',
    ],
    explanation:
      'Chooses which built-in type declaration files are included -- a JS language level (for Promise, Array.prototype.flat, and so on) plus, separately, an environment such as dom or webworker -- instead of the set target alone would imply.',
    docsUrl: TS_URL + 'lib',
  },

  // --- Projects (3 common options) ----------------------------------------
  {
    name: 'composite',
    category: 'Projects',
    type: 'boolean',
    default: 'false',
    explanation:
      "Marks a project as usable from another project's own project references, which requires every source file to be explicitly listed and turns on incremental build information.",
    docsUrl: TS_URL + 'composite',
  },
  {
    name: 'incremental',
    category: 'Projects',
    type: 'boolean',
    default: 'true if composite; false otherwise',
    explanation:
      'Saves information about the project from the last build to disk, so a later build can skip re-checking files that could not have changed.',
    docsUrl: TS_URL + 'incremental',
  },
  {
    name: 'tsBuildInfoFile',
    category: 'Projects',
    type: 'string',
    explanation: 'Names the file incremental or composite builds use to store that saved project information.',
    docsUrl: TS_URL + 'tsBuildInfoFile',
  },

  // --- Completeness (one option the page's checkboxes need) --------------
  {
    name: 'skipLibCheck',
    category: 'Completeness',
    type: 'boolean',
    default: 'false',
    explanation:
      "Skips type-checking the contents of .d.ts declaration files (including a dependency's own), trading a small amount of type-system accuracy for a real reduction in compile time on a large project.",
    docsUrl: TS_URL + 'skipLibCheck',
  },
];

export function findOption(name: string): TsConfigOption | undefined {
  return OPTIONS.find((option) => option.name === name);
}
