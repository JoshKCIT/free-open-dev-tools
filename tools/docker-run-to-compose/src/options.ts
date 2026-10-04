/**
 * The options of `docker run`, one entry for every flag the Docker command line registers for it (cli/command/container
 * opts.go and run.go in the Docker CLI source; a test reads those two recorded files and fails when a flag is missing).
 * Each entry says what kind of value the flag takes and which Compose service key it becomes, or why it becomes nothing.
 *
 * The names registered twice (an old and a new spelling) are separate entries; the old one names the new one in `alias`.
 */

/** What a flag takes after it: nothing (a true or false flag), text, a value that can be repeated, a number, a size or a duration. */
export type OptionValue = 'none' | 'string' | 'list' | 'number' | 'size' | 'duration';

export interface DockerRunOption {
  /** The long name, without the two dashes. */
  readonly name: string;
  /** The one-letter form, without the dash. */
  readonly short?: string;
  readonly value: OptionValue;
  /** The Compose service key the option becomes, or null when Compose has no key for it. */
  readonly compose: string | null;
  /** Why there is no Compose key, or a condition on the key. Always present when `compose` is null. */
  readonly reason?: string;
  /** True for a flag docker hides from --help or has deprecated, which it still accepts. */
  readonly hidden?: boolean;
  /** For a name registered twice: the name that has the same meaning. */
  readonly alias?: string;
}

function mapped(
  name: string,
  value: OptionValue,
  compose: string,
  extra: { short?: string; reason?: string; hidden?: boolean; alias?: string } = {},
): DockerRunOption {
  return { name, value, compose, ...extra };
}

function unmapped(
  name: string,
  value: OptionValue,
  reason: string,
  extra: { short?: string; hidden?: boolean } = {},
): DockerRunOption {
  return { name, value, compose: null, reason, ...extra };
}

const NEEDS_SERVICE =
  'The target must be a service defined in the same Compose file, so this is listed instead of written.';
const NEEDS_NETWORK =
  'Needs a user-defined network in the same command (--network name); with none it is listed instead of written.';
const WINDOWS_ONLY = 'A Windows-only setting that the Compose Specification has no key for.';

