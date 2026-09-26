/**
 * Test-side generator for `src/k8s-schema-subset.ts`: builds a self-contained
 * schema subset for the twelve bundled Kubernetes kinds from the vendored
 * upstream files under `test/fixtures/k8s-schema-source/`, so a required test
 * can assert the committed module is exactly what a fresh build produces --
 * never edited by hand out of sync with the vendored files it comes from.
 *
 * The upstream files (`yannh/kubernetes-json-schema`, Apache License, Version
 * 2.0) ship two things this generator needs: twelve small per-kind files
 * (`v1.35.0/<kind>.json`) whose own `apiVersion`/`kind` properties are pinned
 * to an `enum` of exactly that kind's values, and one shared
 * `v1.35.0/_definitions.json` (1,393,715 bytes, 735 definitions) that every
 * sub-schema (`ObjectMeta`, `PodSpec`, `Container`, ...) lives in. Every
 * per-kind file `$ref`s into `_definitions.json` by an ABSOLUTE
 * `https://raw.githubusercontent.com/...` URL -- fatal for a tool that may
 * make zero network requests (confirmed directly this session: compiling an
 * unmodified kind file with the pinned `ajv@8.20.0` throws `MissingRefError:
 * can't resolve reference https://raw.githubusercontent.com/... from id #`,
 * not a `$schema`-related error -- the non-standard
 * `"$schema": "http://json-schema.org/schema#"` every kind file declares is
 * silently tolerated by this project's pinned Ajv version in every mode
 * tried, strict or not, so `ajv-draft-04` is never needed here).
 *
 * This generator computes the transitive closure of every `$ref` reachable
 * from the twelve kind files (190 definitions for this pinned version, not
 * all 735 in `_definitions.json`), rewrites every absolute reference to a
 * local `#/definitions/<name>` pointer, drops the non-standard `$schema` key
 * (harmless to keep per the spike above, but the bundled file should not
 * repeat a value that means nothing to the Ajv version that reads it),
 * removes `description` annotations (no effect on validation, and the single
 * largest source of bundled bytes), and applies the upstream generator's own
 * documented strict-mode rule: `yannh/openapi2jsonschema`'s
 * `additional_properties()` function (`openapi2jsonschema/util.py`, fetched
 * at commit 09bbcef0ed5f0f70ee033834637e10e7035b6787 this session, Apache
 * License, Version 2.0) sets `additionalProperties: false` on "any dict that
 * has a 'properties' key and no existing 'additionalProperties' key" --
 * quoted from its own docstring, which itself credits kubectl's own
 * pre-`kubectl apply` client-side schema validation
 * (`pkg/kubectl/validation/schema.go`) as the behaviour it recreates. This
 * generator applies that identical rule, with one addition beyond upstream's
 * literal code: a definition marked `x-kubernetes-preserve-unknown-fields:
 * true` (used four times in this pinned snapshot, all in fields Kubernetes
 * itself defines as deliberately open, such as a CustomResourceDefinition's
 * schema-less status) is left alone, since forcing `additionalProperties:
 * false` there would reject fields Kubernetes' own API server accepts by
 * design -- a deliberate, disclosed extension of upstream's own rule, not a
 * deviation from what it validates for the twelve bundled kinds (none of
 * which use that marker themselves).
 *
 * Only writes `src/k8s-schema-subset.ts` back to disk when
 * `process.env.FODT_REGENERATE === '1'`; every other run is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SOURCE_DIR = join(ROOT, 'test', 'fixtures', 'k8s-schema-source');
const OUTPUT_PATH = join(ROOT, 'src', 'k8s-schema-subset.ts');

export const K8S_SCHEMA_VERSION = 'v1.35.0';
export const K8S_SCHEMA_COMMIT = 'a6f9a32d2ccb64b6e4f5b41419b9c2e8ee0cce18';

/** The twelve bundled kinds and the upstream file each one comes from (D-101). */
export const KIND_SOURCE_FILES: Readonly<Record<string, string>> = {
  Pod: 'pod-v1.json',
  Deployment: 'deployment-apps-v1.json',
  StatefulSet: 'statefulset-apps-v1.json',
  DaemonSet: 'daemonset-apps-v1.json',
  Job: 'job-batch-v1.json',
  CronJob: 'cronjob-batch-v1.json',
  Service: 'service-v1.json',
  Ingress: 'ingress-networking-v1.json',
  ConfigMap: 'configmap-v1.json',
  Secret: 'secret-v1.json',
  PersistentVolumeClaim: 'persistentvolumeclaim-v1.json',
  Namespace: 'namespace-v1.json',
};

