/**
 * Turns a parsed docker run command into one Compose service. Every option the Docker command line registers is read; the
 * ones with a Compose key are written, the ones with none are listed with the reason, and the ones that only make sense
 * next to another service or network in the same file are listed with the key they would become. The result is checked
 * against the Compose Specification schema and written as YAML.
 *
 * Text from the command only ever becomes a value in the document, or a key in a map that has no prototype, never anything
 * that could change the shape of the document; the YAML writer quotes every string.
 */
import { toComposeYaml } from './compose-yaml';
import { readCsvRecord } from './csv';
import { DockerRunError } from './errors';
import { hasInterpolation } from './interpolation';
import { visible } from './limits';
import { parseCpuCount, parseGoInteger } from './numbers';
import type { DockerRunOption } from './options';
import { isSize, parseDockerCommand, type ParsedOption } from './parse-run';
import { validateComposeDocument, type ComposeValidation } from './validate';

export type ComposeDocument = Record<string, unknown>;

/** One option that was read, the value it was given (cut and escaped for showing) and the Compose key it became. */
export interface ConversionRow {
  readonly option: string;
  readonly value: string;
  readonly key: string;
}

/** An option Compose has no key for, and why. */
export interface NoEquivalent {
  readonly option: string;
  readonly reason: string;
}

/** An option that needs another service or network in the same file; it is not written. */
export interface NeedsAnotherService {
  readonly option: string;
  /** The Compose key it would become. */
  readonly key: string;
  readonly reason: string;
}

export interface ConversionResult {
  readonly document: ComposeDocument;
  readonly yaml: string;
  readonly rows: ConversionRow[];
  readonly noEquivalent: NoEquivalent[];
  readonly needsAnotherService: NeedsAnotherService[];
  readonly unknown: { readonly name: string; readonly closest: string | null }[];
  readonly hints: string[];
  readonly validation: ComposeValidation;
}

type Bag = Record<string, unknown>;

/** A map with no prototype, for keys that come from pasted text: `__proto__` is then an ordinary key. */
function bag(): Bag {
  return Object.create(null) as Bag;
}

const TRUE_WORDS = new Set(['1', 't', 'T', 'TRUE', 'true', 'True']);
const FALSE_WORDS = new Set(['0', 'f', 'F', 'FALSE', 'false', 'False']);

function isDigits(text: string): boolean {
  if (text === '') return false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

/** A whole number, with an optional minus sign. */
function isWhole(text: string): boolean {
  return isDigits(text[0] === '-' ? text.slice(1) : text);
}

/** A whole number when docker reads the text as one (0x10 is 16), otherwise the text (a variable for Compose to fill in, say). */
function integerOrText(text: string): number | string {
  return parseGoInteger(text) ?? text;
}

/** The CPU count of a --cpus value (1/2 is 0.5), otherwise the text. */
function cpusOrText(text: string): number | string {
  return parseCpuCount(text) ?? text;
}

/** A whole number when the text is one, otherwise the text (a size such as 512m). */
function wholeOrText(text: string): number | string {
  return isWhole(text) ? Number(text) : text;
}

/** True or false for the words docker reads as a boolean; anything else (a variable) stays the text. */
function booleanOf(read: ParsedOption): boolean | string {
  if (read.value === null || TRUE_WORDS.has(read.value)) return true;
  if (FALSE_WORDS.has(read.value)) return false;
  return read.value;
}

function isTrue(read: ParsedOption): boolean {
  return booleanOf(read) === true;
}

function refuse(read: ParsedOption, message: string): DockerRunError {
  return new DockerRunError(message, read.line, read.column);
}

/** A Compose volume name: what docker accepts for a named volume. At least two characters, so a drive letter is never one. */
function isVolumeName(text: string): boolean {
  if (text.length < 2) return false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const alphanumeric = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
    if (i === 0 ? !alphanumeric : !(alphanumeric || ch === '_' || ch === '.' || ch === '-')) return false;
  }
  return true;
}

/** Splits `key=value` at the first equals sign. */
function cut(text: string): [string, string | null] {
  const at = text.indexOf('=');
  return at < 0 ? [text, null] : [text.slice(0, at), text.slice(at + 1)];
}

/** The service name: the one asked for, else the typed container name, else the image's last path segment, reduced to [a-z0-9_-]. */
function serviceNameFor(asked: string | undefined, typedName: string | null, image: string): string {
  const raw = asked !== undefined && asked.trim() !== '' ? asked : (typedName ?? lastImageSegment(image));
  let name = '';
  let pendingDash = false;
  for (const ch of raw.toLowerCase()) {
    const keep = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-';
    if (keep) {
      if (pendingDash && name !== '') name += '-';
      pendingDash = false;
      name += ch;
    } else {
      pendingDash = true;
    }
  }
  while (name.endsWith('-')) name = name.slice(0, -1);
  while (name.startsWith('-')) name = name.slice(1);
  return name === '' ? 'app' : name;
}

