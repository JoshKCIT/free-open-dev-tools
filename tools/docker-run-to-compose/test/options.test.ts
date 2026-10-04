import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCKER_RUN_OPTIONS,
  DockerRunError,
  closestOption,
  optionByName,
  parseDockerCommand,
  type DockerRunOption,
} from '../src/index';

const CLI_DIR = join(__dirname, 'fixtures', 'docker-cli');
const D = String.fromCharCode(36);
const BS = String.fromCharCode(92);

interface Registration {
  /** The long name, without dashes. */
  name: string;
  /** The one-letter short form, or an empty string. */
  short: string;
  /** The pflag function that registered it, such as BoolVarP or Var. */
  how: string;
}

/** Calls that register a flag in the two recorded Go files. Every other `flags.` call (SetAnnotation, Changed ...) is skipped. */
const REGISTERING = new Set([
  'String',
  'StringVar',
  'StringP',
  'StringVarP',
  'Var',
  'VarP',
  'Bool',
  'BoolVar',
  'BoolP',
  'BoolVarP',
  'Int',
  'IntVar',
  'IntP',
  'IntVarP',
  'Int64',
  'Int64Var',
  'Int64P',
  'Int64VarP',
  'Uint16',
  'Uint16Var',
  'Uint64',
  'Uint64Var',
  'Duration',
  'DurationVar',
  'IPVar',
]);

function isIdentifierCharacter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'));
}

/** One pass over a Go file: every flag registration, and every name passed to MarkHidden or MarkDeprecated. */
function scanFlags(text: string): { registered: Registration[]; hidden: string[] } {
  const registered: Registration[] = [];
  const hidden: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('flags.', from);
    if (at < 0) break;
    from = at + 'flags.'.length;
    let end = from;
    while (isIdentifierCharacter(text[end])) end += 1;
    if (text[end] !== '(') continue;
    const how = text.slice(from, end);
    const open = text.indexOf('"', end);
    const close = text.indexOf('"', open + 1);
    if (how === 'MarkHidden' || how === 'MarkDeprecated') {
      hidden.push(text.slice(open + 1, close));
      continue;
    }
    if (!REGISTERING.has(how)) continue;
    const name = text.slice(open + 1, close);
    let short = '';
    if (how.endsWith('P')) {
      let next = close + 1;
      while (text[next] === ',' || text[next] === ' ') next += 1;
      if (text[next] === '"') short = text.slice(next + 1, text.indexOf('"', next + 1));
    }
    registered.push({ name, short, how });
  }
  return { registered, hidden };
}

function registrations(): { registered: Registration[]; hidden: string[] } {
  const registered: Registration[] = [];
  const hidden: string[] = [];
  for (const file of ['opts.go', 'run.go']) {
    const scanned = scanFlags(readFileSync(join(CLI_DIR, file), 'utf8'));
    registered.push(...scanned.registered);
    hidden.push(...scanned.hidden);
  }
  return { registered, hidden };
}

