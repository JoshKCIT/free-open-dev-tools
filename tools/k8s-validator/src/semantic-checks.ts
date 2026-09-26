/**
 * The obvious mistakes a JSON Schema cannot express, run after schema
 * validation on each document the bundled subset actually checks. Every
 * finding is cited to the Kubernetes documentation page it enforces; none of
 * these rules exist in `k8s-schema-subset.ts` because a JSON Schema has no
 * way to compare two different parts of the same document (a selector
 * against template labels), express "at least one of these two optional
 * fields must differ from every sibling" (a repeated container name), or
 * express a numeric range at all here (Kubernetes' own schema only documents
 * the 1-65535 port range in `description` text, which this project strips
 * when bundling -- see k8s-schema-subset-NOTICE.txt).
 */
import { locatePointer, pointerToPath, type YamlFinding, type ReadYamlResult } from './yaml-source';
import type { KindEntry } from './kinds';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerFrom(prefix: string, tokens: (string | number)[]): string {
  if (tokens.length === 0) return prefix;
  return prefix + '/' + tokens.map((t) => escapeToken(String(t))).join('/');
}

function finding(
  source: ReadYamlResult,
  docIndex: number,
  pointer: string,
  message: string,
  options: { key?: boolean; severity?: 'error' | 'warning' } = {},
): YamlFinding {
  const pos = locatePointer(source, docIndex, pointer, { key: options.key ?? false });
  return {
    line: pos.line,
    column: pos.column,
    path: pointerToPath(pointer),
    pointer,
    keyword: 'semantic',
    severity: options.severity ?? 'error',
    message,
  };
}

interface ContainerLocation {
  /** The pointer to the podSpec (`spec` for a Pod, `spec.template.spec` for a controller, `spec.jobTemplate.spec.template.spec` for a CronJob). */
  pointer: string;
  podSpec: Record<string, unknown>;
}

/**
 * Resolves the pod spec(s) a kind's own manifest embeds, per the Kubernetes
 * API reference v1.35: a Pod's own `spec`; a Deployment, StatefulSet,
 * DaemonSet or Job's `spec.template.spec`; a CronJob's
 * `spec.jobTemplate.spec.template.spec`. Every other bundled kind (Service,
 * Ingress, ConfigMap, Secret, PersistentVolumeClaim, Namespace) embeds no pod
 * spec and returns none.
 */
function podSpecsOf(kind: string, value: Record<string, unknown>, prefix: string): ContainerLocation[] {
  const at = (pointer: string, node: unknown): ContainerLocation[] =>
    isRecord(node) ? [{ pointer, podSpec: node }] : [];

  switch (kind) {
    case 'Pod':
      return at(pointerFrom(prefix, ['spec']), value.spec);
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'Job': {
      const template = isRecord(value.spec) ? value.spec.template : undefined;
      return at(pointerFrom(prefix, ['spec', 'template', 'spec']), isRecord(template) ? template.spec : undefined);
    }
    case 'CronJob': {
      const jobTemplate = isRecord(value.spec) ? value.spec.jobTemplate : undefined;
      const jobSpec = isRecord(jobTemplate) ? jobTemplate.spec : undefined;
      const podTemplate = isRecord(jobSpec) ? jobSpec.template : undefined;
      return at(
        pointerFrom(prefix, ['spec', 'jobTemplate', 'spec', 'template', 'spec']),
        isRecord(podTemplate) ? podTemplate.spec : undefined,
      );
    }
    default:
      return [];
  }
}

/**
 * The Deployment page's own words on what `.spec.selector` must satisfy
 * (`kubernetes.io/docs/concepts/workloads/controllers/deployment/`, fetched
 * 2026-09-26): "The .spec.selector field defines how the created ReplicaSet
 * finds which Pods to manage. ... as long as the Pod template itself
 * satisfies the rule." and "The .spec.selector.matchLabels field is a map of
 * {key,value} pairs. ... All of the requirements, from both matchLabels and
 * matchExpressions, must be satisfied in order to match." Job and CronJob
 * generate their own selector from the Job's own UID rather than accepting
 * one a manifest writes, so this check does not apply to them.
 */
