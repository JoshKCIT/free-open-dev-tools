<!-- GSD:project-start source:PROJECT.md -->

## Project

**Free & Open Dev Tools**

A free developer tools website where every tool runs in the visitor's browser and every tool is a
self-contained MIT-licensed folder they can download, test and reuse. It exists so developers can use
common utilities on code, tokens, configs and customer data without sending any of it to a service they
cannot inspect.

It is live at https://joshkcit.github.io/free-open-dev-tools/ with 16 tools. The catalog is 144 tools.

**Core Value:** A developer can use any tool without their input leaving the browser, and can take that tool's complete,
tested source for their own project.

### Constraints

- **Privacy**: No tool may perform a network request, write to storage, or put input in the URL — it is
  the core value, and it is enforced by ESLint, a static gate and a browser harness
- **Packaging**: A tool folder may not import from outside itself, nor depend on another tool package —
  otherwise it cannot be lifted out, which is the second half of the core value
- **Correctness**: A tool's tests may not use another tool site as the oracle — they must be grounded in
  a specification, its published vectors, or a mature independent implementation used as a second opinion
- **Documentation**: Every tool must state its limits, and the limits list may not be empty — enforced by
  the catalog gate
- **Licensing**: MIT for everything original here — code, build scripts, documentation and site copy —
  backed by a root `LICENSE` file; runtime dependencies must be permissively licensed and their notices
  preserved — enforced by the licence gate
- **Hosting**: GitHub Pages, which cannot set response headers, so the content security policy is applied
  per page rather than at the header level
- **Provenance**: The origin of the catalog is not recorded anywhere. No survey, mapping or access log is
  kept, in any repository, public or private.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.

<!-- GSD:profile-end -->