it('every option the Docker CLI registers for docker run is in the option table with a Compose key or a reason', () => {
  const { registered, hidden } = registrations();
  // 108 registrations in the recorded files: 102 shown by docker run --help, 5 hidden or deprecated, and --umask.
  expect(registered).toHaveLength(108);
  expect(new Set(registered.map((r) => r.name)).size).toBe(108);
  expect(DOCKER_RUN_OPTIONS).toHaveLength(108);
  expect(new Set(DOCKER_RUN_OPTIONS.map((o) => o.name)).size).toBe(108);

  for (const flag of registered) {
    const option = optionByName.get(`--${flag.name}`);
    expect(option, `--${flag.name} is missing from the table`).toBeDefined();
    if (option === undefined) continue;
    if (flag.short !== '') {
      expect(option.short, `--${flag.name} short form`).toBe(flag.short);
      expect(optionByName.get(`-${flag.short}`), `-${flag.short}`).toBe(option);
    } else {
      expect(option.short, `--${flag.name} has no short form`).toBeUndefined();
    }
    // The value kind follows the flag's Go type.
    if (flag.how.startsWith('Bool')) expect(option.value, flag.name).toBe('none');
    else if (flag.how.startsWith('Duration')) expect(option.value, flag.name).toBe('duration');
    else if (flag.how.startsWith('Int') || flag.how.startsWith('Uint')) expect(option.value, flag.name).toBe('number');
    else if (flag.how.startsWith('String') || flag.how.startsWith('IP')) expect(option.value, flag.name).toBe('string');
    else expect(option.value, flag.name).not.toBe('none');
  }
  // Nothing in the table is invented: every entry is a registered flag.
  const registeredNames = new Set(registered.map((r) => r.name));
  for (const option of DOCKER_RUN_OPTIONS) expect(registeredNames.has(option.name), option.name).toBe(true);

  // The hidden and deprecated flags are marked, and only those.
  expect(new Set(hidden)).toEqual(new Set(['dns-opt', 'net', 'net-alias', 'kernel-memory', 'disable-content-trust']));
  expect(new Set(DOCKER_RUN_OPTIONS.filter((o) => o.hidden === true).map((o) => o.name))).toEqual(new Set(hidden));

  const shorts = DOCKER_RUN_OPTIONS.flatMap((o) => (o.short === undefined ? [] : [o.short])).sort();
  expect(shorts).toEqual(['P', 'a', 'c', 'd', 'e', 'h', 'i', 'l', 'm', 'p', 'q', 't', 'u', 'v', 'w']);

  // Every entry says what it becomes, or why it becomes nothing; an entry with no key always has a reason.
  for (const option of DOCKER_RUN_OPTIONS) {
    expect(
      option.compose !== null || (option.reason ?? '').length > 20,
      `--${option.name} needs a Compose key or a reason`,
    ).toBe(true);
    if (option.compose !== null) expect(option.compose.length, option.name).toBeGreaterThan(0);
  }
});

it('the option table is a Map lookup by long and short name', () => {
  expect(optionByName).toBeInstanceOf(Map);
  expect(optionByName.get('--publish')?.compose).toBe('ports');
  expect(optionByName.get('-p')?.name).toBe('publish');
  expect(optionByName.get('--rm')?.compose).toBeNull();
  // Long and short names share one namespace only through their dashes: a long name is never read as a short one.
  expect(optionByName.get('p')).toBeUndefined();
  expect(optionByName.get('--p')).toBeUndefined();
  // The names registered twice (the old and the new spelling) have one meaning.
  expect(optionByName.get('--net')?.compose).toBe(optionByName.get('--network')?.compose);
  expect(optionByName.get('--dns-opt')?.compose).toBe(optionByName.get('--dns-option')?.compose);
  expect(optionByName.get('--net-alias')?.compose).toBe(optionByName.get('--network-alias')?.compose);
});

function names(text: string): string[] {
  return parseDockerCommand(text).options.map((o) => o.option.name);
}

function entries(text: string): [string, string | null][] {
  return parseDockerCommand(text).options.map((o) => [o.option.name, o.value]);
}

it('words after the image are the command even when they start with a dash', () => {
  const read = parseDockerCommand(
    `docker run -itd --name web -p8080:80 -e KEY=${D}KEY -v ${D}(pwd):/app nginx:1.27 nginx -g 'daemon off;'`,
  );
  expect(read.options.map((o) => [o.option.name, o.value])).toEqual([
    ['interactive', null],
    ['tty', null],
    ['detach', null],
    ['name', 'web'],
    ['publish', '8080:80'],
    ['env', `KEY=${D}KEY`],
    ['volume', '.:/app'],
  ]);
  expect(read.image).toBe('nginx:1.27');
  expect(read.command).toEqual(['nginx', '-g', 'daemon off;']);

  const later = parseDockerCommand('docker run nginx -p 80:80');
  expect(later.options).toEqual([]);
  expect(later.image).toBe('nginx');
  expect(later.command).toEqual(['-p', '80:80']);

  const dashes = parseDockerCommand('docker run --rm nginx --rm -- -d --name x');
  expect(dashes.options.map((o) => o.option.name)).toEqual(['rm']);
  expect(dashes.command).toEqual(['--rm', '--', '-d', '--name', 'x']);

  // -- ends the options: the next word is the image even when it starts with a dash.
  const ended = parseDockerCommand('docker run -d -- -weird-image arg');
  expect(ended.options.map((o) => o.option.name)).toEqual(['detach']);
  expect(ended.image).toBe('-weird-image');
  expect(ended.command).toEqual(['arg']);

  // A value that starts with a dash is still the value of the option before it.
  expect(entries('docker run --cpus -1 --memory-swap -1 nginx')).toEqual([
    ['cpus', '-1'],
    ['memory-swap', '-1'],
  ]);
  // A boolean never takes the next word as its value.
  const boolean = parseDockerCommand('docker run --rm false');
  expect(boolean.options.map((o) => [o.option.name, o.value])).toEqual([['rm', null]]);
  expect(boolean.image).toBe('false');
  // A lone dash is a word, not an option.
  expect(parseDockerCommand('docker run -').image).toBe('-');
});

