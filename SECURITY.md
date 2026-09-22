# Security

## Reporting a vulnerability

Use GitHub private vulnerability reporting on this repository (Security, then Report a vulnerability). That keeps the
report private until there is a fix.

Please do not open a public issue for anything that would let someone read another person's input, execute code in a
visitor's browser, or cause the site to transmit input.

## What counts as a vulnerability here

This is a static site with no accounts, no server and no database, so the interesting surface is narrow and specific.

| In scope                                                                       | Why it matters                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Any path by which tool input leaves the browser                                | It is the central claim of the project.                  |
| Any path by which tool input is persisted without the user asking              | Same.                                                    |
| Script execution from pasted content, in the page or in a preview frame        | Pasted content is treated as hostile.                    |
| A preview frame that can reach the network or the parent page                  | The sandbox is the second layer of defence.              |
| A dependency that ships a backdoor or a known-exploitable flaw into the bundle | It reaches every visitor.                                |
| A supply chain weakness in the build or deploy workflow                        | It would let someone publish something we did not write. |

| Out of scope                                           | Why                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The hosting provider access logs                       | Documented on the privacy page. GitHub receives ordinary request metadata; that is inherent to being served over HTTP.  |
| Missing security headers that a static host cannot set | GitHub Pages does not allow custom response headers. The page-level content security policy is applied where it can be. |
| Output that is wrong                                   | That is a correctness bug. Open a normal issue with a description of the input.                                         |
| Exhausting your own tab by pasting an enormous input   | It affects only your tab.                                                                                               |

## How the project defends itself

**No transmission.** Tool packages may not call `fetch`, construct an `XMLHttpRequest`, open a `WebSocket` or
`EventSource`, or call `navigator.sendBeacon`. `scripts/check-catalog.mjs` scans the code with strings and comments
removed, and ESLint forbids the same globals inside `tools/*/src`. `e2e/privacy.spec.ts` then drives the built site in
a real browser and fails if any request is made while a tool is processing input.

**No third-party assets.** Everything is bundled and served from the site own origin. There is no CDN, no font
service and no analytics. The check runs in CI and again against the live site after deployment.

**Pasted content is not executed.** Markup rendered from user input is sanitised in the tool package, then rendered
inside an iframe with an empty `sandbox` attribute and a `default-src 'none'` content security policy. Tools that
would have required executing pasted code, such as a JavaScript or SQL playground, were deliberately excluded and are
recorded as such in the catalog.

**Cryptography is not invented here.** Digests and HMAC come from `@noble/hashes`, which is audited and has no
dependencies of its own. Random values always come from `crypto.getRandomValues`, never `Math.random`.

**Dependencies are audited and licence-checked.** CI blocks on a high or critical advisory in anything that ships, and
on any dependency whose licence is not on the reviewed allow list.

**Secrets are scanned.** Every push and pull request is scanned with gitleaks.

## What this project cannot protect you from

- A compromised browser or a malicious extension. Anything with access to the page can read what you type into it.
- Your own clipboard and browser history.
- The fact that your network can see you requested this site, and which page.
- Pasting a live production secret into any web page, here or anywhere. Rotate anything you paste into a page you did
  not write yourself.
