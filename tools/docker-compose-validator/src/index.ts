import meta from './meta.json';
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import {
  readYaml,
  locatePointer,
  findingsFromAjvErrors,
  pointerToPath,
  YamlSourceError,
  type YamlFinding,
} from './yaml-source';
import { COMPOSE_SPEC_SCHEMA, COMPOSE_SPEC_COMMIT } from './compose-spec-schema';

export { meta, YamlSourceError };
export type { YamlFinding };

export interface ComposeValidateResult {
  valid: boolean;
  findings: YamlFinding[];
  services: string[];
  schemaCommit: string;
}

export class ComposeValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeValidatorError';
  }
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerFrom(tokens: (string | number)[]): string {
  if (tokens.length === 0) return '';
  return '/' + tokens.map((t) => escapeToken(String(t))).join('/');
}

/**
 * The accepted `${...}` interpolation forms, quoted from the Compose
 * Specification's own Interpolation section (spec.md, fetched at
 * COMPOSE_SPEC_COMMIT): "${VARIABLE:-default}", "${VARIABLE-default}",
 * "${VARIABLE:?err}", "${VARIABLE?err}", and nesting such as
 * "${VARIABLE:-${FOO}}". A bare "$VARIABLE" or an escaped "$$" needs no
 * further check here.
 */
const INTERPOLATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTERPOLATION_OPERATORS = [':-', '-', ':?', '?', ':+', '+'];

interface InterpolationProblem {
  index: number;
  message: string;
}

/** Scans one string value for a malformed `${...}` interpolation, per the compose-spec syntax quoted above. Returns the first problem found, or undefined. */
function checkInterpolation(text: string): InterpolationProblem | undefined {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$') continue;
    if (text[i + 1] === '$') {
      i++; // "$$" is a literal dollar sign, never interpolated
      continue;
    }
    if (text[i + 1] !== '{') continue; // a bare "$NAME" reference needs no further syntax check

    let depth = 1;
    let j = i + 2;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) {
      return { index: i, message: 'This interpolation is missing its closing "}".' };
    }

    const inner = text.slice(i + 2, j - 1);
    if (inner === '') {
      return { index: i, message: 'This interpolation names no variable.' };
    }
    let matchedName = '';
    let rest = inner;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(inner);
    if (nameMatch) {
      matchedName = nameMatch[0];
      rest = inner.slice(matchedName.length);
    }
    if (!INTERPOLATION_NAME.test(matchedName)) {
      return {
        index: i,
        message: 'This interpolation does not start with a valid variable name ([_a-zA-Z][_a-zA-Z0-9]*).',
      };
    }
    if (rest !== '') {
      const hasOperator = INTERPOLATION_OPERATORS.some((op) => rest.startsWith(op));
      if (!hasOperator) {
        return {
          index: i,
          message:
            'This interpolation uses an operator this specification does not define. Accepted forms are ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:?err} and ${VAR?err}.',
        };
      }
    }
    i = j - 1;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads the referenced top-level names out of a service's short (array of strings, optionally "name:target") or long (mapping) attribute form. */
function referencedNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.split(':')[0]!;
        if (isRecord(item) && typeof item.source === 'string') return item.source;
        return undefined;
      })
      .filter((v): v is string => Boolean(v));
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

/**
 * Compose-spec-only checks the schema alone does not express: a reference to
 * an undeclared top-level network, volume, secret or config; a `depends_on`
 * entry naming no service; a malformed interpolation; the obsolete top-level
 * `version` key. Each is cited to the compose-spec section it enforces.
 */
