# Deployment and rollback

## Where it goes

GitHub Pages, from the `main` branch of this repository, at
`https://joshkcit.github.io/free-open-dev-tools/`.

GitHub Pages was chosen because it needs no credentials beyond the repository itself, costs nothing, and serves static
files, which is all this site is. Its one relevant limitation is that it cannot set custom response headers, so the
content security policy is applied per page rather than at the header level.

## One-time setup

Everything in this checklist lives in repository settings, not in git. None of it is a file, so none of it is
restored by pushing a commit: all of it is destroyed if the repository is ever deleted and recreated, and has to be
redone by hand afterwards.

Someone with admin rights on the repository has to do this once, in the browser. It cannot be done with the API token
used for pushing code.

1. Go to **Settings, Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Nothing else on this screen. No branch to pick, no folder to choose.
4. Go to **Settings, Actions, General**, and under **Actions permissions, Workflow permissions**, leave the default
   at **Read repository contents and packages permissions**. The deploy workflow does not rely on this default: it
   declares its own `permissions:` block (`contents: read`, `pages: write`, `id-token: write`), which is what lets
   it publish to Pages. Raising the repository default to write is not required and widens the token for every
   other workflow, so do not do it.
5. Go to **Settings**, and set the repository **description** and its **topics**. See the recorded values below.
6. Go to **Issues, Labels**, and confirm the `bug` label exists, then re-create any custom label listed below.
   GitHub creates a standard label set for a new repository, so `bug` is normally a step to confirm rather than
   create, but confirm it rather than assume it: the issue link on every tool page (`issueUrl()` in
   `apps/web/src/lib/site.ts`) depends on that exact label existing. Custom labels are **not** in GitHub's default
   set and are silently lost on recreation, which is why they are written down here rather than left to memory.
7. Go to **Settings, Secrets and variables, Actions, Secrets**, and add a repository **secret** named
   `PROVENANCE_DENYLIST` holding the forbidden-reference list, one entry per line or comma separated. The release
   gate (`scripts/check-provenance.mjs`) and the post-deployment check below both read it, and both fail the build
   when it is empty in CI, by design: a fork of this repository has no such secret and therefore fails closed until
   its own maintainer sets one.

   **It must be a secret, not a variable.** GitHub Actions masks secrets in job logs and does not mask variables.
   A variable is printed verbatim in the `env:` group of every step that uses it, and on a public repository those
   logs are public. Storing this list in a variable therefore publishes, on every single CI run, the exact list the
   gate exists to keep out of public view. This was found the hard way on 2026-09-22: the list appeared in plain
   text in four public run logs before it was caught, the logs were deleted, and the variable was replaced with a
   secret. Do not "simplify" this back to a variable.

8. Go to **Settings, Branches**, and confirm whether any branch protection rule exists on the default branch. If one
   does, note its settings before the repository is deleted; nothing about it is stored in git.

Optionally, to require a review before anything is published:

9. Go to **Settings, Environments, github-pages**.
10. Add yourself under **Required reviewers**.

If this is enabled today, it is also lost on a repository recreation and is easy to forget precisely because it is
optional — check whether it is on before deleting the repository, not just how to turn it on.

Until steps 1 to 3 are done, the deploy workflow will run and fail at the `deploy-pages` step with a message about
Pages not being enabled. That is the expected behaviour, not a bug in the workflow.

### Recorded settings

None of this lives in git, so it is written down here. These values were read from the live repository on
2026-09-22, immediately before it was deleted and recreated. Anything not listed was not configured.

