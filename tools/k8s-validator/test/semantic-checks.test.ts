import { it, expect } from 'vitest';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifests } from '../src/index';

const BROKEN_DIR = join(__dirname, 'fixtures', 'broken');
const EXAMPLES_DIR = join(__dirname, 'fixtures', 'k8s-examples');
const STANDALONE_DIR = join(__dirname, 'fixtures', 'k8s-schema-source', 'v1.35.0-standalone-strict');

it('a Deployment whose selector does not match its template labels is reported', () => {
  const text = readFileSync(join(BROKEN_DIR, '12-selector-mismatch.yml'), 'utf8');
  const result = validateManifests(text);
  expect(result.findings.some((f) => f.line === 10 && f.message.includes('does not match its own Pod template'))).toBe(
    true,
  );

  const goodText = readFileSync(join(EXAMPLES_DIR, 'Deployment.yaml'), 'utf8');
  const goodResult = validateManifests(goodText);
  expect(goodResult.findings.filter((f) => f.keyword === 'semantic')).toEqual([]);
});

it('a container without an image, a repeated container name or a port outside 1 to 65535 is reported', () => {
  const noImage = validateManifests(readFileSync(join(BROKEN_DIR, '13-container-no-image.yml'), 'utf8'));
  expect(noImage.findings.some((f) => f.message.includes('has no image'))).toBe(true);

  const dupName = validateManifests(readFileSync(join(BROKEN_DIR, '14-duplicate-container-name.yml'), 'utf8'));
  expect(dupName.findings.some((f) => f.message.includes('already used earlier in this Pod template'))).toBe(true);

  const badPort = validateManifests(readFileSync(join(BROKEN_DIR, '15-port-out-of-range.yml'), 'utf8'));
  expect(badPort.findings.some((f) => f.message.includes('must be between 1 and 65535'))).toBe(true);
});

it('an object without metadata name or generateName, or with a name the naming rules forbid, is reported', () => {
  const noName = validateManifests(readFileSync(join(BROKEN_DIR, '16-missing-name.yml'), 'utf8'));
  expect(noName.findings.some((f) => f.message.includes('no usable name'))).toBe(true);

  const badName = validateManifests('apiVersion: v1\nkind: Namespace\nmetadata:\n  name: Not_Valid_DNS\nspec: {}\n');
  expect(badName.findings.some((f) => f.message.includes('does not follow'))).toBe(true);

  const goodName = validateManifests('apiVersion: v1\nkind: Namespace\nmetadata:\n  name: valid-name\n');
  expect(goodName.findings.filter((f) => f.message.includes('does not follow'))).toEqual([]);
});

it('a known kind with an apiVersion Kubernetes 1.35 does not serve is reported with the served version', () => {
  const result = validateManifests(readFileSync(join(BROKEN_DIR, '17-removed-apiversion.yml'), 'utf8'));
  expect(
    result.findings.some(
      (f) =>
        f.message.includes('Kubernetes v1.16 stopped serving Deployment extensions/v1beta1') &&
        f.message.includes('apps/v1'),
    ),
  ).toBe(true);
  expect(result.documents[0]!.checked).toBe(false);
  expect(result.valid).toBe(false);
});

/**
 * The vendored standalone-strict variant is fully self-contained (no
 * external `$ref`) but still carries the same non-standard
 * `"$schema": "http://json-schema.org/schema#"` value every non-standalone
 * kind file does; stripped here for the same reason the generator drops it
 * from the bundled subset (confirmed harmless either way by the Task 1
 * spike). Nothing else about the standalone-strict file is touched -- it is
 * used exactly as upstream ships it, as an independent second opinion on
 * whether this tool's own rewritten-and-strict-ified subset agrees with
 * upstream's own self-contained, `additionalProperties: false`-everywhere
 * schema for the same three kinds.
 */
function compileStandaloneStrict(kind: string): ValidateFunction {
  const fileByKind: Record<string, string> = {
    ConfigMap: 'configmap-v1.json',
    Service: 'service-v1.json',
    Deployment: 'deployment-apps-v1.json',
  };
  const text = readFileSync(join(STANDALONE_DIR, fileByKind[kind]!), 'utf8');
  const schema = JSON.parse(text) as Record<string, unknown>;
  delete schema.$schema;
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false, ownProperties: true, verbose: true });
  return ajv.compile(schema);
}

/** Whether this tool's own JSON-schema layer (excluding semantic findings, which the standalone-strict oracle cannot express either) considers `text` valid. */
function schemaOnlyValid(text: string): boolean {
  const result = validateManifests(text);
  return !result.findings.some((f) => f.severity === 'error' && f.keyword !== 'semantic');
}

it('for the vendored standalone strict files the subset gives the same verdict on every fixture of that kind', () => {
  const cases: { kind: string; file: string; dir: string; expectedValid: boolean }[] = [
    { kind: 'ConfigMap', file: 'ConfigMap.yaml', dir: EXAMPLES_DIR, expectedValid: true },
    { kind: 'ConfigMap', file: '07-configmap-data-number.yml', dir: BROKEN_DIR, expectedValid: false },
    { kind: 'Service', file: 'Service.yaml', dir: EXAMPLES_DIR, expectedValid: true },
    { kind: 'Service', file: '06-wrong-type-service-port.yml', dir: BROKEN_DIR, expectedValid: false },
    { kind: 'Deployment', file: 'Deployment.yaml', dir: EXAMPLES_DIR, expectedValid: true },
    { kind: 'Deployment', file: '01-missing-selector.yml', dir: BROKEN_DIR, expectedValid: false },
    { kind: 'Deployment', file: '03-string-replicas.yml', dir: BROKEN_DIR, expectedValid: false },
  ];

  for (const testCase of cases) {
    const text = readFileSync(join(testCase.dir, testCase.file), 'utf8');
    const upstreamValidate = compileStandaloneStrict(testCase.kind);
    const parsed: unknown = parseYaml(text);
    const upstreamValid = upstreamValidate(parsed) as boolean;
    const thisToolValid = schemaOnlyValid(text);

    expect(upstreamValid, `${testCase.file}: upstream standalone-strict verdict`).toBe(testCase.expectedValid);
    expect(thisToolValid, `${testCase.file}: this tool's own schema verdict`).toBe(testCase.expectedValid);
    expect(thisToolValid, `${testCase.file}: this tool and the upstream standalone-strict schema must agree`).toBe(
      upstreamValid,
    );
  }
});