export interface KindEntry {
  apiVersion: string;
  kind: string;
  /** The key this kind's own (rewritten, strict) schema is stored under in `K8S_SCHEMA_SUBSET.definitions`. */
  definition: string;
}

export interface SchemaSubsetStats {
  /** Bytes of every vendored source file read (the twelve kind files plus `_definitions.json`). */
  sourceBytes: number;
  /** Number of definitions in the computed reference closure (excluding the twelve kind entries themselves). */
  closureSize: number;
  /** Bytes of the bundled `{ definitions }` object once minified to JSON. */
  bundledBytes: number;
}

export interface SchemaSubsetResult {
  schema: { definitions: Record<string, unknown> };
  kinds: KindEntry[];
  stats: SchemaSubsetStats;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Extracts the trailing `#/definitions/<name>` segment of an absolute `$ref` URL, decoding any percent-escapes. */
function refKeyFromAbsolute(ref: string): string | undefined {
  const marker = '#/definitions/';
  const idx = ref.indexOf(marker);
  if (idx === -1) return undefined;
  return decodeURIComponent(ref.slice(idx + marker.length));
}

function collectRefs(node: JsonValue, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
    return;
  }
  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const refKey = refKeyFromAbsolute(value);
        if (refKey) into.add(refKey);
        else if (!value.startsWith('#')) {
          throw new Error(`Found a $ref this generator cannot rewrite to a local pointer: ${value}`);
        }
      } else {
        collectRefs(value, into);
      }
    }
  }
}

/** Drops `$schema` and `description`, rewrites every absolute `$ref` to `#/definitions/<name>`, leaves every other keyword unchanged. */
function rewrite(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(rewrite);
  if (isRecord(node)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' || key === 'description') continue;
      if (key === '$ref' && typeof value === 'string') {
        const refKey = refKeyFromAbsolute(value);
        out[key] = refKey ? `#/definitions/${refKey}` : value;
        continue;
      }
      out[key] = rewrite(value);
    }
    return out;
  }
  return node;
}

/**
 * Upstream's own strict rule (`openapi2jsonschema/util.py`'s
 * `additional_properties()`, quoted in this file's header), plus this
 * generator's disclosed extension: skip a definition explicitly marked
 * `x-kubernetes-preserve-unknown-fields: true`.
 */
function applyStrict(node: JsonValue): void {
  if (Array.isArray(node)) {
    for (const item of node) applyStrict(item);
    return;
  }
  if (isRecord(node)) {
    if (
      isRecord(node.properties as JsonValue) &&
      node.additionalProperties === undefined &&
      node['x-kubernetes-preserve-unknown-fields'] !== true
    ) {
      node.additionalProperties = false;
    }
    for (const value of Object.values(node)) applyStrict(value);
  }
}

function assertNoRemoteRefs(node: JsonValue, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoRemoteRefs(item, `${path}[${i}]`));
    return;
  }
  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('http')) {
        throw new Error(`A remote $ref survived rewriting at ${path}: ${value}`);
      }
      assertNoRemoteRefs(value, `${path}.${key}`);
    }
  }
}

/** Reads the kind's own `x-kubernetes-group-version-kind` entry and builds its `apiVersion` string. */
function apiVersionAndKind(kindSchema: { [key: string]: JsonValue }): { apiVersion: string; kind: string } {
  const gvkList = kindSchema['x-kubernetes-group-version-kind'];
  if (!Array.isArray(gvkList) || gvkList.length === 0 || !isRecord(gvkList[0]!)) {
    throw new Error('Kind schema has no x-kubernetes-group-version-kind entry.');
  }
  const gvk = gvkList[0];
  const group = String(gvk.group ?? '');
  const version = String(gvk.version ?? '');
  const kind = String(gvk.kind ?? '');
  return { apiVersion: group ? `${group}/${version}` : version, kind };
}

/**
 * Pure build function: reads the vendored kind files and `_definitions.json`
 * from `sourceDir`, computes the reference closure over the twelve kinds,
 * rewrites and strict-ifies every definition, and returns the bundled
 * `{ definitions }` schema, the twelve `KindEntry` records and size stats.
 * Throws if a reference falls outside the closure or a remote `$ref` survives
 * rewriting.
 */