| Setting                     | Where                                    | Value at capture                                                                                                                               |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                  | Settings                                 | Public                                                                                                                                         |
| Description                 | Settings                                 | `Free developer tools that run entirely in your browser. Every tool is a self-contained MIT-licensed folder you can download, test and reuse.` |
| Topics                      | Settings                                 | **None set.** Nothing to restore.                                                                                                              |
| Homepage URL                | Settings                                 | Empty                                                                                                                                          |
| Workflow permissions        | Settings, Actions, General               | `read`, "Allow GitHub Actions to create and approve pull requests" off                                                                         |
| Actions permissions         | Settings, Actions, General               | Enabled, all actions allowed, SHA pinning not required                                                                                         |
| Pages source                | Settings, Pages                          | GitHub Actions (`build_type: workflow`), HTTPS enforced                                                                                        |
| Pages URL                   | Settings, Pages                          | `https://joshkcit.github.io/free-open-dev-tools/`                                                                                              |
| Custom domain               | Settings, Pages                          | None                                                                                                                                           |
| `github-pages` environment  | Settings, Environments                   | Exists. **No required reviewers.** Deployment branch policy: custom, allowing `main` only                                                      |
| Branch protection on `main` | Settings, Branches                       | **None.** No rule existed                                                                                                                      |
| Repository variables        | Settings, Secrets and variables, Actions | **None.** `PROVENANCE_DENYLIST` had never been set. It is now a **secret**, not a variable, see step 7                                         |
| Issues / Projects / Wiki    | Settings                                 | All enabled                                                                                                                                    |
| Stars / Forks               | Repository home                          | 0 / 0, so nothing lost on recreation                                                                                                           |

**Labels at capture.** Ten in total. Nine are GitHub's standard set and are re-created automatically. One is
custom and is **not**, so it has to be added by hand:

| Label              | Colour   | Description                                | Standard?                                    |
| ------------------ | -------- | ------------------------------------------ | -------------------------------------------- |
| `accessibility`    | `f143ab` | Barrier affecting people with disabilities | **No, re-create this one**                   |
| `bug`              | `d73a4a` | Something isn't working                    | Yes, but confirm it: tool pages depend on it |
| `documentation`    | `0075ca` | Improvements or additions to documentation | Yes                                          |
| `duplicate`        | `cfd3d7` | This issue or pull request already exists  | Yes                                          |
| `enhancement`      | `a2eeef` | New feature or request                     | Yes                                          |
| `good first issue` | `7057ff` | Good for newcomers                         | Yes                                          |
| `help wanted`      | `008672` | Extra attention is needed                  | Yes                                          |
| `invalid`          | `e4e669` | This doesn't seem right                    | Yes                                          |
| `question`         | `d876e3` | Further information is requested           | Yes                                          |
| `wontfix`          | `ffffff` | This will not be worked on                 | Yes                                          |

The `github-pages` environment and its branch policy are created by GitHub itself when Pages is pointed at
GitHub Actions, so step 1 normally restores them. Check afterwards rather than assuming, and note that the
optional required-reviewers setting in steps 9 and 10 was **not** in use, so there is nothing to restore there.

## How a deploy happens

```
push to main
     |
     v
  CI workflow          typecheck, lint, format, unit tests, three release gates,
     |                 dependency audit, secret scan, browser and privacy tests
     |  on success
     v
 Deploy workflow       build with VITE_BASE=/free-open-dev-tools/, upload, publish
     |
     v
 Post-deployment checks against the live site
```

The deploy workflow triggers on **completion of the CI workflow**, and its first job refuses to continue unless CI
concluded `success`. A failing test therefore stops a deploy, rather than the two racing each other.

### The release gate

Deployment is blocked when any of these fail:

| Gate                                   | What it catches                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                       | Type errors anywhere, including in the tool packages.                                                                      |
| `pnpm lint`                            | A tool package reaching for `fetch`, storage or the DOM.                                                                   |
| `pnpm test`                            | A tool that no longer matches its specification.                                                                           |
| `pnpm check:catalog`                   | A tool on the site without tests, a package without a page, empty documentation, or a code path that could transmit input. |
| `pnpm check:standalone`                | A tool folder that could not be used on its own.                                                                           |
| `pnpm check:licenses`                  | A dependency licence that cannot be shipped, or a missing notice.                                                          |
| `pnpm audit --prod --audit-level high` | A known high or critical advisory in code that reaches visitors.                                                           |
| gitleaks                               | A credential committed to the repository.                                                                                  |
| `playwright test`                      | A broken route or workflow, a failing accessibility check, or **any tool leaking input**.                                  |
| Generated file check                   | Documentation that has drifted from its source.                                                                            |