function lastImageSegment(image: string): string {
  const digest = image.indexOf('@');
  const withoutDigest = digest < 0 ? image : image.slice(0, digest);
  const slash = withoutDigest.lastIndexOf('/');
  const segment = withoutDigest.slice(slash + 1);
  const colon = segment.indexOf(':');
  return colon < 0 ? segment : segment.slice(0, colon);
}

/** Where a user-defined network is used, and what the command said about it. */
interface NetworkUse {
  name: string;
  aliases: string[];
  ipv4?: string;
  ipv6?: string;
  linkLocal: string[];
  mac?: string;
  driverOpts: Bag | null;
  priority?: number;
}

/** An option that belongs to the one user network (an address or an alias) and is placed once the networks are known. */
interface PendingNetworkOption {
  readonly read: ParsedOption;
  readonly rowIndex: number;
}

const STRING_PATHS = new Map<string, string[]>([
  ['cgroup-parent', ['cgroup_parent']],
  ['cgroupns', ['cgroup']],
  ['cpuset-cpus', ['cpuset']],
  ['domainname', ['domainname']],
  ['hostname', ['hostname']],
  ['ipc', ['ipc']],
  ['isolation', ['isolation']],
  ['log-driver', ['logging', 'driver']],
  ['mac-address', ['mac_address']],
  ['name', ['container_name']],
  ['pid', ['pid']],
  ['platform', ['platform']],
  ['pull', ['pull_policy']],
  ['restart', ['restart']],
  ['runtime', ['runtime']],
  ['stop-signal', ['stop_signal']],
  ['user', ['user']],
  ['userns', ['userns_mode']],
  ['uts', ['uts']],
  ['workdir', ['working_dir']],
  ['health-interval', ['healthcheck', 'interval']],
  ['health-start-interval', ['healthcheck', 'start_interval']],
  ['health-start-period', ['healthcheck', 'start_period']],
  ['health-timeout', ['healthcheck', 'timeout']],
]);

const NUMBER_PATHS = new Map<string, string[]>([
  ['blkio-weight', ['blkio_config', 'weight']],
  ['cpu-count', ['cpu_count']],
  ['cpu-percent', ['cpu_percent']],
  ['cpu-period', ['cpu_period']],
  ['cpu-quota', ['cpu_quota']],
  ['cpu-rt-period', ['cpu_rt_period']],
  ['cpu-rt-runtime', ['cpu_rt_runtime']],
  ['cpu-shares', ['cpu_shares']],
  ['cpus', ['cpus']],
  ['health-retries', ['healthcheck', 'retries']],
  ['memory-swappiness', ['mem_swappiness']],
  ['oom-score-adj', ['oom_score_adj']],
  ['pids-limit', ['pids_limit']],
]);

const SIZE_PATHS = new Map<string, string[]>([
  ['memory', ['mem_limit']],
  ['memory-reservation', ['mem_reservation']],
  ['memory-swap', ['memswap_limit']],
  ['shm-size', ['shm_size']],
]);

const BOOLEAN_PATHS = new Map<string, string[]>([
  ['init', ['init']],
  ['interactive', ['stdin_open']],
  ['no-healthcheck', ['healthcheck', 'disable']],
  ['oom-kill-disable', ['oom_kill_disable']],
  ['privileged', ['privileged']],
  ['read-only', ['read_only']],
  ['tty', ['tty']],
  ['use-api-socket', ['use_api_socket']],
]);

const LIST_KEYS = new Map<string, string>([
  ['annotation', 'annotations'],
  ['cap-add', 'cap_add'],
  ['cap-drop', 'cap_drop'],
  ['device', 'devices'],
  ['device-cgroup-rule', 'device_cgroup_rules'],
  ['dns', 'dns'],
  ['dns-option', 'dns_opt'],
  ['dns-search', 'dns_search'],
  ['env', 'environment'],
  ['env-file', 'env_file'],
  ['expose', 'expose'],
  ['group-add', 'group_add'],
  ['label', 'labels'],
  ['label-file', 'label_file'],
  ['publish', 'ports'],
  ['security-opt', 'security_opt'],
  ['sysctl', 'sysctls'],
  ['tmpfs', 'tmpfs'],
]);

/** The blkio lists: option name, key under blkio_config, whether the rate may be written with a unit. */
const BLKIO_DEVICES = new Map<string, { key: string; unit: boolean }>([
  ['device-read-bps', { key: 'device_read_bps', unit: true }],
  ['device-read-iops', { key: 'device_read_iops', unit: false }],
  ['device-write-bps', { key: 'device_write_bps', unit: true }],
  ['device-write-iops', { key: 'device_write_iops', unit: false }],
]);

