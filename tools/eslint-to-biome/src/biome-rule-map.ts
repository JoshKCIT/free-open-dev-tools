/**
 * A rule-mapping table generated from Biome's own generated ESLint migrate
 * match arms (MIT OR Apache-2.0), bundled for a pinned Biome version and
 * scoped to ESLint core plus six common plugins (D-108). Vendored byte for
 * byte at test/fixtures/biome/; this module is a generated copy with an
 * explicit wide type so the compiler never infers a literal type for it.
 * See test/build-rule-map.ts for the generator this module must equal,
 * and src/biome-rule-map-NOTICE.txt for the full attribution notice.
 */

export const BIOME_VERSION = '@biomejs/biome@2.5.14';
export const BIOME_COMMIT = 'af4365d2b80177d0e0434c0ed4fd2c9171afc56c';
export const MAPPED_PLUGINS = ['@typescript-eslint', 'react', 'react-hooks', 'jsx-a11y', 'import', 'unicorn'] as const;

export const BIOME_RULE_MAP: Readonly<
  { eslint: string; plugin?: string; targets: { group: string; rule: string }[]; nursery: boolean; inspired: boolean }[]
> = [
  {
    eslint: 'array-callback-return',
    targets: [
      {
        group: 'suspicious',
        rule: 'useIterableCallbackReturn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'arrow-body-style',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentArrowReturn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'class-methods-use-this',
    targets: [
      {
        group: 'nursery',
        rule: 'useThisInClassMethods',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'complexity',
    targets: [
      {
        group: 'complexity',
        rule: 'noExcessiveCognitiveComplexity',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'constructor-super',
    targets: [
      {
        group: 'correctness',
        rule: 'noInvalidConstructorSuper',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'curly',
    targets: [
      {
        group: 'style',
        rule: 'useBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'default-case',
    targets: [
      {
        group: 'style',
        rule: 'useDefaultSwitchClause',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'default-case-last',
    targets: [
      {
        group: 'suspicious',
        rule: 'useDefaultSwitchClauseLast',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'default-param-last',
    targets: [
      {
        group: 'style',
        rule: 'useDefaultParameterLast',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'dot-notation',
    targets: [
      {
        group: 'complexity',
        rule: 'useLiteralKeys',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'eqeqeq',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDoubleEquals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'for-direction',
    targets: [
      {
        group: 'correctness',
        rule: 'useValidForDirection',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'func-style',
    targets: [
      {
        group: 'nursery',
        rule: 'useConsistentFunctionStyle',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'getter-return',
    targets: [
      {
        group: 'suspicious',
        rule: 'useGetterReturn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'grouped-accessor-pairs',
    targets: [
      {
        group: 'style',
        rule: 'useGroupedAccessorPairs',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'guard-for-in',
    targets: [
      {
        group: 'suspicious',
        rule: 'useGuardForIn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'max-classes-per-file',
    targets: [
      {
        group: 'style',
        rule: 'noExcessiveClassesPerFile',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'max-lines',
    targets: [
      {
        group: 'style',
        rule: 'noExcessiveLinesPerFile',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'max-lines-per-function',
    targets: [
      {
        group: 'complexity',
        rule: 'noExcessiveLinesPerFunction',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'max-nested-callbacks',
    targets: [
      {
        group: 'nursery',
        rule: 'noExcessiveNestedCallbacks',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'max-params',
    targets: [
      {
        group: 'complexity',
        rule: 'useMaxParams',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-alert',
    targets: [
      {
        group: 'suspicious',
        rule: 'noAlert',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-array-constructor',
    targets: [
      {
        group: 'style',
        rule: 'useArrayLiterals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-async-promise-executor',
    targets: [
      {
        group: 'suspicious',
        rule: 'noAsyncPromiseExecutor',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-await-in-loop',
    targets: [
      {
        group: 'performance',
        rule: 'noAwaitInLoops',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-bitwise',
    targets: [
      {
        group: 'suspicious',
        rule: 'noBitwiseOperators',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-case-declarations',
    targets: [
      {
        group: 'correctness',
        rule: 'noSwitchDeclarations',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-class-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noClassAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-compare-neg-zero',
    targets: [
      {
        group: 'suspicious',
        rule: 'noCompareNegZero',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-cond-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noAssignInExpressions',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-console',
    targets: [
      {
        group: 'suspicious',
        rule: 'noConsole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-const-assign',
    targets: [
      {
        group: 'correctness',
        rule: 'noConstAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-constant-binary-expression',
    targets: [
      {
        group: 'suspicious',
        rule: 'noConstantBinaryExpressions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-constant-condition',
    targets: [
      {
        group: 'correctness',
        rule: 'noConstantCondition',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-constructor-return',
    targets: [
      {
        group: 'correctness',
        rule: 'noConstructorReturn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-continue',
    targets: [
      {
        group: 'style',
        rule: 'noContinue',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-control-regex',
    targets: [
      {
        group: 'suspicious',
        rule: 'noControlCharactersInRegex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-debugger',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDebugger',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-div-regex',
    targets: [
      {
        group: 'complexity',
        rule: 'noDivRegex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-dupe-args',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateParameters',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-dupe-class-members',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateClassMembers',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-dupe-else-if',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateElseIf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-dupe-keys',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateObjectKeys',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-duplicate-case',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateCase',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-else-return',
    targets: [
      {
        group: 'style',
        rule: 'noUselessElse',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-empty',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptyBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-character-class',
    targets: [
      {
        group: 'correctness',
        rule: 'noEmptyCharacterClassInRegex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-function',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptyBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-pattern',
    targets: [
      {
        group: 'correctness',
        rule: 'noEmptyPattern',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-static-block',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptyBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-eq-null',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEqualsToNull',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-eval',
    targets: [
      {
        group: 'security',
        rule: 'noGlobalEval',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-ex-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noCatchAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-extend-native',
    targets: [
      {
        group: 'nursery',
        rule: 'noExtendNative',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-extra-boolean-cast',
    targets: [
      {
        group: 'complexity',
        rule: 'noExtraBooleanCast',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-extra-label',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessLabel',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-fallthrough',
    targets: [
      {
        group: 'suspicious',
        rule: 'noFallthroughSwitchClause',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-func-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noFunctionAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-global-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noGlobalAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-implicit-coercion',
    targets: [
      {
        group: 'complexity',
        rule: 'noImplicitCoercions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-implied-eval',
    targets: [
      {
        group: 'nursery',
        rule: 'noImpliedEval',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-import-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noImportAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-inner-declarations',
    targets: [
      {
        group: 'correctness',
        rule: 'noInnerDeclarations',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-irregular-whitespace',
    targets: [
      {
        group: 'suspicious',
        rule: 'noIrregularWhitespace',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-label-var',
    targets: [
      {
        group: 'suspicious',
        rule: 'noLabelVar',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-labels',
    targets: [
      {
        group: 'suspicious',
        rule: 'noConfusingLabels',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-lone-blocks',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessLoneBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-lonely-if',
    targets: [
      {
        group: 'style',
        rule: 'useCollapsedElseIf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-loop-func',
    targets: [
      {
        group: 'nursery',
        rule: 'noLoopFunc',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-loss-of-precision',
    targets: [
      {
        group: 'correctness',
        rule: 'noPrecisionLoss',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-magic-numbers',
    targets: [
      {
        group: 'style',
        rule: 'noMagicNumbers',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-misleading-character-class',
    targets: [
      {
        group: 'suspicious',
        rule: 'noMisleadingCharacterClass',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-multi-assign',
    targets: [
      {
        group: 'style',
        rule: 'noMultiAssign',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-multi-str',
    targets: [
      {
        group: 'style',
        rule: 'noMultilineString',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-negated-condition',
    targets: [
      {
        group: 'style',
        rule: 'noNegationElse',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-nested-ternary',
    targets: [
      {
        group: 'style',
        rule: 'noNestedTernary',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-new',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnusedInstantiation',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-new-func',
    targets: [
      {
        group: 'nursery',
        rule: 'noImpliedEval',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'no-new-native-nonconstructor',
    targets: [
      {
        group: 'correctness',
        rule: 'noInvalidBuiltinInstantiation',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-new-wrappers',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentBuiltinInstantiation',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-nonoctal-decimal-escape',
    targets: [
      {
        group: 'correctness',
        rule: 'noNonoctalDecimalEscape',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-obj-calls',
    targets: [
      {
        group: 'correctness',
        rule: 'noGlobalObjectCalls',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-octal-escape',
    targets: [
      {
        group: 'suspicious',
        rule: 'noOctalEscape',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-param-reassign',
    targets: [
      {
        group: 'style',
        rule: 'noParameterAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-plusplus',
    targets: [
      {
        group: 'style',
        rule: 'noIncrementDecrement',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-proto',
    targets: [
      {
        group: 'suspicious',
        rule: 'noProto',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-prototype-builtins',
    targets: [
      {
        group: 'suspicious',
        rule: 'noPrototypeBuiltins',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-redeclare',
    targets: [
      {
        group: 'suspicious',
        rule: 'noRedeclare',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-regex-spaces',
    targets: [
      {
        group: 'complexity',
        rule: 'noAdjacentSpacesInRegex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-restricted-globals',
    targets: [
      {
        group: 'style',
        rule: 'noRestrictedGlobals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-restricted-imports',
    targets: [
      {
        group: 'style',
        rule: 'noRestrictedImports',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-restricted-properties',
    targets: [
      {
        group: 'nursery',
        rule: 'noJsRestrictedProperties',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-return-assign',
    targets: [
      {
        group: 'suspicious',
        rule: 'noReturnAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-script-url',
    targets: [
      {
        group: 'security',
        rule: 'noScriptUrl',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-self-assign',
    targets: [
      {
        group: 'correctness',
        rule: 'noSelfAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-self-compare',
    targets: [
      {
        group: 'suspicious',
        rule: 'noSelfCompare',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-sequences',
    targets: [
      {
        group: 'complexity',
        rule: 'noCommaOperator',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-setter-return',
    targets: [
      {
        group: 'correctness',
        rule: 'noSetterReturn',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-shadow',
    targets: [
      {
        group: 'suspicious',
        rule: 'noShadow',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-shadow-restricted-names',
    targets: [
      {
        group: 'suspicious',
        rule: 'noShadowRestrictedNames',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-sparse-arrays',
    targets: [
      {
        group: 'suspicious',
        rule: 'noSparseArray',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-template-curly-in-string',
    targets: [
      {
        group: 'suspicious',
        rule: 'noTemplateCurlyInString',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-ternary',
    targets: [
      {
        group: 'style',
        rule: 'noTernary',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-this-before-super',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnreachableSuper',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-throw-literal',
    targets: [
      {
        group: 'style',
        rule: 'useThrowOnlyError',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-unassigned-vars',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnassignedVariables',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-undef',
    targets: [
      {
        group: 'correctness',
        rule: 'noUndeclaredVariables',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-undef-init',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessUndefinedInitialization',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unmodified-loop-condition',
    targets: [
      {
        group: 'nursery',
        rule: 'noUnmodifiedLoopCondition',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-unneeded-ternary',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessTernary',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unreachable',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnreachable',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unsafe-finally',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnsafeFinally',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unsafe-negation',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnsafeNegation',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unsafe-optional-chaining',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnsafeOptionalChaining',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unused-expressions',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnusedExpressions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unused-labels',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnusedLabels',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unused-private-class-members',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnusedPrivateClassMembers',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-unused-vars',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnusedVariables',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-use-before-define',
    targets: [
      {
        group: 'correctness',
        rule: 'noInvalidUseBeforeDeclaration',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-backreference',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUselessRegexBackrefs',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-catch',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessCatch',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-computed-key',
    targets: [
      {
        group: 'complexity',
        rule: 'useLiteralKeys',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-concat',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessStringConcat',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-constructor',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessConstructor',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-escape',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessEscapeInRegex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-rename',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessRename',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-return',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessReturn',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-var',
    targets: [
      {
        group: 'suspicious',
        rule: 'noVar',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-void',
    targets: [
      {
        group: 'complexity',
        rule: 'noVoid',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-with',
    targets: [
      {
        group: 'suspicious',
        rule: 'noWith',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'object-shorthand',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentObjectDefinitions',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'one-var',
    targets: [
      {
        group: 'style',
        rule: 'useSingleVarDeclarator',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'operator-assignment',
    targets: [
      {
        group: 'style',
        rule: 'useShorthandAssign',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-arrow-callback',
    targets: [
      {
        group: 'complexity',
        rule: 'useArrowFunction',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'prefer-const',
    targets: [
      {
        group: 'style',
        rule: 'useConst',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-destructuring',
    targets: [
      {
        group: 'style',
        rule: 'useDestructuring',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'prefer-exponentiation-operator',
    targets: [
      {
        group: 'style',
        rule: 'useExponentiationOperator',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-named-capture-group',
    targets: [
      {
        group: 'nursery',
        rule: 'useNamedCaptureGroup',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-numeric-literals',
    targets: [
      {
        group: 'complexity',
        rule: 'useNumericLiterals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-object-has-own',
    targets: [
      {
        group: 'suspicious',
        rule: 'noPrototypeBuiltins',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-object-spread',
    targets: [
      {
        group: 'style',
        rule: 'useObjectSpread',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-regex-literals',
    targets: [
      {
        group: 'complexity',
        rule: 'useRegexLiterals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-rest-params',
    targets: [
      {
        group: 'complexity',
        rule: 'noArguments',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-spread',
    targets: [
      {
        group: 'style',
        rule: 'useSpreadOverApply',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-template',
    targets: [
      {
        group: 'style',
        rule: 'useTemplate',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'preserve-caught-error',
    targets: [
      {
        group: 'style',
        rule: 'useErrorCause',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'radix',
    targets: [
      {
        group: 'correctness',
        rule: 'useParseIntRadix',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'require-await',
    targets: [
      {
        group: 'suspicious',
        rule: 'useAwait',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'require-unicode-regexp',
    targets: [
      {
        group: 'nursery',
        rule: 'useUnicodeRegex',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'require-yield',
    targets: [
      {
        group: 'correctness',
        rule: 'useYield',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'symbol-description',
    targets: [
      {
        group: 'style',
        rule: 'useSymbolDescription',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'use-isnan',
    targets: [
      {
        group: 'correctness',
        rule: 'useIsNan',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'valid-typeof',
    targets: [
      {
        group: 'correctness',
        rule: 'useValidTypeof',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'vars-on-top',
    targets: [
      {
        group: 'nursery',
        rule: 'useVarsOnTop',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'yoda',
    targets: [
      {
        group: 'style',
        rule: 'noYodaExpression',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'adjacent-overload-signatures',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'useAdjacentOverloadSignatures',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'array-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentArrayType',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'ban-ts-comment',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noTsIgnore',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'ban-types',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noBannedTypes',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'consistent-type-definitions',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentTypeDefinitions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'consistent-type-exports',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useExportType',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'consistent-type-imports',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useImportType',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'default-param-last',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useDefaultParameterLast',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'dot-notation',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'useLiteralKeys',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'explicit-function-return-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useExplicitReturnType',
      },
      {
        group: 'nursery',
        rule: 'useExplicitType',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'explicit-member-accessibility',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentMemberAccessibility',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'explicit-module-boundary-types',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useExplicitType',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'max-params',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'useMaxParams',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'method-signature-style',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentMethodSignatures',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'naming-convention',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useNamingConvention',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-array-constructor',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useArrayLiterals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-base-to-string',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noBaseToString',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-deprecated',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDeprecatedImports',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-dupe-class-members',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateClassMembers',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-duplicate-enum-values',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateEnumValues',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-function',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptyBlockStatements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-interface',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptyInterface',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-empty-object-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noBannedTypes',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-explicit-any',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noExplicitAny',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-extra-non-null-assertion',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noExtraNonNullAssertion',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-extraneous-class',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noStaticOnlyClass',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-floating-promises',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noFloatingPromises',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-for-in-array',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noForIn',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-implied-eval',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noImpliedEval',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-inferrable-types',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noInferrableTypes',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-invalid-void-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noConfusingVoidType',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-loop-func',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noLoopFunc',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-loss-of-precision',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'correctness',
        rule: 'noPrecisionLoss',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-magic-numbers',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noMagicNumbers',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-misused-new',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noMisleadingInstantiator',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-misused-promises',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noMisusedPromises',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-mixed-enums',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentEnumValueType',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-namespace',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noNamespace',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-non-null-asserted-optional-chain',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noNonNullAssertedOptionalChain',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-non-null-assertion',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noNonNullAssertion',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-redeclare',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noRedeclare',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-require-imports',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noCommonJs',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-restricted-imports',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noRestrictedImports',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-restricted-types',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noRestrictedTypes',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-shadow',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noShadow',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-this-alias',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessThisAlias',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-unnecessary-condition',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnnecessaryConditions',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-unnecessary-template-expression',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noUnnecessaryTemplateExpression',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'no-unnecessary-type-constraint',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessTypeConstraint',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unnecessary-type-conversion',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noUselessTypeConversion',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-unsafe-declaration-merging',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnsafeDeclarationMerging',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-unsafe-function-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noBannedTypes',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-unused-vars',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnusedVariables',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-use-before-define',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'correctness',
        rule: 'noInvalidUseBeforeDeclaration',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-constructor',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessConstructor',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-empty-export',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessEmptyExport',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-var-requires',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noCommonJs',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-wrapper-object-types',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'noBannedTypes',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'only-throw-error',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useThrowOnlyError',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'parameter-properties',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'noParameterProperties',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'prefer-as-const',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useAsConstAssertion',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-enum-initializers',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useEnumInitializers',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-find',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'useArrayFind',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-for-of',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useForOf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-function-type',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useShorthandFunctionType',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-includes',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useIncludes',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-literal-enum-member',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useLiteralEnumMembers',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-namespace-keyword',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'useNamespaceKeyword',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-nullish-coalescing',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useNullishCoalescing',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-optional-chain',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'complexity',
        rule: 'useOptionalChain',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-readonly',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useReadonlyClassProperties',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-reduce-type-parameter',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useReduceTypeParameter',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-regexp-exec',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useRegexpExec',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-string-starts-ends-with',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useStringStartsEndsWith',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'require-array-sort-compare',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'useArraySortCompare',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'require-await',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'suspicious',
        rule: 'useAwait',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'restrict-plus-operands',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'noUnsafePlusOperands',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'switch-exhaustiveness-check',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useExhaustiveSwitchCases',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'unified-signatures',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'style',
        rule: 'useUnifiedTypeSignatures',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'use-await-thenable',
    plugin: '@typescript-eslint',
    targets: [
      {
        group: 'nursery',
        rule: 'useAwaitThenable',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'enforce-node-protocol-usage',
    plugin: 'import',
    targets: [
      {
        group: 'style',
        rule: 'useNodejsImportProtocol',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'exports-last',
    plugin: 'import',
    targets: [
      {
        group: 'style',
        rule: 'useExportsLast',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'first',
    plugin: 'import',
    targets: [
      {
        group: 'nursery',
        rule: 'useImportsFirst',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'named',
    plugin: 'import',
    targets: [
      {
        group: 'correctness',
        rule: 'noUnresolvedImports',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-commonjs',
    plugin: 'import',
    targets: [
      {
        group: 'style',
        rule: 'noCommonJs',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-cycle',
    plugin: 'import',
    targets: [
      {
        group: 'suspicious',
        rule: 'noImportCycles',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-default-export',
    plugin: 'import',
    targets: [
      {
        group: 'style',
        rule: 'noDefaultExport',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-deprecated',
    plugin: 'import',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDeprecatedImports',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-extraneous-dependencies',
    plugin: 'import',
    targets: [
      {
        group: 'correctness',
        rule: 'noUndeclaredDependencies',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-nodejs-modules',
    plugin: 'import',
    targets: [
      {
        group: 'correctness',
        rule: 'noNodejsModules',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'alt-text',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useAltText',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'anchor-ambiguous-text',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noAmbiguousAnchorText',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'anchor-has-content',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useAnchorContent',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'anchor-is-valid',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidAnchor',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'aria-activedescendant-has-tabindex',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useAriaActivedescendantWithTabindex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'aria-props',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidAriaProps',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'aria-proptypes',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidAriaValues',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'aria-role',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidAriaRole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'aria-unsupported-elements',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noAriaUnsupportedElements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'autocomplete-valid',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidAutocomplete',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'click-events-have-key-events',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useKeyWithClickEvents',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'control-has-associated-label',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'nursery',
        rule: 'useControlLabel',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'heading-has-content',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useHeadingContent',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'html-has-lang',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useHtmlLang',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'iframe-has-title',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useIframeTitle',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'img-redundant-alt',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noRedundantAlt',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'interactive-supports-focus',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useFocusableInteractive',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'label-has-associated-control',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noLabelWithoutControl',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'lang',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useValidLang',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'media-has-caption',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useMediaCaption',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'mouse-events-have-key-events',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useKeyWithMouseEvents',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-access-key',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noAccessKey',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-aria-hidden-on-focusable',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noAriaHiddenOnFocusable',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-autofocus',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noAutofocus',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-distracting-elements',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noDistractingElements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-interactive-element-to-noninteractive-role',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noInteractiveElementToNoninteractiveRole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-noninteractive-element-interactions',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noNoninteractiveElementInteractions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-noninteractive-element-to-interactive-role',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noNoninteractiveElementToInteractiveRole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-noninteractive-tabindex',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noNoninteractiveTabindex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-redundant-roles',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noRedundantRoles',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-static-element-interactions',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noStaticElementInteractions',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-tag-over-role',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useSemanticElements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'role-has-required-aria-props',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useAriaPropsForRole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'role-supports-aria-props',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'useAriaPropsSupportedByRole',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'scope',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noHeaderScope',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'tabindex-no-positive',
    plugin: 'jsx-a11y',
    targets: [
      {
        group: 'a11y',
        rule: 'noPositiveTabindex',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'async-server-action',
    plugin: 'react',
    targets: [
      {
        group: 'nursery',
        rule: 'useReactAsyncServerFunction',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'button-has-type',
    plugin: 'react',
    targets: [
      {
        group: 'a11y',
        rule: 'useButtonType',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'forbid-elements',
    plugin: 'react',
    targets: [
      {
        group: 'correctness',
        rule: 'noRestrictedElements',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'function-component-definition',
    plugin: 'react',
    targets: [
      {
        group: 'nursery',
        rule: 'useReactFunctionComponentDefinition',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'jsx-boolean-value',
    plugin: 'react',
    targets: [
      {
        group: 'style',
        rule: 'noImplicitBoolean',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'jsx-curly-brace-presence',
    plugin: 'react',
    targets: [
      {
        group: 'style',
        rule: 'useConsistentCurlyBraces',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'jsx-fragments',
    plugin: 'react',
    targets: [
      {
        group: 'style',
        rule: 'useFragmentSyntax',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-key',
    plugin: 'react',
    targets: [
      {
        group: 'correctness',
        rule: 'useJsxKeyInIterable',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-no-bind',
    plugin: 'react',
    targets: [
      {
        group: 'performance',
        rule: 'noJsxPropsBind',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'jsx-no-comment-textnodes',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noCommentText',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-no-duplicate-props',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicateJsxProps',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-no-leaked-render',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noLeakedRender',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'jsx-no-literals',
    plugin: 'react',
    targets: [
      {
        group: 'style',
        rule: 'noJsxLiterals',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-no-script-url',
    plugin: 'react',
    targets: [
      {
        group: 'security',
        rule: 'noScriptUrl',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-no-target-blank',
    plugin: 'react',
    targets: [
      {
        group: 'security',
        rule: 'noBlankTarget',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'jsx-no-useless-fragment',
    plugin: 'react',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessFragments',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'jsx-props-no-spread-multi',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDuplicatedSpreadProps',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-array-index-key',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noArrayIndexKey',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-children-prop',
    plugin: 'react',
    targets: [
      {
        group: 'correctness',
        rule: 'noChildrenProp',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-danger',
    plugin: 'react',
    targets: [
      {
        group: 'security',
        rule: 'noDangerouslySetInnerHtml',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-danger-with-children',
    plugin: 'react',
    targets: [
      {
        group: 'security',
        rule: 'noDangerouslySetInnerHtmlWithChildren',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-string-refs',
    plugin: 'react',
    targets: [
      {
        group: 'nursery',
        rule: 'noReactStringRefs',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-unknown-property',
    plugin: 'react',
    targets: [
      {
        group: 'suspicious',
        rule: 'noUnknownAttribute',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'void-dom-elements-no-children',
    plugin: 'react',
    targets: [
      {
        group: 'correctness',
        rule: 'noVoidElementsWithChildren',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'component-hook-factories',
    plugin: 'react-hooks',
    targets: [
      {
        group: 'nursery',
        rule: 'noComponentHookFactories',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'exhaustive-deps',
    plugin: 'react-hooks',
    targets: [
      {
        group: 'correctness',
        rule: 'useExhaustiveDependencies',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'react-compiler',
    plugin: 'react-hooks',
    targets: [
      {
        group: 'correctness',
        rule: 'noReactPropAssignments',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'rules-of-hooks',
    plugin: 'react-hooks',
    targets: [
      {
        group: 'correctness',
        rule: 'useHookAtTopLevel',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'better-dom-traversing',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useBetterDomTraversing',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'error-message',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'useErrorMessage',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'explicit-length-check',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useExplicitLengthCheck',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'filename-case',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useFilenamingConvention',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'new-for-builtins',
    plugin: 'unicorn',
    targets: [
      {
        group: 'correctness',
        rule: 'noInvalidBuiltinInstantiation',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-array-for-each',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'noForEach',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-document-cookie',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'noDocumentCookie',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-empty-file',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'noEmptySource',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-for-loop',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useForOf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-instanceof-array',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'useIsArray',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-invalid-file-input-accept',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'noInvalidFileInputAccept',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-lonely-if',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useCollapsedIf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-negation-in-equality-check',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'noNegationInEqualityCheck',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-nested-ternary',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'noNestedTernary',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'no-static-only-class',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'noStaticOnlyClass',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-thenable',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'noThenProperty',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-this-outside-of-class',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'noThisOutsideOfClass',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'no-useless-switch-case',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessSwitchCase',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-useless-undefined',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'noUselessUndefined',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'no-xor-as-exponentiation',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'noXorAsExponentiation',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'numeric-separators-style',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useNumericSeparators',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-array-flat-map',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'useFlatMap',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-array-index-of',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'useIndexOf',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-array-some',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useArraySome',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-at',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useAtIndex',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'prefer-date-now',
    plugin: 'unicorn',
    targets: [
      {
        group: 'complexity',
        rule: 'useDateNow',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-dom-node-text-content',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useDomNodeTextContent',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-flat-math-min-max',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useFlatMathMinMax',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-global-this',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useGlobalThis',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-includes',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useIncludes',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-math-min-max',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useMathMinMax',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-modern-math-apis',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useModernMathApis',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-module',
    plugin: 'unicorn',
    targets: [
      {
        group: 'correctness',
        rule: 'noGlobalDirnameFilename',
      },
    ],
    nursery: false,
    inspired: true,
  },
  {
    eslint: 'prefer-node-protocol',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useNodejsImportProtocol',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-number-properties',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useNumberNamespace',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-query-selector',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useDomQuerySelector',
      },
    ],
    nursery: true,
    inspired: true,
  },
  {
    eslint: 'prefer-regexp-test',
    plugin: 'unicorn',
    targets: [
      {
        group: 'nursery',
        rule: 'useRegexpTest',
      },
    ],
    nursery: true,
    inspired: false,
  },
  {
    eslint: 'prefer-string-slice',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'noSubstr',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'prefer-string-trim-start-end',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useTrimStartEnd',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'require-number-to-fixed-digits-argument',
    plugin: 'unicorn',
    targets: [
      {
        group: 'suspicious',
        rule: 'useNumberToFixedDigitsArgument',
      },
    ],
    nursery: false,
    inspired: false,
  },
  {
    eslint: 'throw-new-error',
    plugin: 'unicorn',
    targets: [
      {
        group: 'style',
        rule: 'useThrowNewError',
      },
    ],
    nursery: false,
    inspired: false,
  },
] as const;

export const BIOME_UNSUPPORTED_RULES: Readonly<{ eslint: string; plugin?: string; reason: string; detail?: string }[]> =
  [
    {
      eslint: 'array-bracket-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'array-element-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'arrow-parens',
      reason: 'formatter-option',
      detail: 'arrowParentheses',
    },
    {
      eslint: 'arrow-spacing',
      reason: 'stylistic',
    },
    {
      eslint: 'block-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'brace-style',
      reason: 'stylistic',
    },
    {
      eslint: 'capitalized-comments',
      reason: 'stylistic',
    },
    {
      eslint: 'comma-dangle',
      reason: 'stylistic',
    },
    {
      eslint: 'comma-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'comma-style',
      reason: 'stylistic',
    },
    {
      eslint: 'dot-location',
      reason: 'stylistic',
    },
    {
      eslint: 'eol-last',
      reason: 'formatter-covers',
    },
    {
      eslint: 'func-call-spacing',
      reason: 'stylistic',
    },
    {
      eslint: 'function-call-argument-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'function-paren-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'generator-star',
      reason: 'formatter-covers',
    },
    {
      eslint: 'generator-star-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'implicit-arrow-linebreak',
      reason: 'stylistic',
    },
    {
      eslint: 'indent',
      reason: 'formatter-option',
      detail: 'indentWidth',
    },
    {
      eslint: 'indent-legacy',
      reason: 'formatter-option',
      detail: 'indentWidth',
    },
    {
      eslint: 'jsx-quotes',
      reason: 'formatter-option',
      detail: 'jsxQuoteStyle',
    },
    {
      eslint: 'key-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'keyword-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'line-comment-position',
      reason: 'stylistic',
    },
    {
      eslint: 'linebreak-style',
      reason: 'formatter-option',
      detail: 'lineEnding',
    },
    {
      eslint: 'lines-around-comment',
      reason: 'stylistic',
    },
    {
      eslint: 'lines-around-directive',
      reason: 'stylistic',
    },
    {
      eslint: 'lines-between-class-members',
      reason: 'stylistic',
    },
    {
      eslint: 'max-len',
      reason: 'formatter-option',
      detail: 'lineWidth',
    },
    {
      eslint: 'max-statements-per-line',
      reason: 'formatter-covers',
    },
    {
      eslint: 'multiline-comment-style',
      reason: 'stylistic',
    },
    {
      eslint: 'multiline-ternary',
      reason: 'stylistic',
    },
    {
      eslint: 'new-parens',
      reason: 'formatter-covers',
    },
    {
      eslint: 'newline-after-var',
      reason: 'stylistic',
    },
    {
      eslint: 'newline-before-return',
      reason: 'stylistic',
    },
    {
      eslint: 'newline-per-chained-call',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-confusing-arrow',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-extra-parens',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-extra-semi',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-floating-decimal',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-mixed-operators',
      reason: 'stylistic',
    },
    {
      eslint: 'no-multi-spaces',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-multiple-empty-lines',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-space-before-semi',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-spaced-func',
      reason: 'stylistic',
    },
    {
      eslint: 'no-tabs',
      reason: 'formatter-option',
      detail: 'indentStyle',
    },
    {
      eslint: 'no-trailing-spaces',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-whitespace-before-property',
      reason: 'stylistic',
    },
    {
      eslint: 'nonblock-statement-body-position',
      reason: 'stylistic',
    },
    {
      eslint: 'object-curly-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'object-curly-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'object-property-newline',
      reason: 'formatter-covers',
    },
    {
      eslint: 'one-var-declaration-per-line',
      reason: 'stylistic',
    },
    {
      eslint: 'padded-blocks',
      reason: 'stylistic',
    },
    {
      eslint: 'padding-line-between-statements',
      reason: 'stylistic',
    },
    {
      eslint: 'quote-props',
      reason: 'stylistic',
    },
    {
      eslint: 'quotes',
      reason: 'formatter-option',
      detail: 'quoteStyle',
    },
    {
      eslint: 'rest-spread-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'semi',
      reason: 'formatter-option',
      detail: 'semicolons',
    },
    {
      eslint: 'semi-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'semi-style',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-after-function-name',
      reason: 'stylistic',
    },
    {
      eslint: 'space-after-keywords',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-before-blocks',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-before-function-paren',
      reason: 'stylistic',
    },
    {
      eslint: 'space-before-function-parentheses',
      reason: 'stylistic',
    },
    {
      eslint: 'space-before-keywords',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-infix-ops',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-return-throw-case',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-unary-ops',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-unary-word-ops',
      reason: 'formatter-covers',
    },
    {
      eslint: 'spaced-comment',
      reason: 'stylistic',
    },
    {
      eslint: 'switch-colon-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'template-tag-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'wrap-iife',
      reason: 'stylistic',
    },
    {
      eslint: 'wrap-regex',
      reason: 'stylistic',
    },
    {
      eslint: 'yield-star-spacing',
      reason: 'formatter-covers',
    },
    {
      eslint: 'brace-style',
      plugin: '@typescript-eslint',
      reason: 'stylistic',
    },
    {
      eslint: 'comma-dangle',
      plugin: '@typescript-eslint',
      reason: 'stylistic',
    },
    {
      eslint: 'comma-spacing',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'func-call-spacing',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'indent',
      plugin: '@typescript-eslint',
      reason: 'formatter-option',
      detail: 'indentWidth',
    },
    {
      eslint: 'keyword-spacing',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-extra-parens',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'no-extra-semi',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'object-curly-spacing',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'quotes',
      plugin: '@typescript-eslint',
      reason: 'formatter-option',
      detail: 'quoteStyle',
    },
    {
      eslint: 'semi',
      plugin: '@typescript-eslint',
      reason: 'formatter-option',
      detail: 'semicolons',
    },
    {
      eslint: 'space-before-blocks',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'space-before-function-paren',
      plugin: '@typescript-eslint',
      reason: 'stylistic',
    },
    {
      eslint: 'space-infix-ops',
      plugin: '@typescript-eslint',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-child-element-spacing',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-closing-bracket-location',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-closing-tag-location',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-curly-newline',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-equals-spacing',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-first-prop-new-line',
      plugin: 'react',
      reason: 'stylistic',
    },
    {
      eslint: 'jsx-indent',
      plugin: 'react',
      reason: 'formatter-option',
      detail: 'indentStyle',
    },
    {
      eslint: 'jsx-indent-props',
      plugin: 'react',
      reason: 'stylistic',
    },
    {
      eslint: 'jsx-max-props-per-line',
      plugin: 'react',
      reason: 'stylistic',
    },
    {
      eslint: 'jsx-newline',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-one-expression-per-line',
      plugin: 'react',
      reason: 'stylistic',
    },
    {
      eslint: 'jsx-props-no-multi-spaces',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-space-before-closing',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-tag-spacing',
      plugin: 'react',
      reason: 'formatter-covers',
    },
    {
      eslint: 'jsx-wrap-multilines',
      plugin: 'react',
      reason: 'stylistic',
    },
    {
      eslint: 'empty-brace-spaces',
      plugin: 'unicorn',
      reason: 'formatter-covers',
    },
  ] as const;
