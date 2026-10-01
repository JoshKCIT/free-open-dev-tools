# HTML Form Field Builder

Build one accessible form field of any HTML input type, a textarea or a select, with its label, name, validation attributes and autocomplete token, and preview it safely.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one accessible form field and shows its markup first, ready to copy, with a live preview of the same markup after it. The label is always tied to the control by a for value that equals the control's id, and the id is worked out from the name unless you type one. Nothing in the preview is loaded from an address: it shows the same elements with every address replaced. The input types, the table of which attributes apply to which type, and the autofill field names are copied from the HTML Living Standard (last updated 2026-09-29) on 2026-10-01; a later edition of the standard may differ.

## Supported

- All 22 input types of the HTML Living Standard (hidden, text, search, tel, url, email, password, date, month, week, time, datetime-local, number, range, color, checkbox, radio, file, submit, image, reset and button), plus textarea and select: 24 controls
- A label element tied to the control by a for value that equals its id; checkbox and radio put the control before its label, and a radio field is a group of at least two radios in a fieldset with a legend
- An id worked out from the name (each run of spaces becomes one hyphen) that you can overwrite; an id with a space is refused
- Validation attributes only where the standard's own table allows them: pattern, minlength, maxlength and size on text-like types, min, max and step on number, range and the date and time types, accept on file, alt and src on image, rows and cols on textarea; anything else is refused with the list of controls that do allow it
- Boolean attributes (required, readonly, disabled, multiple, checked, autofocus) typed as space-separated names and written exactly as typed, only where the control allows them
- An autocomplete value checked against the autofill grammar: an optional section name, shipping or billing, a field name from the standard's table (or a contact type and a contact field name), then an optional webauthn, or on or off alone
- A select or radio group from option lines written value | label, a select placeholder option with an empty value, and the rule that a required single select needs one
- The accessible name the browser will compute for the control, with the rule of HTML-AAM it comes from

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, a radio group to 50 options and a select to 200 options, and control characters other than a tab (and line breaks in a multi-line field) are refused because HTML cannot carry them.
- This builder writes only the attributes you choose: it never adds an autocomplete, required or aria attribute for you. The one exception is a button, whose text is set to its label when you leave the starting value blank, and a note says so.
- Attributes this builder does not offer: list, dirname, the form submission overrides (formaction and the others), the popover targets, and the colour input's alpha and colorspace, which the browsers checked do not implement; optgroups are not generated.
- A hidden input is not labelable in the standard, so no label is written for it and a note says why.
- The preview cannot show everything a browser does: it never runs script, so it shows the structure and the label tie, not the behaviour of validation attributes.

## Ambiguous cases, and what this does about them

- The standard lets a control have no name, in which case it is not sent with the form; this builder asks for a name (except for buttons) so the id, and with it the label tie, can be worked out from it.
- The autofill grammar lists only the field names appropriate for the control, so a field name outside its control group, such as street-address on a single-line text input, is not valid there; it is refused and the control group the standard assigns to it is named, instead of being kept and ignored by browsers.
- The standard treats a token whose first eight characters are section- as a section name; this builder also asks for at least one character after the hyphen, because a section with no name groups nothing.
- A starting value that is longer than the maxlength, or non-empty and shorter than the minlength, is refused although the standard only applies those limits to what a visitor types; characters are counted as UTF-16 code units, so an emoji counts as two.
- A starting value for a radio group or a select names the option to check or select by its value; if no option has that value it is refused rather than ignored.

## Defined by

- [HTML Living Standard, 4.10.5 The input element](https://html.spec.whatwg.org/multipage/input.html)
- [HTML Living Standard, 4.10.4 The label element](https://html.spec.whatwg.org/multipage/forms.html)
- [HTML Living Standard, 4.10.7 The select element and 4.10.11 The textarea element](https://html.spec.whatwg.org/multipage/form-elements.html)
- [HTML Living Standard, 4.10.19.7 Autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)
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

const field = buildField({
  control: 'textarea',
  label: 'Address:',
  name: 'ba',
  autocomplete: 'section-blue shipping street-address',
});
field?.html;
// <label for="ba">Address:</label>
// <textarea id="ba" name="ba" autocomplete="section-blue shipping street-address"></textarea>
```

`buildField(spec)` returns `{ tree, html, preview, warnings, accessibleName }`, or `null` when every field it reads is blank. `html` is the copyable markup; `preview` is the same tree with every address replaced or removed. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `CONTROL_KINDS` lists the 24 controls, `allowedAttributes(control)` the attributes the standard allows on one, `parseAutocomplete(value, control)` checks an autocomplete value and throws `MarkupError` when it is not valid, and `deriveId(name)` turns each run of ASCII whitespace into one hyphen.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The label rule of the HTML Living Standard (4.10.4), the autofill examples of 4.10.19.7.1 (section-blue shipping street-address and the others), the applicability table of 4.10.5 and the label rules of HTML-AAM 4.1.1 are checked literally, and hostile text typed into every field must leave the parsed element tree unchanged. The counts of the copied tables (22 input types, 44 normal and 10 contact autofill field names) are asserted.

## Licence

MIT. See [LICENSE](./LICENSE).