function selectorFindings(
  source: ReadYamlResult,
  docIndex: number,
  kind: string,
  value: Record<string, unknown>,
  prefix: string,
): YamlFinding[] {
  if (kind !== 'Deployment' && kind !== 'StatefulSet' && kind !== 'DaemonSet') return [];
  const spec = isRecord(value.spec) ? value.spec : undefined;
  const selector = isRecord(spec?.selector) ? spec!.selector : undefined;
  const matchLabels = isRecord(selector?.matchLabels) ? selector!.matchLabels : undefined;
  if (!matchLabels) return []; // a missing/malformed selector is already a schema finding

  const template = isRecord(spec!.template) ? spec!.template : undefined;
  const templateLabels =
    isRecord(template?.metadata) && isRecord(template!.metadata.labels)
      ? (template!.metadata.labels as Record<string, unknown>)
      : {};

  const mismatched = Object.entries(matchLabels).some(([key, val]) => templateLabels[key] !== val);
  if (!mismatched) return [];

  const pointer = pointerFrom(prefix, ['spec', 'selector']);
  return [
    finding(
      source,
      docIndex,
      pointer,
      `This ${kind}'s selector does not match its own Pod template labels -- every key/value pair in spec.selector.matchLabels must also appear in spec.template.metadata.labels.`,
    ),
  ];
}

/**
 * The Pod/Container pages' own words (`kubernetes.io/docs/concepts/workloads/pods/`,
 * fetched 2026-09-26) and the bundled Container definition's own description
 * ("This field is optional to allow higher level config management to
 * default or override container images in workload controllers") -- flagged
 * here anyway (a documented ambiguity, meta.json) since a container with no
 * image cannot run without something this tool cannot see. Container names
 * are also checked for uniqueness within the same Pod template: "Each named
 * port in a pod must have a unique name" is the schema's own phrasing for
 * ports, and the same uniqueness rule applies to `containers[*].name` and
 * `initContainers[*].name` together, per the Container schema's own
 * `x-kubernetes-list-map-keys: [name]`/`x-kubernetes-list-type: map` markers.
 */
function containerFindings(source: ReadYamlResult, docIndex: number, location: ContainerLocation): YamlFinding[] {
  const findings: YamlFinding[] = [];
  const seenNames = new Map<string, number>();

  for (const field of ['initContainers', 'containers'] as const) {
    const list = location.podSpec[field];
    if (!Array.isArray(list)) continue;

    list.forEach((container, i) => {
      if (!isRecord(container)) return;
      const containerPointer = pointerFrom(location.pointer, [field, i]);

      if (typeof container.image !== 'string' || container.image.trim() === '') {
        findings.push(
          finding(
            source,
            docIndex,
            pointerFrom(containerPointer, ['name']),
            'This container has no image, so it cannot run.',
            { key: true },
          ),
        );
      }

      const name = typeof container.name === 'string' ? container.name : undefined;
      if (name !== undefined) {
        if (seenNames.has(name)) {
          findings.push(
            finding(
              source,
              docIndex,
              pointerFrom(containerPointer, ['name']),
              `The container name "${name}" is already used earlier in this Pod template; every container and init container name must be unique within it.`,
              { key: true },
            ),
          );
        } else {
          seenNames.set(name, i);
        }
      }

      if (Array.isArray(container.ports)) {
        container.ports.forEach((portEntry, pi) => {
          if (!isRecord(portEntry)) return;
          for (const portField of ['containerPort', 'hostPort'] as const) {
            const port = portEntry[portField];
            if (typeof port === 'number' && (port < 1 || port > 65535)) {
              findings.push(
                finding(
                  source,
                  docIndex,
                  pointerFrom(containerPointer, ['ports', pi, portField]),
                  `${portField} must be between 1 and 65535 (Kubernetes API reference: "This must be a valid port number, 0 < x < 65536.").`,
                ),
              );
            }
          }
        });
      }
    });
  }

  return findings;
}

/**
 * A Service's own `spec.ports[*].port`/`.targetPort`, checked against the
 * same 1-65535 range the ServicePort schema documents in prose only
 * ("Number must be in the range 1 to 65535.").
 */