/** Every option of docker run, in the order of the Docker CLI reference's groups. */
export const DOCKER_RUN_OPTIONS: readonly DockerRunOption[] = [
  mapped('add-host', 'list', 'extra_hosts'),
  mapped('annotation', 'list', 'annotations'),
  unmapped(
    'attach',
    'list',
    'docker run --attach picks which of STDIN, STDOUT and STDERR to connect to the terminal. The Compose service key attach only chooses whether Compose follows the service logs, a different thing.',
    { short: 'a' },
  ),
  mapped('blkio-weight', 'number', 'blkio_config.weight'),
  mapped('blkio-weight-device', 'list', 'blkio_config.weight_device'),
  mapped('cap-add', 'list', 'cap_add'),
  mapped('cap-drop', 'list', 'cap_drop'),
  mapped('cgroup-parent', 'string', 'cgroup_parent'),
  mapped('cgroupns', 'string', 'cgroup'),
  unmapped('cidfile', 'string', 'Compose does not write the container ID to a file.'),
  mapped('cpu-count', 'number', 'cpu_count'),
  mapped('cpu-percent', 'number', 'cpu_percent'),
  mapped('cpu-period', 'number', 'cpu_period'),
  mapped('cpu-quota', 'number', 'cpu_quota'),
  mapped('cpu-rt-period', 'number', 'cpu_rt_period'),
  mapped('cpu-rt-runtime', 'number', 'cpu_rt_runtime'),
  mapped('cpu-shares', 'number', 'cpu_shares', { short: 'c' }),
  mapped('cpus', 'number', 'cpus'),
  mapped('cpuset-cpus', 'string', 'cpuset'),
  unmapped('cpuset-mems', 'string', 'The Compose Specification has no key for the memory nodes a container may use.'),
  unmapped(
    'detach',
    'none',
    'Running in the background is not a service setting: Compose starts the service in the background with docker compose up -d.',
    { short: 'd' },
  ),
  unmapped(
    'detach-keys',
    'string',
    'The key sequence that detaches a terminal is a docker run and docker attach setting; Compose has no key for it.',
  ),
  mapped('device', 'list', 'devices'),
  mapped('device-cgroup-rule', 'list', 'device_cgroup_rules'),
  mapped('device-read-bps', 'list', 'blkio_config.device_read_bps'),
  mapped('device-read-iops', 'list', 'blkio_config.device_read_iops'),
  mapped('device-write-bps', 'list', 'blkio_config.device_write_bps'),
  mapped('device-write-iops', 'list', 'blkio_config.device_write_iops'),
  unmapped(
    'disable-content-trust',
    'none',
    'Deprecated: docker removed support for content trust, and the Compose Specification has no key for it.',
    { hidden: true },
  ),
  mapped('dns', 'list', 'dns'),
  mapped('dns-opt', 'list', 'dns_opt', { hidden: true, alias: 'dns-option' }),
  mapped('dns-option', 'list', 'dns_opt'),
  mapped('dns-search', 'list', 'dns_search'),
  mapped('domainname', 'string', 'domainname'),
  mapped('entrypoint', 'string', 'entrypoint'),
  mapped('env', 'list', 'environment', { short: 'e' }),
  mapped('env-file', 'list', 'env_file', { reason: 'The file must exist when Compose runs.' }),
  mapped('expose', 'list', 'expose'),
  mapped('gpus', 'string', 'gpus'),
  mapped('group-add', 'list', 'group_add'),
  mapped('health-cmd', 'string', 'healthcheck.test'),
  mapped('health-interval', 'duration', 'healthcheck.interval'),
  mapped('health-retries', 'number', 'healthcheck.retries'),
  mapped('health-start-interval', 'duration', 'healthcheck.start_interval'),
  mapped('health-start-period', 'duration', 'healthcheck.start_period'),
  mapped('health-timeout', 'duration', 'healthcheck.timeout'),
  unmapped('help', 'none', 'Prints the usage text of docker run; there is nothing to write.'),
  mapped('hostname', 'string', 'hostname', { short: 'h' }),
  mapped('init', 'none', 'init'),
  mapped('interactive', 'none', 'stdin_open', { short: 'i' }),
  unmapped('io-maxbandwidth', 'size', WINDOWS_ONLY),
  unmapped('io-maxiops', 'number', WINDOWS_ONLY),
  mapped('ip', 'string', 'networks.<network>.ipv4_address', { reason: NEEDS_NETWORK }),
  mapped('ip6', 'string', 'networks.<network>.ipv6_address', { reason: NEEDS_NETWORK }),
  mapped('ipc', 'string', 'ipc'),
  mapped('isolation', 'string', 'isolation'),
  unmapped(
    'kernel-memory',
    'size',
    'Deprecated: the kernel no longer supports a kernel memory limit, and the Compose Specification has no key for it.',
    { hidden: true },
  ),
  mapped('label', 'list', 'labels', { short: 'l' }),
  mapped('label-file', 'list', 'label_file', { reason: 'The file must exist when Compose runs.' }),
  mapped('link', 'list', 'links', { reason: NEEDS_SERVICE }),
  mapped('link-local-ip', 'list', 'networks.<network>.link_local_ips', { reason: NEEDS_NETWORK }),
  mapped('log-driver', 'string', 'logging.driver'),
  mapped('log-opt', 'list', 'logging.options'),
  mapped('mac-address', 'string', 'mac_address'),
  mapped('memory', 'size', 'mem_limit', { short: 'm' }),
  mapped('memory-reservation', 'size', 'mem_reservation'),
  mapped('memory-swap', 'size', 'memswap_limit'),
  mapped('memory-swappiness', 'number', 'mem_swappiness'),
  mapped('mount', 'list', 'volumes'),
  mapped('name', 'string', 'container_name'),
  mapped('net', 'list', 'networks', { hidden: true, alias: 'network' }),
  mapped('net-alias', 'list', 'networks.<network>.aliases', {
    hidden: true,
    alias: 'network-alias',
    reason: NEEDS_NETWORK,
  }),
  mapped('network', 'list', 'networks'),
  mapped('network-alias', 'list', 'networks.<network>.aliases', { reason: NEEDS_NETWORK }),
  mapped('no-healthcheck', 'none', 'healthcheck.disable'),
  mapped('oom-kill-disable', 'none', 'oom_kill_disable'),
  mapped('oom-score-adj', 'number', 'oom_score_adj'),
  mapped('pid', 'string', 'pid'),
  mapped('pids-limit', 'number', 'pids_limit'),
  mapped('platform', 'string', 'platform'),
  mapped('privileged', 'none', 'privileged'),
  mapped('publish', 'list', 'ports', { short: 'p' }),
  unmapped(
    'publish-all',
    'none',
    'Compose has no switch that publishes every exposed port to a random port. Write each port under ports with only its container port instead.',
    { short: 'P' },
  ),
  mapped('pull', 'string', 'pull_policy'),
  unmapped(
    'quiet',
    'none',
    'Hides the image pull output; it is a docker run display setting that Compose has no key for.',
    { short: 'q' },
  ),
  mapped('read-only', 'none', 'read_only'),
  mapped('restart', 'string', 'restart'),
  unmapped(
    'rm',
    'none',
    'Removing the container when it exits is not a service setting: Compose runs a one-off container that is removed afterwards with docker compose run --rm.',
  ),
  mapped('runtime', 'string', 'runtime'),
  mapped('security-opt', 'list', 'security_opt'),
  mapped('shm-size', 'size', 'shm_size'),
  unmapped(
    'sig-proxy',
    'none',
    'Forwarding signals to the process is a docker run setting for an attached terminal; Compose has no key for it.',
  ),
  mapped('stop-signal', 'string', 'stop_signal'),
  mapped('stop-timeout', 'number', 'stop_grace_period'),
  mapped('storage-opt', 'list', 'storage_opt'),
  mapped('sysctl', 'list', 'sysctls'),
  mapped('tmpfs', 'list', 'tmpfs'),
  mapped('tty', 'none', 'tty', { short: 't' }),
  mapped('ulimit', 'list', 'ulimits'),
  unmapped('umask', 'string', 'The umask option is newer than the Compose Specification, which has no key for it.'),
  mapped('use-api-socket', 'none', 'use_api_socket'),
  mapped('user', 'string', 'user', { short: 'u' }),
  mapped('userns', 'string', 'userns_mode'),
  mapped('uts', 'string', 'uts'),
  mapped('volume', 'list', 'volumes', { short: 'v' }),
  unmapped(
    'volume-driver',
    'string',
    'In Compose a volume driver belongs to the volume, under the top-level volumes key, not to the service.',
  ),
  mapped('volumes-from', 'list', 'volumes_from', { reason: NEEDS_SERVICE }),
  mapped('workdir', 'string', 'working_dir', { short: 'w' }),
];