const NETWORK_MODES = new Set(['host', 'none', 'bridge', 'default']);
const MOUNT_TYPES = new Set(['bind', 'volume', 'tmpfs', 'cluster', 'npipe', 'image']);
const NOT_WRITTEN_NEEDS_NETWORK = 'not written, needs a user-defined network';
const NOT_WRITTEN_NEEDS_SERVICE = 'not written, needs another service';
const NOT_WRITTEN_NAME_HAS_DOLLAR = 'not written, the name holds a dollar sign';
const NAME_HAS_DOLLAR_REASON =
  'Compose fills in variables in values but not in names, so a name that holds a dollar sign cannot be written as a key. Add it to the file by hand once you know the name.';

/** True when a name that would become a YAML key holds a dollar sign, a variable or a literal one. */
function holdsDollar(text: string): boolean {
  return text.includes(String.fromCharCode(36));
}

class Conversion {
  private readonly service: Bag;
  readonly rows: { option: string; value: string; key: string }[] = [];
  readonly noEquivalent: NoEquivalent[] = [];
  readonly needs: NeedsAnotherService[] = [];
  private readonly scalarRows = new Map<string, number>();
  private readonly topVolumes: Bag = bag();
  private readonly userNetworks: NetworkUse[] = [];
  private networkMode: string | null = null;
  private readonly pendingNetwork: PendingNetworkOption[] = [];
  private entrypoint: string[] | null = null;
  private entrypointWithSpaces = false;
  private gpus: (string | Bag)[] | null = null;
  private typedName: string | null = null;
  private removeAfterRun = false;
  private detach = false;
  /** A network name held a dollar sign and was not written, so network settings cannot be matched to a network with certainty. */
  private skippedNetwork = false;
  /** A volume source held a variable, so Compose cannot know it is a named volume that must be declared. */
  private variableVolume = false;

  constructor(image: string) {
    this.service = { image };
  }

  /** Reads one option into the service. */
  apply(read: ParsedOption): void {
    const option = read.option;
    const canonical = option.alias ?? option.name;
    const row = { option: `--${option.name}`, value: read.value === null ? 'true' : visible(read.value), key: '' };
    this.rows.push(row);
    const index = this.rows.length - 1;
    row.key = this.handle(canonical, read, index);
  }

  private handle(name: string, read: ParsedOption, index: number): string {
    const option = read.option;
    if (option.compose === null) {
      this.noEquivalent.push({ option: `--${option.name}`, reason: option.reason ?? '' });
      if (name === 'rm' && isTrue(read)) this.removeAfterRun = true;
      if (name === 'detach' && isTrue(read)) this.detach = true;
      return 'no Compose equivalent';
    }
    const value = read.value ?? '';

    const stringPath = STRING_PATHS.get(name);
    if (stringPath !== undefined) {
      if (value === '') return 'nothing written (empty value)';
      if (name === 'name') this.typedName = value;
      return this.setScalar(stringPath, value, option, index);
    }
    const numberPath = NUMBER_PATHS.get(name);
    if (numberPath !== undefined) {
      return this.setScalar(numberPath, name === 'cpus' ? cpusOrText(value) : integerOrText(value), option, index);
    }
    const sizePath = SIZE_PATHS.get(name);
    if (sizePath !== undefined) return this.setScalar(sizePath, wholeOrText(value), option, index);
    const booleanPath = BOOLEAN_PATHS.get(name);
    if (booleanPath !== undefined) return this.setScalar(booleanPath, booleanOf(read), option, index);
    const listKey = LIST_KEYS.get(name);
    if (listKey !== undefined) {
      this.push(listKey, value);
      return listKey;
    }
    const blkio = BLKIO_DEVICES.get(name);
    if (blkio !== undefined) return this.blkioDevice(read, blkio.key, blkio.unit);

    switch (name) {
      case 'add-host': {
        const colon = value.indexOf(':');
        const equals = value.indexOf('=');
        const separator = colon >= 0 && (equals < 0 || colon < equals) ? colon : -1;
        this.push('extra_hosts', separator < 0 ? value : `${value.slice(0, separator)}=${value.slice(separator + 1)}`);
        return 'extra_hosts';
      }
      case 'blkio-weight-device': {
        const [path, weight] = this.splitDevice(read);
        this.pushIn(['blkio_config', 'weight_device'], { path, weight: integerOrText(weight) });
        return 'blkio_config.weight_device';
      }
      case 'entrypoint': {
        this.entrypoint = value === '' ? [] : [value];
        this.entrypointWithSpaces = value.includes(' ') || value.includes('\t');
        this.markReplaced('entrypoint', option, index);
        return 'entrypoint';
      }
      case 'gpus':
        return this.gpuOption(read);
      case 'health-cmd':
        if (value === '') return 'nothing written (empty value)';
        return this.setScalar(['healthcheck', 'test'], ['CMD-SHELL', value], option, index);
      case 'link':
        this.needs.push({ option: '--link', key: 'links', reason: option.reason ?? '' });
        return NOT_WRITTEN_NEEDS_SERVICE;
      case 'volumes-from':
        this.needs.push({ option: '--volumes-from', key: 'volumes_from', reason: option.reason ?? '' });
        return NOT_WRITTEN_NEEDS_SERVICE;
      case 'log-opt':
        return this.mapEntry(['logging', 'options'], value, read);
      case 'storage-opt':
        return this.mapEntry(['storage_opt'], value, read);
      case 'ulimit':
        return this.ulimit(read);
      case 'mount':
        return this.mount(read);
      case 'volume':
        return this.volume(value);
      case 'network':
        return this.network(read);
      case 'ip':
      case 'ip6':
      case 'link-local-ip':
      case 'network-alias':
        this.pendingNetwork.push({ read, rowIndex: index });
        return NOT_WRITTEN_NEEDS_NETWORK;
      case 'stop-timeout':
        return this.setScalar(['stop_grace_period'], isWhole(value) ? `${value}s` : value, option, index);
      default:
        // Every option with a key is handled above; this keeps a table entry that has no handler from passing silently.
        throw refuse(read, `--${option.name} has a Compose key but this page does not know how to write it.`);
    }
  }