function structuralFindings(value: unknown, docIndex: number, source: ReturnType<typeof readYaml>): YamlFinding[] {
  const findings: YamlFinding[] = [];
  if (!isRecord(value)) return findings;

  if (typeof value.version === 'string') {
    const pointer = pointerFrom(['version']);
    const pos = locatePointer(source, docIndex, pointer, { key: true });
    findings.push({
      line: pos.line,
      column: pos.column,
      path: pointerToPath(pointer),
      pointer,
      keyword: 'version',
      severity: 'warning',
      message:
        'The top-level "version" property is defined for backward compatibility only; the Compose Specification marks it obsolete.',
    });
  }

  const services = isRecord(value.services) ? value.services : {};
  const topNetworks = new Set(Object.keys(isRecord(value.networks) ? value.networks : {}));
  const topVolumes = new Set(Object.keys(isRecord(value.volumes) ? value.volumes : {}));
  const topSecrets = new Set(Object.keys(isRecord(value.secrets) ? value.secrets : {}));
  const topConfigs = new Set(Object.keys(isRecord(value.configs) ? value.configs : {}));
  const serviceNames = new Set(Object.keys(services));

  const referenceChecks: { field: string; declared: Set<string>; label: string }[] = [
    { field: 'networks', declared: topNetworks, label: 'network' },
    { field: 'volumes', declared: topVolumes, label: 'named volume' },
    { field: 'secrets', declared: topSecrets, label: 'secret' },
    { field: 'configs', declared: topConfigs, label: 'config' },
  ];

  for (const [serviceName, service] of Object.entries(services)) {
    if (!isRecord(service)) continue;

    for (const check of referenceChecks) {
      const raw = service[check.field];
      if (raw === undefined) continue;
      for (const name of referencedNames(raw)) {
        if (check.declared.has(name)) continue;
        if (check.field === 'volumes' && name.startsWith('.')) continue; // a bind mount path, not a named volume
        if (check.field === 'volumes' && (name.startsWith('/') || /^[A-Za-z]:/.test(name))) continue; // an absolute host path
        const pointer = pointerFrom(['services', serviceName, check.field]);
        const pos = locatePointer(source, docIndex, pointer);
        findings.push({
          line: pos.line,
          column: pos.column,
          path: pointerToPath(pointer),
          pointer,
          keyword: 'reference',
          severity: 'error',
          message: `This service refers to ${check.label} "${name}", which is not declared at the top level.`,
        });
      }
    }

    if (service.depends_on !== undefined) {
      for (const name of referencedNames(service.depends_on)) {
        if (serviceNames.has(name)) continue;
        const pointer = pointerFrom(['services', serviceName, 'depends_on']);
        const pos = locatePointer(source, docIndex, pointer);
        findings.push({
          line: pos.line,
          column: pos.column,
          path: pointerToPath(pointer),
          pointer,
          keyword: 'reference',
          severity: 'error',
          message: `This service depends on "${name}", which names no service in this file.`,
        });
      }
    }
  }

  // Interpolation: scan every string value in the document for a malformed ${...} reference.
  const walk = (node: unknown, tokens: (string | number)[]): void => {
    if (typeof node === 'string') {
      const problem = checkInterpolation(node);
      if (problem) {
        const pointer = pointerFrom(tokens);
        const pos = locatePointer(source, docIndex, pointer);
        findings.push({
          line: pos.line,
          column: pos.column,
          path: pointerToPath(pointer),
          pointer,
          keyword: 'interpolation',
          severity: 'error',
          message: problem.message,
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...tokens, i]));
      return;
    }
    if (isRecord(node)) {
      for (const key of Object.keys(node)) walk(node[key], [...tokens, key]);
    }
  };
  walk(value, []);

  return findings;
}

/**
 * Validates `text` (a Compose file) against the pinned compose-spec JSON
 * Schema, plus this project's own reference, interpolation and obsolete-key
 * checks. Never throws for a structurally invalid document -- a syntax error
 * (thrown by `readYaml`) is the only way this function raises.
 */
export function validateCompose(text: string): ComposeValidateResult {
  const source = readYaml(text, { merge: true });
  const entry = source.documents[0];
  const value = entry?.value;

  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false, ownProperties: true, verbose: true });
  let validateFn;
  try {
    validateFn = ajv.compile(COMPOSE_SPEC_SCHEMA as object);
  } catch (err) {
    throw new ComposeValidatorError(
      err instanceof Error ? err.message : 'The compose-spec schema could not be compiled.',
    );
  }

  const valid = validateFn(value) as boolean;
  const ajvErrors = (validateFn.errors ?? []) as ErrorObject[];
  const schemaFindings = findingsFromAjvErrors(source, 0, ajvErrors);
  const extraFindings = structuralFindings(value, 0, source);

  const findings = [...schemaFindings, ...extraFindings].sort((a, b) => a.line - b.line || a.column - b.column);
  const services = isRecord(value) && isRecord(value.services) ? Object.keys(value.services) : [];
  const hasErrors = findings.some((f) => f.severity === 'error');

  return { valid: valid && !hasErrors, findings, services, schemaCommit: COMPOSE_SPEC_COMMIT };
}
