# EditorConfig Resolver

Paste .editorconfig files and a file path to see which properties apply and which file, section and line decided each.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste the .editorconfig files of a project, the top one first and one more for each nested folder, then type the path of a file. The page shows the properties an EditorConfig-aware editor would apply to that file, and for each one the file, the section and the line that decided it, the earlier settings that were overridden, which of the pasted files were used and which were not and why, and which sections matched the path. The search follows the specification: files closer to the file win, a later section wins over an earlier one, and a file that sets root to true stops the search. Everything is worked out in your browser from the text you paste; nothing is sent anywhere.

## Supported

- One or more pasted files: the text before the first === folder === line is the file of the top folder, and each === folder === line starts the file of that folder (forward slashes, no leading slash)
- Section names as the specification defines them: * (any text except a slash), ** (any text), ? (one character except a slash), [seq] and [!seq] classes, {a,b,c} alternatives that can nest, {num1..num2} integer ranges, and a backslash to escape a special character
- A name with no slash outside brackets matches at any folder level below its file; a name with a slash is relative to the folder of its file
- Precedence in the order the specification gives: files are read from the farthest to the nearest, sections from top to bottom, and the most recent pair wins; each property names the file, section and line that decided it and lists the settings it replaced
- root = true in the lines before the first section of a file stops the search above that file, and the files above it are listed as not used
- unset, which removes the effect of an earlier pair, and the values the reference cores work out: indent_size follows indent_style = tab, tab_width follows indent_size
- Lines the format has no place for are skipped and listed by file and line

## Limits

- Only the files you paste are read. The page does not look at your disk, so a parent folder's .editorconfig that you did not paste is not part of the result.
- Results follow the EditorConfig specification, version 0.17.2, and the EditorConfig project's published core tests, including the values the reference cores work out for indent_size and tab_width. An editor or plugin can implement only some properties, and some read extra properties that the specification does not define; unknown properties are passed through as written.
- Matching treats the path as written with forward slashes and is case-sensitive; an editor on a case-insensitive file system may behave differently. A backslash in a path is an ordinary character, and white space at the start or end of the path is part of it; each gets a note. One path is resolved at a time, relative to the top folder.
- Not read: more than 50 files, 10,000 lines or 1,000,000 characters in all, a line over 8,192 characters, a section name or key over 1,024 characters, a value over 4,096 characters, a path or folder name over 1,024 characters, or a number range with an end of more than 9 digits. Matching is limited by a work budget of 40,000,000 steps, and a paste that needs more is refused with a sentence instead of freezing the page.

## Ambiguous cases, and what this does about them

- unset: a pair whose value is unset removes the effect of every earlier pair for that property. The page shows it as the value unset, the way the reference cores report it, and says so in the How column. indent_size = unset also reports tab_width = unset, because the reference cores derive tab_width from indent_size.
- Derived values: indent_style = tab without an indent_size gives indent_size = tab, indent_size = tab together with a tab_width takes the width, and a number in indent_size without a tab_width gives the same tab_width. These rows say derived and name the property they come from. A tab_width of unset is copied like any other width, the way the reference cores copy it, so indent_style = tab or indent_size = tab together with tab_width = unset reports indent_size = unset, with a note.
- Backslashes: the specification does not allow a backslash as a path separator, so a backslash in the path is an ordinary character and is matched as written, with a note.
- Where the specification is silent the published core tests decide: a bracket pair that holds a slash is not a class, a double star between two slashes matches zero or more folders, {single}, {} and a { with no closing } are ordinary text, {a,b,} keeps the empty alternative, and {3..120} matches 60 but not 060.
- Number ranges whose ends are equal or reversed, such as {5..5} or {10..3}: the specification requires the first number to be less than the second and no core test covers this case, so the page reads such a range as ordinary text, the way it reads {aardvark..antelope}. Another implementation may match the numbers in it instead.

## Defined by

- [EditorConfig specification 0.17.2](https://spec.editorconfig.org/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/editorconfig editorconfig
cd editorconfig
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/editorconfig
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { resolveEditorConfig } from '@fodt/editorconfig';

const files = 'root = true\n\n[*.{js,py}]\nindent_style = space\nindent_size = 4\n\n[*.py]\nindent_size = 2';
const result = resolveEditorConfig(files, 'src/app.py');
result.properties.map((p) => `${p.key}=${p.value}`); // ['indent_style=space', 'indent_size=2', 'tab_width=2']
result.properties[1]; // { key: 'indent_size', value: '2', how: 'set', file: '.editorconfig', section: '*.py', line: 8 }
```

`resolveEditorConfig(filesText, path)` returns an empty result for an empty paste or path. Otherwise it checks the path (`checkPath`), cuts the paste into files (`splitFiles`, which enforces every size limit before anything is parsed), reads each file (`parseEditorConfig`) and resolves the properties (`resolveProperties`). Section names are compiled once by `compileGlob` into a list of instructions and matched by `matchGlob`, which runs the list as a set of positions over the path in one pass: there is no regular expression anywhere in the package, braces are never expanded, and every match first takes its cost from a shared work budget (`newBudget`, `WORK_BUDGET`). The result has `properties`, `overridden`, `filesUsed`, `filesNotUsed`, `sectionsMatched`, `sectionsNotMatched`, `problems` and `notes`. A refusal is an `EditorConfigError` that names a file and a line and never repeats the pasted text. Keys, sections and folders are plain strings held in maps, so a section named __proto__ is ordinary text.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The EditorConfig project's published conformance tests (editorconfig-core-test, commit 895b3a65, BSD-2-Clause) are vendored byte for byte, with the git blob sha of every file recorded in UPSTREAM.md and checked by a test: 198 cases in the glob, parser, properties and filetree folders, of which 196 are run, each both on the files as the reference command reads them and as a visitor pastes them, and 2 are excluded by name (indent_size_default_pre_0_9_0 passes a compatibility version flag, and path_separator_backslash_in_cmd_line passes a Windows absolute path). A script rebuilds the case list from the vendored CMake files and a test compares it with the committed file. A recording of the editorconfig library, version 3.0.2, on 5,900 generated glob and path pairs (seed 99) agrees on all but 34, which fall in three named families of degenerate globs the specification does not define (runs of slashes and stars, an empty brace alternative before a slash, and an escaped star followed by a star); unit tests read the recording and never run the library. Hand-written rows cover the rules the core tests teach and the specification does not state, section name, key and value limits at their exact boundaries, the 50 file, 10,000 line and 1,000,000 character caps checked before parsing, the work budget, refusals that name a file and line and never repeat pasted text, names such as __proto__ as plain text, and linear time on hostile files, globs and paths (the doubling rule and an input four times as long), including 300 stars against a 4,000 character path. A browser test in four engines pastes nested files and reads the deciding file, section and line of each property off the page, checks that a file with root set to true leaves the files above it unused, and gives a section of 300 stars a path of 1,000 letters to see that the page answers at once and still answers the next path.

## Licence

MIT. See [LICENSE](./LICENSE).
