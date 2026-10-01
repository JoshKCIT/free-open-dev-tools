# HTML Form Field Builder

Build one accessible form field of any HTML input type, a textarea or a select, with its label, name, validation attributes and autocomplete token, and preview it safely.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one accessible form field and shows its markup first, ready to copy, with a live preview of the same markup after it. The label is always tied to the control by a for value that equals the control's id, and the id is worked out from the name unless you type one. Nothing in the preview is loaded from an address: it shows the same elements with every address replaced.

## Supported

- A single-line text input with a label element tied to it by matching for and id values
- An id worked out from the name (each run of spaces becomes one hyphen) that you can overwrite
- A starting value for the text input
- The accessible name the browser will compute for the control, with the rule it comes from

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, and control characters other than a tab (and line breaks in a multi-line field) are refused because HTML cannot carry them.
- This builder writes only the attributes you choose: it never adds an autocomplete, required or aria attribute for you.

## Ambiguous cases, and what this does about them

- The standard lets a control have no name, in which case it is not sent with the form; this builder asks for a name so the id, and with it the label tie, can be worked out from it.

## Defined by

- [HTML Living Standard, 4.10.5 The input element](https://html.spec.whatwg.org/multipage/input.html)
- [HTML Living Standard, 4.10.4 The label element](https://html.spec.whatwg.org/multipage/forms.html)
- [Accessible Name and Description Computation 1.2](https://www.w3.org/TR/accname-1.2/)
- [HTML Accessibility API Mappings 1.0](https://www.w3.org/TR/html-aam-1.0/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/form-field-builder form-field-builder
cd form-field-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/form-field-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildField } from '@fodt/form-field-builder';

const field = buildField({ control: 'text', label: 'Full name:', name: 'fn' });
field?.html;
// <label for="fn">Full name:</label>
// <input type="text" id="fn" name="fn">
```

`buildField(spec)` returns `{ tree, html, preview, warnings, accessibleName }`, or `null` when every field it reads is blank. `html` is the copyable markup; `preview` is the same tree with every address replaced or removed. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `deriveId(name)` turns each run of ASCII whitespace into one hyphen.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The label example of the HTML Living Standard (4.10.4) and the label rules of HTML-AAM 4.1.1 are checked literally, and hostile text typed into every field must leave the parsed element tree unchanged.

## Licence

MIT. See [LICENSE](./LICENSE).