it('long, short, bundled, attached and equals forms of an option read the same', () => {
  for (const form of [
    '--publish 8080:80',
    '--publish=8080:80',
    '-p 8080:80',
    '-p8080:80',
    '-p=8080:80',
    '-itp8080:80',
    '-it -p 8080:80',
  ]) {
    const read = parseDockerCommand(`docker run ${form} nginx`);
    const publish = read.options.filter((o) => o.option.name === 'publish');
    expect(
      publish.map((o) => o.value),
      form,
    ).toEqual(['8080:80']);
  }
  for (const form of ['--rm', '--rm=true', '--rm=TRUE', '--rm=1']) {
    expect(entries(`docker run ${form} nginx`)[0]?.[0], form).toBe('rm');
  }
  expect(entries('docker run --rm=false nginx')).toEqual([['rm', 'false']]);
  expect(entries('docker run -d=false nginx')).toEqual([['detach', 'false']]);
  expect(entries('docker run -itd nginx')).toEqual([
    ['interactive', null],
    ['tty', null],
    ['detach', null],
  ]);
  expect(entries(`docker run -eFOO=bar -e=BAZ=1 --env=A=B --env C=D nginx`)).toEqual([
    ['env', 'FOO=bar'],
    ['env', 'BAZ=1'],
    ['env', 'A=B'],
    ['env', 'C=D'],
  ]);
  expect(entries('docker run -h web -u 1000:1000 -w /app -m 512m -c 512 -l a=b -P -q -a stdout nginx')).toEqual([
    ['hostname', 'web'],
    ['user', '1000:1000'],
    ['workdir', '/app'],
    ['memory', '512m'],
    ['cpu-shares', '512'],
    ['label', 'a=b'],
    ['publish-all', null],
    ['quiet', null],
    ['attach', 'stdout'],
  ]);
  expect(entries('docker run --name=web --name web2 nginx')).toEqual([
    ['name', 'web'],
    ['name', 'web2'],
  ]);
  // The empty value is a value: --entrypoint "" clears the image's entrypoint.
  expect(entries('docker run --entrypoint "" nginx')).toEqual([['entrypoint', '']]);
  expect(entries('docker run --entrypoint= nginx')).toEqual([['entrypoint', '']]);
  // The same option names an old and a new spelling in the table; both read the same way.
  expect(names('docker run --net host --network host nginx')).toEqual(['net', 'network']);
  expect(optionByName.get('--net')?.alias).toBe('network');

  // docker container run is docker run.
  expect(parseDockerCommand('docker container run -d nginx').options.map((o) => o.option.name)).toEqual(['detach']);
  // Each option carries the line and column of the word it came from.
  const placed = parseDockerCommand(`docker run ${BS}\n  --name web nginx`);
  expect([placed.options[0]?.line, placed.options[0]?.column]).toEqual([2, 3]);
});

