# UTM Campaign Builder

Attach campaign parameters to a URL correctly.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Attaches Google Analytics campaign parameters to a link before its fragment, without changing a single byte of the existing query string. Every parameter name and order is transcribed from the Google Analytics campaign URL documentation, and the built URL is checked by reparsing it with the platform's own WHATWG URL parser before it is shown.

## Supported

- Attaching utm_id, utm_source, utm_medium, utm_campaign, utm_source_platform, utm_term, utm_content, utm_creative_format and utm_marketing_tactic, in the order the Google Analytics documentation lists them
- Keeping every existing query pair exactly as typed, byte for byte, and placing new campaign parameters before the URL's fragment
- Replacing an existing campaign parameter with the new value instead of duplicating it, and reporting which parameters were added and which were replaced
- Encoding each value with the WHATWG URL Standard's component percent-encode set, so a space, ampersand, equals sign or hash sign inside a value cannot split or end a parameter
- Flagging a value with an upper-case letter and, on request, lower-casing every value before it is written
- Refusing a URL the WHATWG URL parser cannot read, or one that is not http or https

## Limits

- This tool cannot tell whether a real Google Analytics property, or any other analytics service, actually receives or reports these parameters -- that happens on the analytics server after a visitor follows the built link, which needs a real request to a server
- Only the parameter names on the fetched Google Analytics documentation page are offered; a service using a different, non-standard parameter name is not supported
- A campaign parameter whose current URL value cannot be decoded with the application/x-www-form-urlencoded rules is treated as an ordinary, non-campaign query pair and kept unchanged rather than replaced

## Ambiguous cases, and what this does about them

- New values are percent-encoded with %20 for a space rather than +, because %20 decodes back to a space under both percent-decoding and application/x-www-form-urlencoded decoding, while + only does under the latter
- A non-empty fragment that starts with a slash, or that itself contains a question mark or an equals sign, is treated as a possible single-page-app route and gets its own warning; an ordinary in-page anchor fragment does not

## Defined by

- [WHATWG URL Standard — URL serializing (the component percent-encode set)](https://url.spec.whatwg.org/#component-percent-encode-set)
- [Google Analytics — Collect campaign data with custom URLs](https://support.google.com/analytics/answer/10917952?hl=en)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/utm-builder utm-builder
cd utm-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/utm-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildCampaignUrl } from '@fodt/utm-builder';

buildCampaignUrl('https://www.example.com/', { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring_sale' });
// { url: 'https://www.example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring_sale', added: ['utm_source','utm_medium','utm_campaign'], replaced: [], warnings: [] }
```

`buildCampaignUrl(url, params, options)` throws `UtmBuilderError` when the platform's own URL constructor cannot parse `url`, or when the scheme is not `http:` or `https:`. `options.lowercase` (default false) lower-cases every typed value before it is written. The result's `added` and `replaced` arrays list parameter names, not full pairs; a parameter left empty is neither added nor replaced.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every required behaviour is proven against a real call to `buildCampaignUrl`, including a round trip through the platform's own `URL` and `URLSearchParams` to prove the built URL reparses to exactly the values typed. `UTM_PARAMETERS`'s order and required flags are checked against lines quoted from the fetched Google Analytics documentation page in a test comment.

## Licence

MIT. See [LICENSE](./LICENSE).