/** The options by name: `--name` for a long name and `-p` for a short one. A Map, so a pasted `__proto__` is just an unknown name. */
export const optionByName: ReadonlyMap<string, DockerRunOption> = (() => {
  const map = new Map<string, DockerRunOption>();
  for (const option of DOCKER_RUN_OPTIONS) {
    map.set(`--${option.name}`, option);
    if (option.short !== undefined) map.set(`-${option.short}`, option);
  }
  return map;
})();

/** The most changes (insert, delete or replace one character) between a typed name and the one suggested for it. */
const MAX_EDIT_DISTANCE = 2;

/** The edit distance between two short strings, kept to two rows; stops early once the distance cannot be small enough. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      row.push(value);
      if (value < smallest) smallest = value;
    }
    if (smallest > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length] ?? limit + 1;
}

/**
 * The known long option nearest to a typed name (given without its dashes), as `--name`, or null when none is within two
 * changes. A name of one or two characters never gets a suggestion unless it is closer than its own length, so a stray
 * `-z` does not suggest an unrelated option.
 */
export function closestOption(name: string): string | null {
  if (name === '') return null;
  let best: string | null = null;
  let bestDistance = MAX_EDIT_DISTANCE + 1;
  for (const option of DOCKER_RUN_OPTIONS) {
    const distance = editDistance(name, option.name, MAX_EDIT_DISTANCE);
    if (distance < bestDistance && distance < name.length) {
      best = `--${option.name}`;
      bestDistance = distance;
    }
  }
  return best;
}
