/**
 * The twelve Kubernetes kinds this tool checks against the bundled schema
 * subset (`k8s-schema-subset.ts`), and the removed `apiVersion` values
 * Kubernetes 1.35 no longer serves for a kind this tool knows.
 */

export interface KindEntry {
  /** The exact `apiVersion` string Kubernetes 1.35 serves this kind under (`group/version`, or bare `version` for the core group). */
  apiVersion: string;
  kind: string;
  /** The key this kind's own schema is stored under in `K8S_SCHEMA_SUBSET.definitions`. */
  definition: string;
}

/**
 * The twelve common kinds this tool bundles a schema for (D-101). Any other
 * `kind` is reported "not checked", never silently treated as valid.
 * `apiVersion` and `kind` are read from each vendored kind file's own
 * `x-kubernetes-group-version-kind` entry (see `test/build-schema-subset.ts`).
 */
export const KINDS: readonly KindEntry[] = [
  { apiVersion: 'v1', kind: 'Pod', definition: 'Pod' },
  { apiVersion: 'apps/v1', kind: 'Deployment', definition: 'Deployment' },
  { apiVersion: 'apps/v1', kind: 'StatefulSet', definition: 'StatefulSet' },
  { apiVersion: 'apps/v1', kind: 'DaemonSet', definition: 'DaemonSet' },
  { apiVersion: 'batch/v1', kind: 'Job', definition: 'Job' },
  { apiVersion: 'batch/v1', kind: 'CronJob', definition: 'CronJob' },
  { apiVersion: 'v1', kind: 'Service', definition: 'Service' },
  { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', definition: 'Ingress' },
  { apiVersion: 'v1', kind: 'ConfigMap', definition: 'ConfigMap' },
  { apiVersion: 'v1', kind: 'Secret', definition: 'Secret' },
  { apiVersion: 'v1', kind: 'PersistentVolumeClaim', definition: 'PersistentVolumeClaim' },
  { apiVersion: 'v1', kind: 'Namespace', definition: 'Namespace' },
] as const;

export interface RemovedApiVersion {
  kind: string;
  /** An `apiVersion` Kubernetes used to serve this kind under, that 1.35 no longer accepts. */
  removedApiVersion: string;
  /** The `apiVersion` a manifest should use instead -- always one of `KINDS`' own entries for this kind. */
  servedApiVersion: string;
  /** The Kubernetes release that stopped serving `removedApiVersion`. */
  removedInRelease: string;
}

/**
 * Every removed `apiVersion` this tool knows for the twelve bundled kinds,
 * quoted from the Kubernetes documentation's own Deprecated API Migration
 * Guide (`kubernetes.io/docs/reference/using-api/deprecation-guide/`, fetched
 * 2026-09-26). A kind not listed here (Service, ConfigMap, Secret,
 * PersistentVolumeClaim, Namespace, Job) has never had a served `apiVersion`
 * removed according to that guide's own release-by-release history.
 *
 * - "DaemonSet: The extensions/v1beta1 and apps/v1beta2 API versions of
 *   DaemonSet are no longer served as of v1.16. Migrate manifests and API
 *   clients to use the apps/v1 API version, available since v1.9."
 * - "Deployment: The extensions/v1beta1, apps/v1beta1, and apps/v1beta2 API
 *   versions of Deployment are no longer served as of v1.16. Migrate
 *   manifests and API clients to use the apps/v1 API version, available
 *   since v1.9."
 * - "StatefulSet: The apps/v1beta1 and apps/v1beta2 API versions of
 *   StatefulSet are no longer served as of v1.16. Migrate manifests and API
 *   clients to use the apps/v1 API version, available since v1.9."
 * - "Ingress: The extensions/v1beta1 and networking.k8s.io/v1beta1 API
 *   versions of Ingress is no longer served as of v1.22. Migrate manifests
 *   and API clients to use the networking.k8s.io/v1 API version, available
 *   since v1.19."
 * - "CronJob: The batch/v1beta1 API version of CronJob is no longer served as
 *   of v1.25. Migrate manifests and API clients to use the batch/v1 API
 *   version, available since v1.21."
 */
export const REMOVED_API_VERSIONS: readonly RemovedApiVersion[] = [
  {
    kind: 'DaemonSet',
    removedApiVersion: 'extensions/v1beta1',
    servedApiVersion: 'apps/v1',
    removedInRelease: 'v1.16',
  },
  { kind: 'DaemonSet', removedApiVersion: 'apps/v1beta2', servedApiVersion: 'apps/v1', removedInRelease: 'v1.16' },
  {
    kind: 'Deployment',
    removedApiVersion: 'extensions/v1beta1',
    servedApiVersion: 'apps/v1',
    removedInRelease: 'v1.16',
  },
  { kind: 'Deployment', removedApiVersion: 'apps/v1beta1', servedApiVersion: 'apps/v1', removedInRelease: 'v1.16' },
  { kind: 'Deployment', removedApiVersion: 'apps/v1beta2', servedApiVersion: 'apps/v1', removedInRelease: 'v1.16' },
  { kind: 'StatefulSet', removedApiVersion: 'apps/v1beta1', servedApiVersion: 'apps/v1', removedInRelease: 'v1.16' },
  { kind: 'StatefulSet', removedApiVersion: 'apps/v1beta2', servedApiVersion: 'apps/v1', removedInRelease: 'v1.16' },
  {
    kind: 'Ingress',
    removedApiVersion: 'extensions/v1beta1',
    servedApiVersion: 'networking.k8s.io/v1',
    removedInRelease: 'v1.22',
  },
  {
    kind: 'Ingress',
    removedApiVersion: 'networking.k8s.io/v1beta1',
    servedApiVersion: 'networking.k8s.io/v1',
    removedInRelease: 'v1.22',
  },
  { kind: 'CronJob', removedApiVersion: 'batch/v1beta1', servedApiVersion: 'batch/v1', removedInRelease: 'v1.25' },
] as const;