it('only docker run commands with an image and well-formed values are read', () => {
  const refused = [
    'docker ps -a',
    'docker',
    'sudo docker run nginx',
    'docker --context x run nginx',
    'docker run',
    'docker run -d',
    'docker run -e',
    'docker run --name',
    'docker run -d -p',
    'docker run --rm=maybe nginx',
    'docker run --memory 512x nginx',
    'docker run --health-interval 30 nginx',
    'docker run --cpus abc nginx',
    'docker run --stop-timeout 1.5.2 nginx',
  ];
  for (const text of refused) {
    expect(() => parseDockerCommand(text), text).toThrow(DockerRunError);
  }
  const accepted = [
    'docker run --memory 512m --memory-reservation 1g --shm-size 64mb --memory-swap -1 nginx',
    'docker run --health-interval 30s --health-timeout 1m30s --health-start-period 500ms --health-start-interval 0 nginx',
    'docker run --cpus 1.5 --cpu-shares 512 --stop-timeout 20 --pids-limit -1 --oom-score-adj -500 nginx',
    'docker run --rm=f --init=0 --privileged=T nginx',
  ];
  for (const text of accepted) expect(() => parseDockerCommand(text), text).not.toThrow();

  // The message names the option, never the value, and a refusal carries the position of the word.
  const marker = 'FODT-MARK-7731';
  try {
    parseDockerCommand(`docker run -d --memory ${marker} nginx`);
    throw new Error('expected a refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(DockerRunError);
    const refusal = error as DockerRunError;
    expect(refusal.message).toContain('--memory');
    expect(refusal.message).not.toContain(marker);
    expect([refusal.line, refusal.column]).toEqual([1, 15]);
  }
  for (const text of [`docker ${marker}`, `docker run ${marker}=`, `sudo ${marker}`]) {
    try {
      parseDockerCommand(text);
    } catch (error) {
      expect((error as Error).message, text).not.toContain(marker);
    }
  }
});

it('unknown options are refused with the closest known name and no long pasted text', () => {
  const read = parseDockerCommand('docker run --nam=web --nonexistent -z --memry=1g nginx');
  expect(read.unknown.map((u) => [u.name, u.closest])).toEqual([
    ['--nam', '--name'],
    ['--nonexistent', null],
    ['-z', null],
    ['--memry', '--memory'],
  ]);
  expect(read.image).toBe('nginx');
  // Unknown options are reported, never turned into table entries.
  expect(read.options).toEqual([]);

  expect(closestOption('nam')).toBe('--name');
  expect(closestOption('publsh')).toBe('--publish');
  expect(closestOption('detatch')).toBe('--detach');
  expect(closestOption('nonexistent')).toBeNull();
  expect(closestOption('x')).toBeNull();
  // Two changes away is the most that still gets a suggestion.
  expect(closestOption('publishxx')).toBe('--publish');
  expect(closestOption('xpublishxx')).toBeNull();
  expect(closestOption('')).toBeNull();

  // A long unknown name is cut at 40 characters, with control characters written out.
  const long = `--${'a'.repeat(100)}`;
  const cut = parseDockerCommand(`docker run ${long} nginx`);
  expect(cut.unknown).toHaveLength(1);
  expect(cut.unknown[0]?.shown.length).toBeLessThanOrEqual(41);
  expect(cut.unknown[0]?.shown.endsWith(String.fromCodePoint(0x2026))).toBe(true);
  const control = parseDockerCommand(`docker run --a${String.fromCharCode(7)}b nginx`);
  expect(control.unknown[0]?.shown).toBe(`--a${BS}u{7}b`);
});

it('option names __proto__, constructor and toString are unknown options', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const read = parseDockerCommand(`docker run --${name} --${name}=x nginx`);
    expect(
      read.unknown.map((u) => u.name),
      name,
    ).toEqual([`--${name}`, `--${name}`]);
    expect(read.options, name).toEqual([]);
    expect(read.image).toBe('nginx');
    expect(optionByName.get(`--${name}`)).toBeUndefined();
    expect(closestOption(name)).not.toBe(name);
  }
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
});

it('the table is complete for the options a Compose service can hold', () => {
  const byCompose = (key: string): DockerRunOption[] => DOCKER_RUN_OPTIONS.filter((o) => o.compose === key);
  expect(byCompose('ports').map((o) => o.name)).toEqual(['publish']);
  expect(byCompose('environment').map((o) => o.name)).toEqual(['env']);
  expect(byCompose('healthcheck.test').map((o) => o.name)).toEqual(['health-cmd']);
  const none = DOCKER_RUN_OPTIONS.filter((o) => o.compose === null).map((o) => o.name);
  for (const name of [
    'rm',
    'detach',
    'cidfile',
    'sig-proxy',
    'publish-all',
    'attach',
    'quiet',
    'help',
    'umask',
    'kernel-memory',
    'volume-driver',
  ]) {
    expect(none, name).toContain(name);
  }
  for (const option of DOCKER_RUN_OPTIONS.filter((o) => o.compose === null)) {
    expect(option.reason, option.name).toBeTruthy();
  }
});