### Why the base path matters

A GitHub Pages project site is served from a subdirectory. The build therefore runs with
`VITE_BASE=/free-open-dev-tools/`, which sets both the asset prefix and the router basename. Building without it
produces a site whose every asset is a 404. If the site later moves to its own domain, change that one variable.

## Post-deployment checks

The `verify` job runs against the live site after publishing and fails if:

- Any of the home page, tools index, privacy page, catalog, two representative tool pages, `sitemap.xml` or
  `robots.txt` returns anything other than 200, or does not contain the content it should.
- The deployed HTML references any asset from a host other than the site own origin.
- Either the served HTML (the prerendered page descriptions, which live in the HTML rather than the bundle) or the
  served JavaScript carries a forbidden reference from the `PROVENANCE_DENYLIST` repository secret.

A failure here means the deployment is broken even though the build passed. Roll back.

## Rollback

### Option 1: redeploy a known-good commit (fastest, about two minutes)

1. Find the last commit that deployed successfully. The Actions tab lists every Deploy run with its commit.
2. Go to **Actions, Deploy to GitHub Pages, Run workflow**.
3. Enter that commit SHA in the **commit** input.
4. Run it.

This rebuilds and republishes that exact commit. It does not touch `main`, so the broken commit is still in history
and can be fixed properly afterwards.

**This option is unavailable until a second deploy has succeeded.** Immediately after the repository is deleted and
recreated, there is exactly one commit in the history, so there is no earlier known-good commit to redeploy. In that
window, use option 3 to take the site down instead, and wait for a second, working deploy before option 1 becomes a
real choice again.

### Option 2: revert the commit (when the code itself is wrong)

```sh
git revert <bad-commit-sha>
git push origin main
```

CI runs on the revert, and on success the deploy follows automatically. Slower than option 1 because it waits for the
full pipeline, but it leaves `main` in a correct state.

### Option 3: take the site down

If the problem is serious enough that no content is better than wrong content:

1. **Settings, Pages**, set **Source** to **None**.

The site returns 404 until the source is set back to GitHub Actions. Use this only for something like a leaked
credential in the bundle or a tool actually transmitting input, where continuing to serve is worse than being offline.

### What rollback cannot undo

- Anything a visitor already downloaded. A bad build that was live for ten minutes was executed in the browsers of
  whoever visited in those ten minutes.
- A credential that was committed. Rolling back the site does not un-leak it. Rotate the credential first, then clean
  the history.

## Deploying somewhere else

The build output in `apps/web/dist` is plain static files and works on any static host.

**Cloudflare Pages, Netlify or similar:**

- Build command: `pnpm install --frozen-lockfile && pnpm run build:web`
- Output directory: `apps/web/dist`
- Environment: `VITE_BASE=/` when serving from a domain root.

On a host that supports custom headers, these are worth setting. They are not set today only because GitHub Pages
cannot:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
```

`connect-src 'none'` is the interesting one: it makes the privacy claim enforceable by the browser itself, not just by
our tests. Adding it is the main argument for moving off GitHub Pages later.

## Operational notes

- **There is nothing to monitor.** No server, no database, no queue, no certificates to renew. The site is files.
- **Cost is zero** on the current plan, and there is no usage that could change that.
- **Availability** is whatever GitHub Pages provides. There is no failover, and for a free tool site that is a
  reasonable trade.
- **The deploy is idempotent.** Running it twice on the same commit produces the same output.