export function buildSchemaSubset(sourceDir: string): SchemaSubsetResult {
  const definitionsPath = join(sourceDir, K8S_SCHEMA_VERSION, '_definitions.json');
  const definitionsText = readFileSync(definitionsPath, 'utf8');
  const definitionsDoc = JSON.parse(definitionsText) as { definitions: { [key: string]: JsonValue } };
  const allDefs = definitionsDoc.definitions;

  let sourceBytes = Buffer.byteLength(definitionsText, 'utf8');

  const kindSchemas: { [kind: string]: { [key: string]: JsonValue } } = {};
  for (const [kind, file] of Object.entries(KIND_SOURCE_FILES)) {
    const filePath = join(sourceDir, K8S_SCHEMA_VERSION, file);
    const text = readFileSync(filePath, 'utf8');
    sourceBytes += Buffer.byteLength(text, 'utf8');
    kindSchemas[kind] = JSON.parse(text) as { [key: string]: JsonValue };
  }

  // Compute the transitive reference closure reachable from the twelve kinds.
  const closure = new Set<string>();
  const queue: string[] = [];
  for (const schema of Object.values(kindSchemas)) {
    const refs = new Set<string>();
    collectRefs(schema, refs);
    for (const ref of refs) queue.push(ref);
  }
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (closure.has(key)) continue;
    closure.add(key);
    const def = allDefs[key];
    if (def === undefined) {
      throw new Error(`_definitions.json has no entry for a reference this generator followed: ${key}`);
    }
    const refs = new Set<string>();
    collectRefs(def, refs);
    for (const ref of refs) queue.push(ref);
  }

  const definitions: { [key: string]: JsonValue } = {};
  for (const key of closure) {
    definitions[key] = rewrite(allDefs[key]!);
  }

  const kinds: KindEntry[] = [];
  for (const [kind, schema] of Object.entries(kindSchemas)) {
    const rewritten = rewrite(schema) as { [key: string]: JsonValue };
    const { apiVersion, kind: kindName } = apiVersionAndKind(schema);
    definitions[kind] = rewritten;
    kinds.push({ apiVersion, kind: kindName, definition: kind });
  }

  for (const key of Object.keys(definitions)) applyStrict(definitions[key]!);

  for (const key of Object.keys(definitions)) assertNoRemoteRefs(definitions[key]!, key);

  const schema = { definitions };
  const bundledBytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');

  return { schema, kinds, stats: { sourceBytes, closureSize: closure.size, bundledBytes } };
}

/** Renders `src/k8s-schema-subset.ts`'s exact source text from a built result. */
export function renderSchemaSubsetModule(result: SchemaSubsetResult): string {
  return [
    '/**',
    ' * A self-contained schema subset for the twelve Kubernetes kinds this tool',
    ' * checks, bundled from the OpenAPI-derived JSON Schemas at',
    ` * yannh/kubernetes-json-schema (Apache License, Version 2.0) pinned to`,
    ` * ${K8S_SCHEMA_VERSION} at commit ${K8S_SCHEMA_COMMIT}. Every reference has been`,
    ' * rewritten to a local #/definitions/<name> pointer -- nothing here is ever',
    ' * fetched at runtime. See test/build-schema-subset.ts for the generator this',
    ' * module must equal, and src/k8s-schema-subset-NOTICE.txt for the full',
    ' * attribution notice and the list of transformations applied.',
    ' */',
    '',
    `export const K8S_SCHEMA_VERSION = ${JSON.stringify(K8S_SCHEMA_VERSION)};`,
    `export const K8S_SCHEMA_COMMIT = ${JSON.stringify(K8S_SCHEMA_COMMIT)};`,
    '',
    `export const K8S_SCHEMA_SUBSET: Readonly<{ definitions: Record<string, unknown> }> = ${JSON.stringify(result.schema, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  const result = buildSchemaSubset(SOURCE_DIR);
  writeFileSync(OUTPUT_PATH, renderSchemaSubsetModule(result));
  console.log(
    `Wrote ${OUTPUT_PATH}: source ${result.stats.sourceBytes} bytes, closure ${result.stats.closureSize} definitions, bundled ${result.stats.bundledBytes} bytes.`,
  );
}