  private setIn(path: string[], value: unknown): void {
    let target = this.service;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!;
      const existing = target[key];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        target = existing as Bag;
      } else {
        const created: Bag = {};
        target[key] = created;
        target = created;
      }
    }
    target[path[path.length - 1]!] = value;
  }

  private markReplaced(id: string, option: DockerRunOption, index: number): void {
    const previous = this.scalarRows.get(id);
    if (previous !== undefined) {
      const earlier = this.rows[previous];
      if (earlier !== undefined) earlier.key = `${earlier.key} (replaced by a later --${option.name})`;
    }
    this.scalarRows.set(id, index);
  }

  /** Writes a value that can be given once; a later one replaces an earlier one, as docker does, and the earlier row says so. */
  private setScalar(path: string[], value: unknown, option: DockerRunOption, index: number): string {
    const id = path.join('.');
    this.markReplaced(id, option, index);
    this.setIn(path, value);
    return id;
  }

  private push(key: string, item: unknown): void {
    const existing = this.service[key];
    if (Array.isArray(existing)) existing.push(item);
    else this.service[key] = [item];
  }

  private pushIn(path: string[], item: unknown): void {
    let target = this.service;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!;
      const existing = target[key];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        target = existing as Bag;
      } else {
        const created: Bag = {};
        target[key] = created;
        target = created;
      }
    }
    const last = path[path.length - 1]!;
    const list = target[last];
    if (Array.isArray(list)) list.push(item);
    else target[last] = [item];
  }

  /** Puts `key=value` into a map the command builds one entry at a time (log options, storage options). */
  private mapEntry(path: string[], text: string, read: ParsedOption): string {
    const [key, value] = cut(text);
    if (holdsDollar(key)) return this.nameHoldsDollar(read, path.join('.'));
    let target = this.service;
    for (const part of path.slice(0, -1)) {
      const existing = target[part];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) target = existing as Bag;
      else {
        const created: Bag = {};
        target[part] = created;
        target = created;
      }
    }
    const last = path[path.length - 1]!;
    let map = target[last] as Bag | undefined;
    if (map === undefined) {
      map = bag();
      target[last] = map;
    }
    map[key] = value ?? '';
    return path.join('.');
  }

  /** Lists an option whose name would have to be a YAML key but holds a dollar sign; nothing of it is written. */
  private nameHoldsDollar(read: ParsedOption, key: string): string {
    this.needs.push({ option: `--${read.option.name}`, key, reason: NAME_HAS_DOLLAR_REASON });
    return NOT_WRITTEN_NAME_HAS_DOLLAR;
  }

  private splitDevice(read: ParsedOption): [string, string] {
    const value = read.value ?? '';
    const colon = value.indexOf(':');
    if (colon <= 0 || colon === value.length - 1) {
      throw refuse(read, `The value given to --${read.option.name} must be a device path, a colon and a number.`);
    }
    return [value.slice(0, colon), value.slice(colon + 1)];
  }

  private blkioDevice(read: ParsedOption, key: string, unit: boolean): string {
    const [path, rate] = this.splitDevice(read);
    this.pushIn(['blkio_config', key], { path, rate: unit ? wholeOrText(rate) : integerOrText(rate) });
    return `blkio_config.${key}`;
  }

  private ulimit(read: ParsedOption): string {
    const value = read.value ?? '';
    const [name, limits] = cut(value);
    if (name === '' || limits === null || limits === '') {
      throw refuse(
        read,
        'The value given to --ulimit must be a name, an equals sign and a limit, such as nofile=1024:2048.',
      );
    }
    if (holdsDollar(name)) return this.nameHoldsDollar(read, 'ulimits');
    const colon = limits.indexOf(':');
    let entry: unknown;
    if (colon < 0) {
      entry = wholeOrText(limits);
    } else {
      entry = { soft: wholeOrText(limits.slice(0, colon)), hard: wholeOrText(limits.slice(colon + 1)) };
    }
    let map = this.service['ulimits'] as Bag | undefined;
    if (map === undefined) {
      map = bag();
      this.service['ulimits'] = map;
    }
    map[name] = entry;
    return 'ulimits';
  }

  private volume(value: string): string {
    this.push('volumes', value);
    const colon = value.indexOf(':');
    if (colon > 0) {
      const source = value.slice(0, colon);
      if (hasInterpolation(source)) this.variableVolume = true;
      const isDrive = source.length === 1 && (value[colon + 1] === '\\' || value[colon + 1] === '/');
      if (!isDrive && isVolumeName(source)) this.topVolumes[source] = {};
    }
    return 'volumes';
  }

  private mount(read: ParsedOption): string {
    const text = (read.value ?? '').trim();
    if (text === '') throw refuse(read, '--mount needs a value, but it is empty.');
    const fields = readCsvRecord(text);
    if (fields === null)
      throw refuse(
        read,
        'The value given to --mount is not a comma-separated list of name=value pairs, or a quote in it is not closed.',
      );
    const entry: Bag = {};
    let type = 'volume';
    let source: string | null = null;
    let target: string | null = null;
    let readOnly: boolean | string | null = null;
    let consistency: string | null = null;
    const bind: Bag = {};
    const volume: Bag = {};
    const tmpfs: Bag = {};
    const image: Bag = {};
    const labels: string[] = [];
    const lost = new Set<string>();
    fields.forEach((field, i) => {
      const [rawKey, rawValue] = cut(field);
      const where = `Field ${i + 1} of the --mount value`;
      if (rawKey !== rawKey.trim() || rawKey === '')
        throw refuse(read, `${where} has a name that is empty or has spaces around it.`);
      const key = rawKey.toLowerCase();
      const flagOnly = key === 'readonly' || key === 'ro' || key === 'volume-nocopy' || key === 'bind-create-src';
      if (rawValue === null && !flagOnly) throw refuse(read, `${where} must be a name=value pair.`);
      if (rawValue !== null && (rawValue === '' || rawValue !== rawValue.trim())) {
        throw refuse(read, `${where} has a value that is empty or has spaces around it.`);
      }
      const flag = (): boolean => {
        if (rawValue === null || TRUE_WORDS.has(rawValue)) return true;
        if (FALSE_WORDS.has(rawValue)) return false;
        throw refuse(read, `${where} must be true or false.`);
      };
      const given = rawValue ?? '';
      switch (key) {
        case 'type':
          type = given.toLowerCase();
          break;
        case 'source':
        case 'src':
          source = given;
          break;
        case 'target':
        case 'dst':
        case 'destination':
          target = given;
          break;
        case 'readonly':
        case 'ro':
          readOnly = flag();
          break;
        case 'consistency':
          consistency = given.toLowerCase();
          break;
        case 'bind-propagation':
          bind['propagation'] = given.toLowerCase();
          break;
        case 'bind-recursive':
          if (given === 'enabled') break;
          if (given !== 'disabled' && given !== 'writable' && given !== 'readonly') {
            throw refuse(read, `${where} must be enabled, disabled, writable or readonly.`);
          }
          bind['recursive'] = given;
          break;
        case 'bind-create-src':
          bind['create_host_path'] = flag();
          break;
        case 'volume-nocopy':
          volume['nocopy'] = flag();
          break;
        case 'volume-subpath':
          volume['subpath'] = given;
          break;
        case 'volume-label':
          labels.push(given);
          break;
        case 'volume-driver':
        case 'volume-opt':
          lost.add(key);
          break;
        case 'image-subpath':
          image['subpath'] = given;
          break;
        case 'tmpfs-size':
          if (!hasInterpolation(given) && !isSize(given)) throw refuse(read, `${where} must be a size such as 64m.`);
          tmpfs['size'] = wholeOrText(given);
          break;
        case 'tmpfs-mode': {
          const mode = octal(given);
          if (mode === null) throw refuse(read, `${where} must be a file mode in octal, such as 1777.`);
          tmpfs['mode'] = mode;
          break;
        }
        default:
          throw refuse(read, `${where} is not an option this page reads for --mount.`);
      }
    });
    if (!MOUNT_TYPES.has(type))
      throw refuse(read, 'The type in the --mount value must be bind, volume, tmpfs, image, npipe or cluster.');
    if (target === null || target === '')
      throw refuse(read, 'The --mount value needs a target (target, dst or destination).');
    entry['type'] = type;
    if (source !== null) entry['source'] = source;
    entry['target'] = target;
    if (readOnly !== null) entry['read_only'] = readOnly;
    if (consistency !== null) entry['consistency'] = consistency;
    if (Object.keys(bind).length > 0) entry['bind'] = bind;
    if (labels.length > 0) volume['labels'] = labels;
    if (Object.keys(volume).length > 0) entry['volume'] = volume;
    if (Object.keys(tmpfs).length > 0) entry['tmpfs'] = tmpfs;
    if (Object.keys(image).length > 0) entry['image'] = image;
    this.push('volumes', entry);
    if (type === 'volume' && source !== null && hasInterpolation(source)) this.variableVolume = true;
    if (type === 'volume' && source !== null && isVolumeName(source)) this.topVolumes[source] = {};
    for (const key of lost) {
      this.noEquivalent.push({
        option: `--mount ${key}`,
        reason:
          'In Compose a volume driver and its options belong to the volume, under the top-level volumes key, not to the service.',
      });
    }
    return 'volumes';
  }

  private gpuOption(read: ParsedOption): string {
    const value = read.value ?? '';
    if (value === 'all') {
      this.pushGpu('all');
      return 'gpus';
    }
    const fields = readCsvRecord(value);
    if (fields === null)
      throw refuse(read, 'The value given to --gpus is not a comma-separated list, or a quote in it is not closed.');
    const entry: Bag = {};
    let count: number | string | null = null;
    let devices: string[] | null = null;
    let capabilities: string[] | null = null;
    const seen = new Set<string>();
    let dollarKey = false;
    fields.forEach((field, i) => {
      const [key, given] = cut(field);
      const where = `Field ${i + 1} of the --gpus value`;
      const named = given === null ? 'count' : key;
      if (seen.has(named)) throw refuse(read, `${where} repeats a name that was already given.`);
      seen.add(named);
      const text = given ?? key;
      switch (named) {
        case 'count':
          if (text === 'all') count = 'all';
          else if (isWhole(text)) count = Number(text);
          else throw refuse(read, `${where} must be all or a whole number.`);
          break;
        case 'driver':
          entry['driver'] = text;
          break;
        case 'device':
          devices = text.split(',');
          break;
        case 'capabilities':
          capabilities = text.split(',');
          break;
        case 'options': {
          const optionFields = readCsvRecord(text);
          if (optionFields === null) throw refuse(read, `${where} is not a comma-separated list.`);
          const options: Bag = bag();
          for (const optionField of optionFields) {
            const [optionKey, optionValue] = cut(optionField);
            if (holdsDollar(optionKey)) dollarKey = true;
            options[optionKey] = optionValue ?? '';
          }
          entry['options'] = options;
          break;
        }
        default:
          throw refuse(read, `${where} is not an option this page reads for --gpus.`);
      }
    });
    if (dollarKey) return this.nameHoldsDollar(read, 'gpus.options');
    const result: Bag = { capabilities: [...(capabilities ?? []), 'gpu'] };
    if (count !== null) result['count'] = count;
    else if (devices === null) result['count'] = 1;
    if (devices !== null) result['device_ids'] = devices;
    for (const key of Object.keys(entry)) result[key] = entry[key];
    this.pushGpu(result);
    return 'gpus';
  }

  /** Adds one entry to the gpus list, which is created (and put in the service) when the first one arrives. */
  private pushGpu(entry: string | Bag): void {
    if (this.gpus === null) {
      this.gpus = [];
      this.service['gpus'] = this.gpus;
    }
    this.gpus.push(entry);
  }

  private network(read: ParsedOption): string {
    const value = read.value ?? '';
    let target = value;
    const use: NetworkUse = { name: '', aliases: [], linkLocal: [], driverOpts: null };
    let attributes = false;
    if (hasLongSyntax(value)) {
      const fields = readCsvRecord(value);
      if (fields === null)
        throw refuse(
          read,
          'The value given to --network is not a comma-separated list, or a quote in it is not closed.',
        );
      target = '';
      fields.forEach((field, i) => {
        const [key, given] = cut(field);
        const where = `Field ${i + 1} of the --network value`;
        if (key === '' || given === null) throw refuse(read, `${where} must be a name=value pair.`);
        switch (key.toLowerCase()) {
          case 'name':
            target = given;
            break;
          case 'alias':
            use.aliases.push(given);
            attributes = true;
            break;
          case 'ip':
            use.ipv4 = given;
            attributes = true;
            break;
          case 'ip6':
            use.ipv6 = given;
            attributes = true;
            break;
          case 'mac-address':
            use.mac = given;
            attributes = true;
            break;
          case 'link-local-ip':
            use.linkLocal.push(given);
            attributes = true;
            break;
          case 'driver-opt': {
            const [optionKey, optionValue] = cut(given);
            if (optionValue === null) throw refuse(read, `${where} must be a driver option written as key=value.`);
            if (holdsDollar(optionKey)) {
              this.needs.push({
                option: '--network driver-opt',
                key: 'networks.driver_opts',
                reason: NAME_HAS_DOLLAR_REASON,
              });
              break;
            }
            use.driverOpts ??= bag();
            use.driverOpts[optionKey] = optionValue;
            attributes = true;
            break;
          }
          case 'gw-priority':
            if (!isWhole(given)) throw refuse(read, `${where} must be a whole number.`);
            use.priority = Number(given);
            attributes = true;
            break;
          default:
            throw refuse(read, `${where} is not an option this page reads for --network.`);
        }
      });
      if (target === '') throw refuse(read, 'The --network value needs a network name (name=...).');
    }
    if (NETWORK_MODES.has(target) || target.startsWith('container:')) {
      if (attributes) throw refuse(read, 'A network mode such as host cannot take per-network settings.');
      if (this.userNetworks.length > 0 || (this.networkMode !== null && this.networkMode !== target)) {
        throw refuse(
          read,
          'A network mode (host, none, bridge, default or container:) cannot be combined with another --network.',
        );
      }
      this.networkMode = target;
      return 'network_mode';
    }
    if (this.networkMode !== null) {
      throw refuse(
        read,
        'A network mode (host, none, bridge, default or container:) cannot be combined with another --network.',
      );
    }
    if (holdsDollar(target)) {
      this.skippedNetwork = true;
      this.needs.push({ option: '--network', key: 'networks', reason: NAME_HAS_DOLLAR_REASON });
      return NOT_WRITTEN_NAME_HAS_DOLLAR;
    }
    use.name = target;
    const same = this.userNetworks.find((n) => n.name === target);
    if (same === undefined) {
      this.userNetworks.push(use);
    } else {
      same.aliases.push(...use.aliases);
      same.linkLocal.push(...use.linkLocal);
      if (use.ipv4 !== undefined) same.ipv4 = use.ipv4;
      if (use.ipv6 !== undefined) same.ipv6 = use.ipv6;
      if (use.mac !== undefined) same.mac = use.mac;
      if (use.priority !== undefined) same.priority = use.priority;
      if (use.driverOpts !== null) same.driverOpts = { ...(same.driverOpts ?? {}), ...use.driverOpts };
    }
    return 'networks';
  }

  /** Places the address and alias options, writes the networks and the network mode, and fills the tail of the service. */
  finish(
    command: string[],
    asked: string | undefined,
    usesPwd: boolean,
    unknown: number,
    interpolated: boolean,
  ): { document: ComposeDocument; hints: string[] } {
    const network =
      this.userNetworks.length === 1 && this.networkMode === null && !this.skippedNetwork
        ? this.userNetworks[0]!
        : null;
    for (const pending of this.pendingNetwork) {
      const option = pending.read.option;
      const canonical = option.alias ?? option.name;
      const value = pending.read.value ?? '';
      const row = this.rows[pending.rowIndex]!;
      if (network === null) {
        const why =
          this.networkMode !== null
            ? 'A network mode such as host has no per-network settings, so this is listed instead of written.'
            : this.skippedNetwork
              ? 'A network was named with a dollar sign in its name and is not written, so it is not clear which network this belongs to; it is listed instead of written.'
              : this.userNetworks.length > 1
                ? 'Several networks are named, so it is not clear which one this belongs to; it is listed instead of written.'
                : (option.reason ?? '');
        this.needs.push({ option: `--${option.name}`, key: option.compose ?? '', reason: why });
        row.key = NOT_WRITTEN_NEEDS_NETWORK;
        continue;
      }
      if (canonical === 'ip') {
        network.ipv4 = value;
        row.key = `networks.${visible(network.name)}.ipv4_address`;
      } else if (canonical === 'ip6') {
        network.ipv6 = value;
        row.key = `networks.${visible(network.name)}.ipv6_address`;
      } else if (canonical === 'link-local-ip') {
        network.linkLocal.push(value);
        row.key = `networks.${visible(network.name)}.link_local_ips`;
      } else {
        network.aliases.push(value);
        row.key = `networks.${visible(network.name)}.aliases`;
      }
    }

    const topNetworks: Bag = bag();
    if (this.networkMode !== null) {
      this.service['network_mode'] = this.networkMode;
    } else if (this.userNetworks.length > 0) {
      const detailed = this.userNetworks.some(
        (n) =>
          n.aliases.length > 0 ||
          n.ipv4 !== undefined ||
          n.ipv6 !== undefined ||
          n.linkLocal.length > 0 ||
          n.mac !== undefined ||
          n.driverOpts !== null ||
          n.priority !== undefined,
      );
      if (detailed) {
        const map = bag();
        for (const n of this.userNetworks) {
          const entry: Bag = {};
          if (n.aliases.length > 0) entry['aliases'] = n.aliases;
          if (n.ipv4 !== undefined) entry['ipv4_address'] = n.ipv4;
          if (n.ipv6 !== undefined) entry['ipv6_address'] = n.ipv6;
          if (n.linkLocal.length > 0) entry['link_local_ips'] = n.linkLocal;
          if (n.mac !== undefined) entry['mac_address'] = n.mac;
          if (n.driverOpts !== null) entry['driver_opts'] = n.driverOpts;
          if (n.priority !== undefined) entry['gw_priority'] = n.priority;
          map[n.name] = entry;
        }
        this.service['networks'] = map;
      } else {
        this.service['networks'] = this.userNetworks.map((n) => n.name);
      }
      for (const n of this.userNetworks) topNetworks[n.name] = { external: true };
    }

    if (this.gpus !== null) {
      const only = this.gpus.length === 1 ? this.gpus[0] : undefined;
      this.service['gpus'] =
        only === 'all' ? 'all' : this.gpus.map((g) => (g === 'all' ? { capabilities: ['gpu'], count: 'all' } : g));
    }
    if (this.entrypoint !== null) this.service['entrypoint'] = this.entrypoint;
    if (command.length > 0) this.service['command'] = command;

    const name = serviceNameFor(asked, this.typedName, String(this.service['image']));
    const services = bag();
    services[name] = this.service;
    const document: ComposeDocument = { services };
    if (Object.keys(this.topVolumes).length > 0) document['volumes'] = this.topVolumes;
    if (Object.keys(topNetworks).length > 0) document['networks'] = topNetworks;

    const hints: string[] = [];
    if (this.removeAfterRun) hints.push(`Compose runs a one-off container with docker compose run --rm ${name}.`);
    if (this.detach) hints.push('Start it in the background with docker compose up -d.');
    if (usesPwd)
      hints.push(
        `${String.fromCharCode(36)}(pwd) was written as a dot, the folder that holds the Compose file. Keep the Compose file in the folder where the command ran.`,
      );
    if (interpolated) {
      hints.push(
        `Variables such as ${String.fromCharCode(36)}NAME are left for Compose to fill in from its environment or a .env file next to the Compose file.`,
      );
    }
    if (this.variableVolume) {
      hints.push(
        `A volume source that holds a variable such as ${String.fromCharCode(36)}VOL is written as it is. If the variable holds a volume name, declare that volume under the top-level volumes key by hand: Compose cannot declare a volume from a variable, and refuses the file when a volume is used but not declared.`,
      );
    }
    if (this.entrypointWithSpaces) {
      hints.push(
        '--entrypoint is one program name, not a command line: docker uses the whole text as the program, so it is written as a one-item list. Put arguments after the image.',
      );
    }
    if (unknown > 0) {
      hints.push(
        'Docker would refuse this command because of an unknown option. If an unknown option takes a value, the word after it can be read as the image, so check the image.',
      );
    }
    return { document, hints };
  }
}

