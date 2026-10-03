// Written by make-published-cases.mjs on 2026-10-03. Do not edit by hand.
// Sass cases: https://github.com/sass/sass-spec at commit 49bf57edf18c4938599b3afd53dd826ee2f4e0e6 (MIT licence).
// Less cases: https://github.com/less/less.js at commit 713331655e437401dfea6cd233893a69762734e1 (Apache-2.0 licence).

export interface SassCase {
  /** The upstream path, with the case directory inside the archive file. */
  path: string;
  syntax: 'scss' | 'sass';
  source: string;
  /** The published output, without its trailing newline. */
  expected: string;
}

export interface LessCase {
  /** The upstream path of the input; the published output sits beside it with the extension .css. */
  path: string;
  source: string;
  /** The published output with line ends normalised and the ends trimmed. */
  expected: string;
}

export const SASS_SPEC_COMMIT = '49bf57edf18c4938599b3afd53dd826ee2f4e0e6';
export const LESS_COMMIT = '713331655e437401dfea6cd233893a69762734e1';

export const SASS_CASES: SassCase[] = [
  {
    "path": "spec/directives/for/for.hrx (inclusive_forward/scss)",
    "syntax": "scss",
    "source": "a {\n  @for $i from 1 through 5 {b: $i;}\n}\n",
    "expected": "a {\n  b: 1;\n  b: 2;\n  b: 3;\n  b: 4;\n  b: 5;\n}"
  },
  {
    "path": "spec/directives/for/for.hrx (inclusive_forward/sass)",
    "syntax": "sass",
    "source": "a\n  @for $i from 1 through 5\n    b: $i\n",
    "expected": "a {\n  b: 1;\n  b: 2;\n  b: 3;\n  b: 4;\n  b: 5;\n}"
  },
  {
    "path": "spec/directives/for/for.hrx (inclusive_backward)",
    "syntax": "scss",
    "source": "a {\n  @for $i from 5 through 1 {b: $i;}\n}\n",
    "expected": "a {\n  b: 5;\n  b: 4;\n  b: 3;\n  b: 2;\n  b: 1;\n}"
  },
  {
    "path": "spec/variables/semi_global.hrx (in_local/double_nested)",
    "syntax": "scss",
    "source": "// Regression test for sass/dart-sass#1250\n$a: global;\nb {\n  @if true {\n    @if true {\n      $a: local;\n    }\n  }\n}\n\nc {d: $a}\n",
    "expected": "c {\n  d: global;\n}"
  },
  {
    "path": "spec/directives/extend/pseudo.hrx (into_pseudo/extends_after)",
    "syntax": "scss",
    "source": "// Regression test for sass/dart-sass#1297, where the root cause was that\n// extending an existing extension accidentally ignored simple selectors in\n// selector pseudos\n:is(midstream) {@extend upstream}\n\ndownstream {@extend midstream}\n\nupstream {a: b}\n",
    "expected": "upstream, :is(midstream), :is(midstream, downstream) {\n  a: b;\n}"
  },
  {
    "path": "spec/non_conformant/scss/while_directive.hrx (whole file)",
    "syntax": "scss",
    "source": "$i: 1;\n\n.foo {\n  @while $i != 5 {\n    a: $i;\n    $i: $i + 1;\n  }\n}\n",
    "expected": ".foo {\n  a: 1;\n  a: 2;\n  a: 3;\n  a: 4;\n}"
  },
  {
    "path": "spec/directives/if/sass.hrx (if)",
    "syntax": "sass",
    "source": "$b: true\na\n  @if $b\n    value: 1\n",
    "expected": "a {\n  value: 1;\n}"
  },
  {
    "path": "spec/directives/each.hrx (sass/inline)",
    "syntax": "sass",
    "source": "@each $a in b, c\n  .#{$a}\n    d: $a\n",
    "expected": ".b {\n  d: b;\n}\n\n.c {\n  d: c;\n}"
  }
];

