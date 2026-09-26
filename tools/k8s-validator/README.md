# Kubernetes Manifest Validator

Check Kubernetes manifests for required fields and obvious errors.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks one or more Kubernetes manifests, separated by --- , against a bundled subset of the official OpenAPI-derived JSON Schemas for the twelve most common kinds (Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, Service, Ingress, ConfigMap, Secret, PersistentVolumeClaim, Namespace), pinned to Kubernetes v1.35.0. Every problem is reported at its line, column and key path -- a missing required field, an unrecognised field, a wrong type, a Deployment selector that does not match its own template labels, a container with no image, a repeated container name, a port outside 1 to 65535, an object with no usable name, and an apiVersion Kubernetes 1.35 no longer serves. Nothing about the manifest is sent anywhere; validation runs entirely in this tab, in a background worker so a pathological file cannot freeze it.

## Supported

- The twelve most common Kubernetes kinds, checked against a bundled, self-contained subset of the official OpenAPI-derived JSON Schemas for Kubernetes v1.35.0
- Multiple manifests in one paste, separated by --- , with line numbers counted across the whole file
- A v1 List whose items are checked one by one
- A Deployment, StatefulSet or DaemonSet selector checked against its own Pod template labels
- Every container and init container checked for a declared image and a name unique within its Pod template
- Every containerPort, hostPort, Service port and targetPort checked against the 1-65535 range
- An apiVersion Kubernetes 1.35 no longer serves, reported with the version it was replaced by and the release that removed it
- Any kind outside the bundled twelve reported as not checked, never shown as valid

## Limits

- This tool cannot check what the real cluster's API server, admission webhooks, policies or CustomResourceDefinitions would accept -- only applying the manifest to a real cluster, or a server-side dry run, can show that.
- Only the twelve bundled kinds are checked against a schema; every other kind (for example HorizontalPodAutoscaler or a CustomResourceDefinition instance) is reported as not checked, and the overall result is never shown as valid while any document was not checked.
- The bundled schema is a snapshot of the OpenAPI-derived JSON Schemas at Kubernetes v1.35.0, pinned commit a6f9a32; a change published upstream afterwards, or a different Kubernetes minor version, is not reflected here.
- This tool cannot tell whether the visitor's own cluster runs a different Kubernetes minor version that accepts or rejects a field differently than v1.35 does.

## Ambiguous cases, and what this does about them

- The bundled schema's own Container definition marks image optional ('This field is optional to allow higher level config management to default or override container images in workload controllers'), so a container with no image validates against the schema with no error. This tool still reports it as an obvious mistake (a container without an image cannot run), since it has no way to know whether the visitor's own tooling injects one later.
- Object naming rules are simplified to two buckets rather than modelling every kind's own fine print: the DNS Subdomain Name rule (RFC 1123, at most 253 characters) is applied to every bundled kind except Service, which Kubernetes documents separately under the RFC 1123 Label Name rule (at most 63 characters, conventionally starting with a letter); the RelaxedServiceNameValidation feature gate, which lets a Service name start with a digit on clusters that enable it, is not modelled.
- YAML merge keys (<<) are not applied when reading a manifest, since no fetched Kubernetes documentation describes merge-key semantics for a manifest the way some other formats' own specifications describe merge keys for themselves; a manifest using << is read literally.

## Defined by

- [Kubernetes API Reference v1.35](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.35/)
- [yannh/kubernetes-json-schema (OpenAPI-derived JSON Schemas)](https://github.com/yannh/kubernetes-json-schema/tree/a6f9a32d2ccb64b6e4f5b41419b9c2e8ee0cce18)
- [YAML 1.2.2](https://yaml.org/spec/1.2.2/)
- [RFC 6901 (JSON Pointer)](https://www.rfc-editor.org/rfc/rfc6901)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Kubernetes OpenAPI-derived JSON Schema subset (twelve kinds, v1.35.0)** (Apache-2.0) — [source](https://github.com/yannh/kubernetes-json-schema). "Kubernetes JSON Schema" by Gareth Rushgrove and Yann Hamon, licensed under the Apache License, Version 2.0. Snapshot taken at commit a6f9a32d2ccb64b6e4f5b41419b9c2e8ee0cce18, Kubernetes v1.35.0, rewritten to a self-contained local-reference subset by this project's own committed generator (see src/k8s-schema-subset-NOTICE.txt).

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/k8s-validator k8s-validator
cd k8s-validator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/k8s-validator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { validateManifests } from '@fodt/k8s-validator';

const result = validateManifests(text);
for (const doc of result.documents) {
  if (!doc.checked) console.log(doc.kind, 'was not checked');
}
for (const finding of result.findings) {
  console.log(finding.line, finding.path, finding.message);
}
```

`validateManifests` always returns a `K8sValidateResult` -- `valid`, `findings`, `documents` (one entry per YAML document with `index`, `line`, `apiVersion`, `kind`, `name`, `checked`) and `schemaVersion` -- never throws for a structurally invalid manifest; it only throws `K8sValidatorError`/`YamlSourceError` for a YAML syntax error or a document over the size, alias or depth limit. `valid` is never true while any document has `checked: false`.

## Dependencies

- `yaml` 2.9.1
- `ajv` 8.20.0

## Tests

```sh
npm test
```

Correctness is checked three ways: schema conformance against the bundled subset (proven reproducible from the vendored upstream files by a required test), semantic checks each cited to the Kubernetes documentation page it enforces, and a differential test against the vendored standalone-strict variant of three kinds (ConfigMap, Service, Deployment) confirming this tool's rewritten subset gives the same valid-or-invalid verdict upstream's own self-contained schema does. Every vendored upstream file is proven identical to its recorded git blob SHA.

## Licence

MIT. See [LICENSE](./LICENSE).
