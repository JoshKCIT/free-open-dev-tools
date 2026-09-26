# GitHub Actions Validator

Validate a workflow file and report invalid keys, triggers and expressions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a GitHub Actions workflow file against the official SchemaStore workflow schema, reporting every problem at its line, column and key path -- an unknown key, a wrong type, an event name this schema does not accept, a needs entry naming a missing job, a needs cycle, a step id repeated within one job, or a malformed ${{ }} expression. Nothing about the file is sent anywhere; validation runs entirely in this tab, in a background worker so a pathological file cannot freeze it.

## Supported

- The GitHub Actions workflow JSON Schema (draft-07), bundled from SchemaStore at a pinned commit
- Every trigger event the schema's on property accepts, given as a string, an array, or an object mapping, with a close-match suggestion for a misspelled event name
- A job's needs referring to another job in the same file, including a needs cycle spanning any number of jobs
- A step id repeated within one job
- YAML anchors and aliases, resolved as ordinary YAML
- The documented ${{ }} expression grammar: literals, operators, property access, the * object filter, every documented function and its argument count, the twelve contexts, and the status check functions -- checked for syntax only, never evaluated
- An if condition written without the ${{ }} delimiters, read as an expression the way GitHub documents
- A warning when steps.<id> names a step that has not already run in the same job, or needs.<job> names a job the current job does not list in its own needs

## Limits

- This tool cannot check that an action or reusable workflow named in uses actually exists at the given ref, that a runner label is available on the account running the workflow, or that a secret or variable referenced in the workflow is defined -- only a real run on GitHub can show that.
- The bundled schema is a snapshot of SchemaStore's GitHub Actions workflow schema at one pinned commit; a change GitHub publishes afterwards is not reflected here until this tool is updated.
- GitHub's own documentation does not state whether its workflow parser applies the YAML << merge key; this tool reads workflows without applying it (see the ambiguity below), so a workflow relying on one may be reported differently than GitHub reports it.
- This tool never evaluates an expression, so it cannot tell whether a well-formed expression's context or property actually exists at run time (for example a step id that is spelled correctly but belongs to a step that was skipped) -- only a real run on GitHub can show that.

## Ambiguous cases, and what this does about them

- GitHub's documentation does not address YAML anchors, aliases or the << merge key for workflow files directly, and no vendored SchemaStore or starter-workflow example uses a merge key. This tool resolves anchors and aliases (an ordinary part of reading any YAML document) but does not apply << merge keys, matching the yaml package's own conservative default rather than asserting untested behaviour.
- GitHub's expressions page never states whether function names are case sensitive. This tool matches them case-insensitively (accepting fromJson as well as fromJSON) because SchemaStore's own accepted positive test fixture workflow_call_input_issue_2501.yaml spells it fromJson and GitHub accepts that file -- empirical evidence from GitHub's own accepted-workflow corpus, not a claim the fetched page itself makes.

## Defined by

- [GitHub Actions workflow schema (SchemaStore)](https://github.com/SchemaStore/schemastore/blob/314154a4c71665df725986ad334f6f0846d486d3/src/schemas/json/github-workflow.json)
- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/events-that-trigger-workflows)
- [Evaluate expressions in workflows and actions](https://docs.github.com/en/actions/learn-github-actions/expressions)
- [Contexts reference](https://docs.github.com/en/actions/learn-github-actions/contexts)
- [YAML 1.2.2](https://yaml.org/spec/1.2.2/)
- [RFC 6901 (JSON Pointer)](https://www.rfc-editor.org/rfc/rfc6901)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **GitHub Actions Workflow JSON Schema** (Apache-2.0) — [source](https://github.com/SchemaStore/schemastore). "GitHub Actions Workflow" schema by the SchemaStore project, licensed under the Apache License, Version 2.0. Snapshot taken at commit 314154a4c71665df725986ad334f6f0846d486d3.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/github-actions-validator github-actions-validator
cd github-actions-validator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/github-actions-validator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { validateWorkflow } from '@fodt/github-actions-validator';

const result = validateWorkflow(text);
if (!result.valid) {
  for (const finding of result.findings) {
    console.log(finding.line, finding.path, finding.message);
  }
}
```

`validateWorkflow` always returns a `WorkflowValidateResult` -- `valid`, `findings`, `jobs`, `events` and `schemaCommit` -- never throws for a structurally invalid document; it only throws `WorkflowValidatorError`/`YamlSourceError` for a YAML syntax error or a document over the size, alias or depth limit, since those cannot be reported as ordinary findings. Every finding carries a 1-based `line` and `column`, a dotted `path`, an RFC 6901 `pointer`, and a `severity` of `error` or `warning`.

## Dependencies

- `yaml` 2.9.1
- `ajv` 8.20.0

## Tests

```sh
npm test
```

Correctness is checked two ways: schema conformance against the official SchemaStore workflow schema (bundled at a pinned commit, exercised over SchemaStore's own positive and negative test fixtures and fourteen real starter workflows from actions/starter-workflows), and this tool's own event/needs-graph/step-id/expression checks, each cited to the GitHub documentation page it enforces. The bundled schema is proven identical to a fresh build from the vendored upstream file, and every vendored upstream file is proven identical to its recorded git blob SHA.

## Licence

MIT. See [LICENSE](./LICENSE).