function servicePortFindings(
  source: ReadYamlResult,
  docIndex: number,
  kind: string,
  value: Record<string, unknown>,
  prefix: string,
): YamlFinding[] {
  if (kind !== 'Service') return [];
  const spec = isRecord(value.spec) ? value.spec : undefined;
  const ports = Array.isArray(spec?.ports) ? spec!.ports : [];
  const findings: YamlFinding[] = [];

  ports.forEach((portEntry, i) => {
    if (!isRecord(portEntry)) return;
    for (const field of ['port', 'targetPort', 'nodePort'] as const) {
      const port = portEntry[field];
      if (typeof port === 'number' && (port < 1 || port > 65535)) {
        findings.push(
          finding(
            source,
            docIndex,
            pointerFrom(prefix, ['spec', 'ports', i, field]),
            `${field} must be between 1 and 65535 (Kubernetes API reference: "Number must be in the range 1 to 65535.").`,
          ),
        );
      }
    }
  });

  return findings;
}

/**
 * The Object Names and IDs page's own rules
 * (`kubernetes.io/docs/concepts/overview/working-with-objects/names/`,
 * fetched 2026-09-26). Simplified to two buckets (documented as an ambiguity
 * in meta.json): "Most resource types require a name that can be used as a
 * DNS subdomain name as defined in RFC 1123" (at most 253 characters,
 * lowercase alphanumeric, "-" or ".", starting and ending with an
 * alphanumeric character) applies to every bundled kind except Service,
 * which the page documents separately under the RFC 1123 Label Name rule (at
 * most 63 characters; "the current Kubernetes implementation requires both
 * RFC 1035 and RFC 1123 labels to start with an alphabetic character").
 */
function isDnsSubdomainName(name: string): boolean {
  if (name.length === 0 || name.length > 253) return false;
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) return false;
  return /^[a-z0-9.-]*$/.test(name);
}

function isLabelName(name: string): boolean {
  if (name.length === 0 || name.length > 63) return false;
  if (!/^[a-z]/.test(name) || !/[a-z0-9]$/.test(name)) return false;
  return /^[a-z][a-z0-9-]*$/.test(name);
}

function namingFindings(
  source: ReadYamlResult,
  docIndex: number,
  kind: string,
  value: Record<string, unknown>,
  prefix: string,
): YamlFinding[] {
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const name = typeof metadata?.name === 'string' ? metadata.name : undefined;
  const generateName = typeof metadata?.generateName === 'string' ? metadata.generateName : undefined;

  if (name === undefined && generateName === undefined) {
    return [
      finding(
        source,
        docIndex,
        pointerFrom(prefix, ['metadata']),
        'This object has neither metadata.name nor metadata.generateName, so it has no usable name.',
        { key: true },
      ),
    ];
  }
  if (name === undefined) return [];

  const rule = kind === 'Service' ? isLabelName : isDnsSubdomainName;
  const ruleLabel =
    kind === 'Service'
      ? 'the RFC 1123 Label Name rule (at most 63 characters, lowercase alphanumeric or "-", starting with a letter and ending with an alphanumeric character)'
      : 'the RFC 1123 DNS Subdomain Name rule (at most 253 characters, lowercase alphanumeric, "-" or ".", starting and ending with an alphanumeric character)';

  if (rule(name)) return [];

  return [
    finding(
      source,
      docIndex,
      pointerFrom(prefix, ['metadata', 'name']),
      `"${name}" does not follow ${ruleLabel} that Kubernetes documents for this kind.`,
      { key: true },
    ),
  ];
}

/**
 * Runs every semantic check for one checked resource. `entry` is the bundled
 * `KindEntry` the schema was validated against, used only to skip the
 * selector check for Job/CronJob (which generate their own selector) without
 * a second kind lookup.
 */
export function semanticFindings(
  source: ReadYamlResult,
  docIndex: number,
  pointerPrefix: string,
  value: Record<string, unknown>,
  entry: KindEntry,
): YamlFinding[] {
  const kind = entry.kind;
  const findings: YamlFinding[] = [];

  findings.push(...selectorFindings(source, docIndex, kind, value, pointerPrefix));
  findings.push(...servicePortFindings(source, docIndex, kind, value, pointerPrefix));
  findings.push(...namingFindings(source, docIndex, kind, value, pointerPrefix));

  for (const location of podSpecsOf(kind, value, pointerPrefix)) {
    findings.push(...containerFindings(source, docIndex, location));
  }

  return findings;
}
