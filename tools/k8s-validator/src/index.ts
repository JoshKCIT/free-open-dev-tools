import meta from './meta.json';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import {
  readYaml,
  locatePointer,
  findingsFromAjvErrors,
  pointerToPath,
  YamlSourceError,
  type YamlFinding,
  type ReadYamlResult,
} from './yaml-source';
import { K8S_SCHEMA_SUBSET, K8S_SCHEMA_VERSION, K8S_SCHEMA_COMMIT } from './k8s-schema-subset';
import { KINDS, REMOVED_API_VERSIONS } from './kinds';
import { semanticFindings } from './semantic-checks';

export { meta, YamlSourceError };
export type { YamlFinding };

export class K8sValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'K8sValidatorError';
  }
}

export interface K8sDocumentResult {
  /** The YAML document (0-based, `---`-separated) this resource came from. */
  index: number;
  /** 1-based line this resource's own mapping starts at. */
  line: number;
  apiVersion?: string;
  kind?: string;
  name?: string;
  /** False when `kind`/`apiVersion` names no bundled schema; the overall result is never `valid` while this is false for any resource. */
  checked: boolean;
}

export interface K8sValidateResult {
  valid: boolean;
  findings: YamlFinding[];
  documents: K8sDocumentResult[];
  schemaVersion: string;
  schemaCommit: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Ajv errors are plain data; this shifts a validated value's own relative `instancePath` back onto the whole document, so `findingsFromAjvErrors`' `locatePointer` call resolves against the real YAML tree (used for a `v1` `List`'s items). */
function prefixErrors(errors: ErrorObject[], prefix: string): ErrorObject[] {
  if (prefix === '') return errors;
  return errors.map((e) => ({ ...e, instancePath: prefix + e.instancePath }));
}

/**
 * Validates one resource value (a manifest document, or one item of a `v1`
 * `List`) against the bundled schema subset for its own `apiVersion`/`kind`
 * pair, appending findings and one `K8sDocumentResult` per resource.
 */
function checkResource(
  value: unknown,
  pointerPrefix: string,
  docIndex: number,
  source: ReadYamlResult,
  ajv: Ajv,
  findings: YamlFinding[],
  documents: K8sDocumentResult[],
): void {
  const pos = locatePointer(source, docIndex, pointerPrefix, { key: true });
  const line = pos.line;

  if (!isRecord(value)) {
    findings.push({
      line,
      column: pos.column,
      path: pointerToPath(pointerPrefix),
      pointer: pointerPrefix,
      keyword: 'structure',
      severity: 'error',
      message: 'This resource is not a mapping, so it cannot be a Kubernetes manifest.',
    });
    documents.push({ index: docIndex, line, checked: false });
    return;
  }

  const apiVersion = typeof value.apiVersion === 'string' ? value.apiVersion : undefined;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  const name = isRecord(value.metadata) && typeof value.metadata.name === 'string' ? value.metadata.name : undefined;

  if (apiVersion === undefined || kind === undefined) {
    const missing =
      apiVersion === undefined && kind === undefined
        ? 'apiVersion" and "kind'
        : apiVersion === undefined
          ? 'apiVersion'
          : 'kind';
    findings.push({
      line,
      column: pos.column,
      path: pointerToPath(pointerPrefix),
      pointer: pointerPrefix,
      keyword: 'required',
      severity: 'error',
      message: `This resource is missing "${missing}", so it cannot be identified or checked.`,
    });
    documents.push({ index: docIndex, line, apiVersion, kind, name, checked: false });
    return;
  }

  // A v1 List is expanded into its own items rather than checked as a resource itself.
  if (apiVersion === 'v1' && kind === 'List') {
    const items = Array.isArray(value.items) ? value.items : [];
    items.forEach((item, i) => {
      checkResource(item, `${pointerPrefix}/items/${i}`, docIndex, source, ajv, findings, documents);
    });
    return;
  }

  const entry = KINDS.find((k) => k.apiVersion === apiVersion && k.kind === kind);

  if (!entry) {
    // A known kind under a removed apiVersion gets a specific, actionable
    // error instead of the generic not-checked note (this replaces it for
    // exactly these pairs, per the Deprecated API Migration Guide).
    const removed = REMOVED_API_VERSIONS.find((r) => r.kind === kind && r.removedApiVersion === apiVersion);
    if (removed) {
      const apiVersionPointer = `${pointerPrefix}/apiVersion`;
      const apiVersionPos = locatePointer(source, docIndex, apiVersionPointer, { key: true });
      findings.push({
        line: apiVersionPos.line,
        column: apiVersionPos.column,
        path: pointerToPath(apiVersionPointer),
        pointer: apiVersionPointer,
        keyword: 'removed-api-version',
        severity: 'error',
        message: `Kubernetes ${removed.removedInRelease} stopped serving ${kind} ${removed.removedApiVersion}. Use ${removed.servedApiVersion} instead.`,
      });
      documents.push({ index: docIndex, line, apiVersion, kind, name, checked: false });
      return;
    }

    findings.push({
      line,
      column: pos.column,
      path: pointerToPath(pointerPrefix),
      pointer: pointerPrefix,
      keyword: 'not-checked',
      severity: 'warning',
      message: `${kind} ${apiVersion} is not one of the twelve kinds this tool checks, so it was not checked.`,
    });
    documents.push({ index: docIndex, line, apiVersion, kind, name, checked: false });
    return;
  }

  const validateFn = ajv.getSchema(`k8s#/definitions/${entry.definition}`);
  if (!validateFn) {
    throw new K8sValidatorError(`The bundled schema subset has no compiled validator for "${entry.definition}".`);
  }
  const isValid = validateFn(value) as boolean;
  const rawErrors = prefixErrors((validateFn.errors ?? []) as ErrorObject[], pointerPrefix);
  findings.push(...findingsFromAjvErrors(source, docIndex, rawErrors));
  findings.push(...semanticFindings(source, docIndex, pointerPrefix, value, entry));

  documents.push({ index: docIndex, line, apiVersion, kind, name, checked: true });
  void isValid; // errors array already carries every problem; the boolean itself is not needed beyond that.
}

/**
 * Validates `text` (one or more `---`-separated Kubernetes manifests) against
 * the bundled schema subset for the twelve common kinds, plus the semantic
 * checks a schema alone cannot express. Never throws for a structurally
 * invalid manifest -- a YAML syntax error, or a document over the size, alias
 * or depth limit (thrown by `readYaml`), is the only way this function
 * raises. `valid` is never `true` while any resource has `checked: false`.
 */
export function validateManifests(text: string): K8sValidateResult {
  const source = readYaml(text, { multiDocument: true });

  const ajv = new Ajv({ allErrors: true, strict: false, logger: false, ownProperties: true, verbose: true });
  ajv.addSchema(K8S_SCHEMA_SUBSET as object, 'k8s');

  const findings: YamlFinding[] = [];
  const documents: K8sDocumentResult[] = [];

  for (const entry of source.documents) {
    if (entry.value === null || entry.value === undefined) continue; // an empty document between two --- markers
    checkResource(entry.value, '', entry.index, source, ajv, findings, documents);
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  const hasErrors = findings.some((f) => f.severity === 'error');
  const allChecked = documents.every((d) => d.checked);

  return {
    valid: !hasErrors && allChecked,
    findings,
    documents,
    schemaVersion: K8S_SCHEMA_VERSION,
    schemaCommit: K8S_SCHEMA_COMMIT,
  };
}