export const LESS_CASES: LessCase[] = [
  {
    "path": "packages/test-data/tests-unit/operations/operations.less",
    "source": "// Mathematical operations tests\n#operations {\n  color: (#110000 + #000011 + #001100); // #111111\n  color-2: (yellow - #070707);\n  height: (10px / 2px + 6px - 1px * 2); // 9px\n  width: (2 * 4 - 5em); // 3em\n  .spacing {\n    height: (10px / 2px+6px-1px*2);\n    width: (2  * 4-5em);\n  }\n  subtraction: (20 - 10 - 5 - 5); // 0\n  division: (20 / 5 / 4); // 1\n}\n\n@x: 4;\n@y: 12em;\n\n.with-variables {\n  height: (@x + @y); // 16em\n  width: (12 + @y); // 24em\n  size: (5cm - @x); // 1cm\n}\n\n.with-functions {\n  color: (rgb(200, 200, 200) / 2);\n  color: (2 * hsl(0, 50%, 50%));\n  color: (rgb(10, 10, 10) + hsl(0, 50%, 50%));\n}\n\n@z: -2;\n\n.negative {\n  height: (2px + @z); // 0px\n  width: (2px - @z); // 4px\n}\n\n.shorthands {\n  padding: -1px 2px 0 -4px; //\n}\n\n.rem-dimensions {\n  font-size: (20rem / 5 + 1.5rem); // 5.5rem\n}\n\n.colors {\n  color: #123; // #112233\n  border-color: (#234 + #111111); // #334455\n  background-color: (#222222 - #fff); // #000000\n  .other {\n    color: (2 * #111); // #222222\n    border-color: (#333333 / 3 + #111); // #222222\n  }\n}\n\n.negations {\n    @var: 4px;\n    variable: (-@var); // 4\n    variable1: (-@var + @var); // 0\n    variable2: (@var + -@var); // 0\n    variable3: (@var - -@var); // 8\n    variable4: (-@var - -@var); // 0\n    paren: (-(@var)); // -4px\n    paren2: (-(2 + 2) * -@var); // 16\n}\n",
    "expected": "#operations {\n  color: #111111;\n  color-2: #f8f800;\n  height: 9px;\n  width: 3em;\n  subtraction: 0;\n  division: 1;\n}\n#operations .spacing {\n  height: 9px;\n  width: 3em;\n}\n.with-variables {\n  height: 16em;\n  width: 24em;\n  size: 1cm;\n}\n.with-functions {\n  color: #646464;\n  color: #ff8080;\n  color: #c94a4a;\n}\n.negative {\n  height: 0px;\n  width: 4px;\n}\n.shorthands {\n  padding: -1px 2px 0 -4px;\n}\n.rem-dimensions {\n  font-size: 5.5rem;\n}\n.colors {\n  color: #123;\n  border-color: #334455;\n  background-color: #000000;\n}\n.colors .other {\n  color: #222222;\n  border-color: #222222;\n}\n.negations {\n  variable: -4px;\n  variable1: 0px;\n  variable2: 0px;\n  variable3: 8px;\n  variable4: 0px;\n  paren: -4px;\n  paren2: 16px;\n}"
  },
  {
    "path": "packages/test-data/tests-unit/scope/scope.less",
    "source": "@x: red;\n@x: blue;\n@z: transparent;\n@mix: none;\n\n.mixin {\n  @mix: #989;\n}\n@mix: blue;\n.tiny-scope {\n  color: @mix; // #989\n  .mixin();\n}\n\n.scope1 {\n  @y: orange;\n  @z: black;\n  color: @x; // blue\n  border-color: @z; // black\n  .hidden {\n    @x: #131313;\n  }\n  .scope2 {\n    @y: red;\n    color: @x; // blue\n    .scope3 {\n      @local: white;\n      color: @y; // red\n      border-color: @z; // black\n      background-color: @local; // white\n    }\n  }\n}\n\n#namespace {\n  .scoped_mixin() {\n    @local-will-be-made-global: green;\n    .scope {\n      scoped-val: @local-will-be-made-global;\n    }\n  }\n}\n\n#namespace > .scoped_mixin();\n\n.setHeight(@h) { @height: 1024px; }\n.useHeightInMixinCall(@h) { .useHeightInMixinCall { mixin-height: @h; } }\n@mainHeight: 50%;\n.setHeight(@mainHeight);\n.heightIsSet { height: @height; }\n.useHeightInMixinCall(@height);\n\n.importRuleset() {\n  .imported {\n    exists: true;\n  }\n}\n.importRuleset();\n.testImported {\n  .imported();\n}\n\n@parameterDefault: 'top level';\n@anotherVariable: 'top level';\n//mixin uses top-level variables\n.mixinNoParam(@parameter: @parameterDefault) when (@parameter = 'top level') {\n  default: @parameter;\n  scope: @anotherVariable;\n  sub-scope-only: @subScopeOnly;\n}\n\n#allAreUsedHere {\n  //redefine top-level variables in different scope\n  @parameterDefault: 'inside';\n  @anotherVariable: 'inside';\n  @subScopeOnly: 'inside';\n  //use the mixin\n  .mixinNoParam();\n}\n#parentSelectorScope {\n  @col: white;\n  & {\n    @col: black;\n  }\n  prop: @col;\n  & {\n    @col: black;\n  }\n}\n.test-empty-mixin() {\n}\n#parentSelectorScopeMixins {\n  & {\n    .test-empty-mixin() {\n      should: never seee 1;\n    }\n  }\n  .test-empty-mixin();\n  & {\n    .test-empty-mixin() {\n      should: never seee 2;\n    }\n  }\n}\n",
    "expected": ".tiny-scope {\n  color: #989;\n}\n.scope1 {\n  color: blue;\n  border-color: black;\n}\n.scope1 .scope2 {\n  color: blue;\n}\n.scope1 .scope2 .scope3 {\n  color: red;\n  border-color: black;\n  background-color: white;\n}\n.scope {\n  scoped-val: green;\n}\n.heightIsSet {\n  height: 1024px;\n}\n.useHeightInMixinCall {\n  mixin-height: 1024px;\n}\n.imported {\n  exists: true;\n}\n.testImported {\n  exists: true;\n}\n#allAreUsedHere {\n  default: 'top level';\n  scope: 'top level';\n  sub-scope-only: 'inside';\n}\n#parentSelectorScope {\n  prop: white;\n}"
  },
  {
    "path": "packages/test-data/tests-unit/strings/strings.less",
    "source": "// String handling and interpolation tests\n#strings {\n  background-image: url(\"http://son-of-a-banana.com\");\n  quotes: \"~\" \"~\";\n  content: \"#*%:&^,)!.(~*})\";\n  empty: \"\";\n  brackets: \"{\" \"}\";\n  escapes: \"\\\"hello\\\" \\\\world\";\n  escapes2: \"\\\"llo\";\n}\n#comments {\n  content: \"/* hello */ // not-so-secret\";\n}\n#single-quote {\n  quotes: \"'\" \"'\";\n  content: '\"\"#!&\"\"';\n  empty: '';\n  semi-colon: ';';\n}\n#one-line { image: url(http://tooks.com) }\n#crazy { image: url(http://), \"}\", url(\"http://}\") }\n#interpolation {\n  @var: '/dev';\n  url: \"http://lesscss.org@{var}/image.jpg\";\n\n  @var2: 256;\n  url2: \"http://lesscss.org/image-@{var2}.jpg\";\n\n  @var3: #456;\n  url3: \"http://lesscss.org@{var3}\";\n\n  @var4: hello;\n  url4: \"http://lesscss.org/@{var4}\";\n\n  @var5: 54.4px;\n  url5: \"http://lesscss.org/@{var5}\";\n}\n\n// multiple calls with string interpolation\n\n.mix-mul (@a: green) {\n    color: ~\"@{a}\";\n}\n.mix-mul-class {\n    .mix-mul(blue);\n    .mix-mul(red);\n    .mix-mul(black);\n    .mix-mul(orange);\n}\n\n@test: Arial, Verdana, San-Serif;\n.watermark {\n  @family: ~\"Univers, @{test}\";\n  family: @family;\n}\n#iterated-interpolation {\n  @box-small: 10px;\n  @box-large: 100px;\n\n  .mixin { // both ruleset and mixin\n    width: ~\"@{box-@{suffix}}\";\n    weird: ~\"@{box}-@{suffix}}\";\n    width-str: \"@{box-@{suffix}}\";\n    weird-str: \"@{box}-@{suffix}}\";\n    @box: ~\"@{box\";\n    @suffix: large;\n  }\n  .interpolation-mixin {\n    .mixin(); //call the above as mixin\n  }\n}\n",
    "expected": "#strings {\n  background-image: url(\"http://son-of-a-banana.com\");\n  quotes: \"~\" \"~\";\n  content: \"#*%:&^,)!.(~*})\";\n  empty: \"\";\n  brackets: \"{\" \"}\";\n  escapes: \"\\\"hello\\\" \\\\world\";\n  escapes2: \"\\\"llo\";\n}\n#comments {\n  content: \"/* hello */ // not-so-secret\";\n}\n#single-quote {\n  quotes: \"'\" \"'\";\n  content: '\"\"#!&\"\"';\n  empty: '';\n  semi-colon: ';';\n}\n#one-line {\n  image: url(http://tooks.com);\n}\n#crazy {\n  image: url(http://), \"}\", url(\"http://}\");\n}\n#interpolation {\n  url: \"http://lesscss.org/dev/image.jpg\";\n  url2: \"http://lesscss.org/image-256.jpg\";\n  url3: \"http://lesscss.org#456\";\n  url4: \"http://lesscss.org/hello\";\n  url5: \"http://lesscss.org/54.4px\";\n}\n.mix-mul-class {\n  color: blue;\n  color: red;\n  color: black;\n  color: orange;\n}\n.watermark {\n  family: Univers, Arial, Verdana, San-Serif;\n}\n#iterated-interpolation .mixin {\n  width: 100px;\n  weird: 100px;\n  width-str: \"100px\";\n  weird-str: \"100px\";\n}\n#iterated-interpolation .interpolation-mixin {\n  width: 100px;\n  weird: 100px;\n  width-str: \"100px\";\n  weird-str: \"100px\";\n}"
  },
  {
    "path": "packages/test-data/tests-unit/css-guards/css-guards.less",
    "source": ".light when (lightness(@a) > 50%) {\n  color: green;\n}\n.dark when (lightness(@a) < 50%) {\n  color: orange;\n}\n@a: #ddd;\n\n.see-the {\n  @a: #444; // this mirrors what mixins do - they evaluate the guards at the point of definition\n  .light();\n  .dark();\n}\n\n.hide-the {\n  .light();\n  .dark();\n}\n\n.multiple-conditions-1 when (@b = 1), (@c = 2), (@d = 3) {\n  color: red;\n}\n\n.multiple-conditions-2 when (@b = 1), (@c = 2), (@d = 2) {\n  color: blue;\n}\n\n@b: 2;\n@c: 3;\n@d: 3;\n\n.inheritance when (@b = 2) {\n  .test-rule {\n    color: black;\n  }\n  &:hover {\n    color: pink;\n  }\n  .hideme when (@b = 1) {\n    color: green;\n  }\n  & when (@b = 1) {\n    hideme: green;\n  }\n}\n\n.hideme when (@b = 1) {\n  .test-rule {\n    color: black;\n  }\n  &:hover {\n    color: pink;\n  }\n  .hideme when (@b = 1) {\n    color: green;\n  }\n}\n\n& when (@b = 1) {\n  .hideme {\n    color: red;\n  }\n}\n\n.mixin-with-guard-inside(@colWidth) {\n  // selector with guard (applies also to & when() ...)\n  .clsWithGuard when (@colWidth <= 0) {\n    dispaly: none;\n  }\n}\n\n.mixin-with-guard-inside(0px);\n\n.dont-split-me-up {\n  width: 1px;\n  & when (@c = 3) {\n    color: red;\n  }\n  & when (@c = 3) {\n    height: 1px;\n  }\n  * & when (@c = 3) {\n    sibling: true;\n  }\n}\n\n.scope-check when (@c = 3) {\n  @k: 1px;\n  & when (@c = 3) {\n    @k: 2px;\n    sub-prop: @k;\n  }\n  prop: @k;\n}\n.scope-check-2 {\n  .scope-check();\n  @k:4px;\n}\n.errors-if-called when (@c = never) {\n  .mixin-doesnt-exist();\n}\na:hover when (2 = true) {5:-}\n\n\n",
    "expected": ".light {\n  color: green;\n}\n.see-the {\n  color: green;\n}\n.hide-the {\n  color: green;\n}\n.multiple-conditions-1 {\n  color: red;\n}\n.inheritance .test-rule {\n  color: black;\n}\n.inheritance:hover {\n  color: pink;\n}\n.clsWithGuard {\n  dispaly: none;\n}\n.dont-split-me-up {\n  width: 1px;\n  color: red;\n  height: 1px;\n}\n* .dont-split-me-up {\n  sibling: true;\n}\n.scope-check {\n  sub-prop: 2px;\n  prop: 1px;\n}\n.scope-check-2 {\n  sub-prop: 2px;\n  prop: 1px;\n}"
  },
  {
    "path": "packages/test-data/tests-unit/merge/merge.less",
    "source": "// Merge functionality tests\n.first-transform() {\n  transform+: rotate(90deg), skew(30deg);\n}\n.second-transform() {\n  transform+: scale(2,4);\n}\n.third-transform() {\n  transform: scaleX(45deg);\n}\n.fourth-transform() {\n  transform+: scaleX(45deg);\n}\n.fifth-transform() {\n  transform+: scale(2,4) !important;\n}\n.first-background() {\n  background+: url(data://img1.png);\n}\n.second-background() {\n  background+: url(data://img2.png);\n}\n\n.test-rule1 {\n  // Can merge values\n  .first-transform();\n  .second-transform();\n}\n.test-rule2 {\n  // Won't merge values without +: merge directive, for backwards compatibility with css\n  .first-transform();\n  .third-transform();\n}\n.test-rule3 {\n  // Won't merge values from two sources with different properties\n  .fourth-transform();\n  .first-background();\n}\n.test-rule4 {\n  .first-transform();\n  .fifth-transform();\n}\n.test-rule5 {\n  .first-transform();\n  .second-transform() !important;\n}\n.test-rule6 {\n  .second-transform();\n}\n.test-rule7 {\n  // inherit !important from merged subrules\n  .second-transform();\n  .second-transform() !important;\n  .second-transform();\n}\n\n.test-rule-interleaved {\n    transform+:  t1;\n    background+: b1;\n    transform+:  t2;\n    background+: b2, b3;\n    transform+:  t3;\n}\n\n.test-rule-spaced {\n    transform+_:  t1;\n    background+_: b1;\n    transform+_:  t2;\n    background+_: b2, b3;\n    transform+_:  t3;\n}\n\n.test-rule-interleaved-with-spaced {\n    transform+_:  t1s;\n    transform+:   t2;\n    background+:  b1;\n    transform+_:  t3s;\n    transform+:   t4 t5s;\n    background+_: b2s, b3;\n    transform+_:  t6s;\n    background+:  b4;\n}\n",
    "expected": ".test-rule1 {\n  transform: rotate(90deg), skew(30deg), scale(2, 4);\n}\n.test-rule2 {\n  transform: rotate(90deg), skew(30deg);\n  transform: scaleX(45deg);\n}\n.test-rule3 {\n  transform: scaleX(45deg);\n  background: url(data://img1.png);\n}\n.test-rule4 {\n  transform: rotate(90deg), skew(30deg), scale(2, 4) !important;\n}\n.test-rule5 {\n  transform: rotate(90deg), skew(30deg), scale(2, 4) !important;\n}\n.test-rule6 {\n  transform: scale(2, 4);\n}\n.test-rule7 {\n  transform: scale(2, 4), scale(2, 4), scale(2, 4) !important;\n}\n.test-rule-interleaved {\n  transform: t1, t2, t3;\n  background: b1, b2, b3;\n}\n.test-rule-spaced {\n  transform: t1 t2 t3;\n  background: b1 b2, b3;\n}\n.test-rule-interleaved-with-spaced {\n  transform: t1s, t2 t3s, t4 t5s t6s;\n  background: b1 b2s, b3, b4;\n}"
  },
  {
    "path": "packages/test-data/tests-unit/lazy-eval/lazy-eval.less",
    "source": "// Lazy evaluation tests\n@var: @a;\n@a: 100%;\n\n.lazy-eval {\n  width: @var;\n}\n",
    "expected": ".lazy-eval {\n  width: 100%;\n}"
  }
];
