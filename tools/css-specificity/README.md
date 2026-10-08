# CSS Specificity Calculator

Score a selector and explain which parts contribute.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste one or more CSS selectors (one selector list per line) and see each selector's Selectors Level 4 specificity as three numbers, exactly which of its own parts contribute to that score, and every selector ordered from strongest to weakest. A hand-written parser tokenizes the selector list itself, including :is(), :not(), :has(), :where() and nth-child()/nth-last-child() with an of clause, and is cross-checked against an independent parser (css-tree) over 500 seeded random selectors.

## Supported

- Type selectors, the universal selector, and both forms with an optional namespace prefix (ns|div, *|div, |div, ns|*)
- #id and .class selectors
- Attribute selectors with every operator (=, ~=, |=, ^=, $=, *=) and the i/s case-sensitivity flag
- Pseudo-classes and pseudo-elements, including the legacy single-colon forms of :before, :after, :first-line and :first-letter
- :is(), :not(), :has() and :where(), each recursively parsed as a nested selector list, and :nth-child()/:nth-last-child() with an of <selector-list> clause
- Combinators: descendant (whitespace), >, +, ~ and the column combinator ||
- CSS escapes (a backslash plus up to six hex digits, or a backslash plus one literal character) inside identifiers and strings
- A comma-separated selector list on each line, and multiple independent lines in one paste

## Limits

- This tool scores syntax, not browser support: it does not check whether a visitor's browser actually implements a given pseudo-class or pseudo-element
- Specificity is only one step of the cascade: CSS Cascading and Inheritance Level 5 sorts declarations first by origin and importance, then by encapsulation context, then by whether a declaration is attached directly to an element, then by cascade layer, then by specificity, and only then by order of appearance -- so the highest specificity does not always win
- CSS Nesting's & selector, shadow-tree pseudo-elements (::slotted(), ::part()) and the shadow-host pseudo-classes (:host(), :host-context()) are refused by name rather than scored, since this tool has no notion of an outer rule or a shadow tree to resolve them against
- !important and a selector's own inline style attribute are outside a selector and are not considered here (see CSS Style Attributes for the inline-style specificity rule)
- Selector text is capped at 100,000 characters and nesting inside :is()/:not()/:has()/:where()/an of clause at 32 levels; either limit refuses the input outright rather than risk freezing the tab

## Ambiguous cases, and what this does about them

- The pseudo-class argument list of a pseudo-class this tool does not need to look inside (for example :lang(en) or :nth-of-type(2)) is skipped as balanced, unparsed text rather than validated against that pseudo-class's own grammar, since only :is(), :not(), :has(), :where(), :nth-child() and :nth-last-child() affect specificity

## Defined by

- [Selectors Level 4 (Calculating a selector's specificity)](https://www.w3.org/TR/selectors-4/#specificity-rules)
- [CSS Cascading and Inheritance Level 5 (Cascade Sorting Order)](https://www.w3.org/TR/css-cascade-5/#cascade-sort)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-specificity css-specificity
cd css-specificity
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-specificity
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { computeSpecificity, compareSpecificity } from '@fodt/css-specificity';

const report = computeSpecificity('#s12:not(FOO)\n.foo :is(.bar, #baz)');
report.selectors[0].specificity; // [1, 0, 1] -- whichever line scored higher sorts first
compareSpecificity([1, 0, 0], [0, 1, 0]); // > 0, since a=1 beats a=0
```

`computeSpecificity` throws `CssSpecificityError` (with `line` and `column`) on the first selector it cannot parse, or when the whole input is over the length limit; it never returns a partial result mixed with an error. `parseSelectorList` and `SelectorSyntaxError` are re-exported from the tokenizer for anything that wants the parsed tree directly rather than just the specificity numbers.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every specificity rule this tool asserts is quoted from Selectors Level 4's own 'Calculating a selector's specificity' section (https://www.w3.org/TR/selectors-4/#specificity-rules), fetched when these tests were written, including its own example table and its four worked :is()/:where()/:nth-child()/:not() examples. The cascade's own sort order, used only for this tool's own 'limits' caveat, is quoted from CSS Cascading and Inheritance Level 5's 'Cascade Sorting Order' section (https://www.w3.org/TR/css-cascade-5/#cascade-sort), fetched when these tests were written. The independent cross-check parses the same 500 seeded selectors with the installed css-tree 3.2.1 parser (context: 'selectorList') and walks its own AST (TypeSelector, IdSelector, ClassSelector, AttributeSelector, PseudoClassSelector, PseudoElementSelector, and the Nth node's own 'selector' field for an of clause) with a second, independently written specificity calculator, confirmed directly against css-tree's installed AST shape before the differential test was written.

## Licence

MIT. See [LICENSE](./LICENSE).