/** True when the value of --network is the comma-separated form: a name=value pair with word characters on both sides of the equals sign. */
function hasLongSyntax(value: string): boolean {
  let at = value.indexOf('=');
  while (at >= 0) {
    if (at > 0 && isWordCharacter(value[at - 1]) && isWordCharacter(value[at + 1])) return true;
    at = value.indexOf('=', at + 1);
  }
  return false;
}

function isWordCharacter(ch: string | undefined): boolean {
  return (
    ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_')
  );
}

/** An octal file mode such as 1777 as the number Compose reads (1023), or null when the text is not octal. */
function octal(text: string): number | null {
  if (text === '' || text.length > 11) return null;
  let value = 0;
  for (const ch of text) {
    if (ch < '0' || ch > '7') return null;
    value = value * 8 + (ch.charCodeAt(0) - 48);
  }
  return value;
}

/**
 * Converts a pasted docker run command into a Compose service. The command is read as text and never run. Throws a
 * DockerRunError (with a line and a column) for a paste over the limit, for anything a shell would run, and for an option
 * value docker itself would refuse. The service name is `serviceName` when given, else the name from --name, else the
 * image's last path segment, reduced to lower-case letters, digits, underscores and dashes.
 */
export function convertDockerRun(text: string, serviceName?: string): ConversionResult {
  const parsed = parseDockerCommand(text);
  const conversion = new Conversion(parsed.image);
  for (const read of parsed.options) conversion.apply(read);
  const interpolated =
    hasInterpolation(parsed.image) ||
    parsed.command.some(hasInterpolation) ||
    parsed.options.some((read) => read.value !== null && hasInterpolation(read.value));
  const { document, hints } = conversion.finish(
    parsed.command,
    serviceName,
    parsed.usesPwd,
    parsed.unknown.length,
    interpolated,
  );
  return {
    document,
    yaml: toComposeYaml(document),
    rows: conversion.rows,
    noEquivalent: conversion.noEquivalent,
    needsAnotherService: conversion.needs,
    unknown: parsed.unknown.map((entry) => ({ name: entry.shown, closest: entry.closest })),
    hints,
    validation: validateComposeDocument(document),
  };
}
