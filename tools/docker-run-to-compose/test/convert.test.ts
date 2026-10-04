import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  DOCKER_RUN_OPTIONS,
  DockerRunError,
  convertDockerRun,
  hasInterpolation,
  optionByName,
  readCsvRecord,
  toComposeYaml,
  validateComposeDocument,
} from '../src/index';

const D = String.fromCharCode(36);
const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);

interface Sample {
  option: string;
  command: string;
  path: string | null;
  result: 'written' | 'needs-service' | 'no-equivalent';
}
const SAMPLES: Sample[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'samples.json'), 'utf8'));

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** The value at a dotted path of a document, or undefined. */
function at(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

interface Recorded {
  command: string;
  yaml: string;
}

/** Ten commands and the YAML each one becomes. The browser test in e2e/dev-oracles.spec.ts holds the same ten. */
const RECORDED: Recorded[] = [
  {
    command: 'docker run --rm -p 8080:80 nginx',
    yaml: ['services:', '  nginx:', '    image: "nginx"', '    ports:', '      - "8080:80"', ''].join(LF),
  },
  {
    command: `docker run -d --name web -p 8080:80 -v ${D}(pwd):/usr/share/nginx/html:ro --restart unless-stopped nginx:1.27`,
    yaml: [
      'services:',
      '  web:',
      '    image: "nginx:1.27"',
      '    container_name: "web"',
      '    ports:',
      '      - "8080:80"',
      '    volumes:',
      '      - ".:/usr/share/nginx/html:ro"',
      '    restart: "unless-stopped"',
      '',
    ].join(LF),
  },
  {
    command:
      'docker run -d --name db -e POSTGRES_PASSWORD=example -e POSTGRES_DB=app -v pgdata:/var/lib/postgresql/data -p 127.0.0.1:5432:5432 postgres:16',
    yaml: [
      'services:',
      '  db:',
      '    image: "postgres:16"',
      '    container_name: "db"',
      '    environment:',
      '      - "POSTGRES_PASSWORD=example"',
      '      - "POSTGRES_DB=app"',
      '    volumes:',
      '      - "pgdata:/var/lib/postgresql/data"',
      '    ports:',
      '      - "127.0.0.1:5432:5432"',
      'volumes:',
      '  pgdata:',
      '    name: "pgdata"',
      '',
    ].join(LF),
  },
  {
    command: `docker run --network appnet --network-alias api -e API_KEY=${D}API_KEY -p 3000:3000 ghcr.io/example/api:2.1`,
    yaml: [
      'services:',
      '  api:',
      '    image: "ghcr.io/example/api:2.1"',
      '    environment:',
      `      - "API_KEY=${D}API_KEY"`,
      '    ports:',
      '      - "3000:3000"',
      '    networks:',
      '      appnet:',
      '        aliases:',
      '          - "api"',
      'networks:',
      '  appnet:',
      '    external: true',
      '',
    ].join(LF),
  },
  {
    command: 'docker run -m 512m --cpus 1.5 --pids-limit 100 --memory-swap 1g --name worker busybox sleep 3600',
    yaml: [
      'services:',
      '  worker:',
      '    image: "busybox"',
      '    mem_limit: "512m"',
      '    cpus: 1.5',
      '    pids_limit: 100',
      '    memswap_limit: "1g"',
      '    container_name: "worker"',
      '    command:',
      '      - "sleep"',
      '      - "3600"',
      '',
    ].join(LF),
  },
  {
    command:
      "docker run --name web --health-cmd 'curl -f http://localhost/ || exit 1' --health-interval 30s --health-timeout 5s --health-retries 3 nginx",
    yaml: [
      'services:',
      '  web:',
      '    image: "nginx"',
      '    container_name: "web"',
      '    healthcheck:',
      '      test:',
      '        - "CMD-SHELL"',
      '        - "curl -f http://localhost/ || exit 1"',
      '      interval: "30s"',
      '      timeout: "5s"',
      '      retries: 3',
      '',
    ].join(LF),
  },
  {
    command: [
      'docker run -d ' + BS,
      '  --name cache ' + BS,
      '  --restart=always ' + BS,
      '  -p 6379:6379 ' + BS,
      '  -v redis-data:/data ' + BS,
      '  redis:7 redis-server --appendonly yes',
    ].join(LF),
    yaml: [
      'services:',
      '  cache:',
      '    image: "redis:7"',
      '    container_name: "cache"',
      '    restart: "always"',
      '    ports:',
      '      - "6379:6379"',
      '    volumes:',
      '      - "redis-data:/data"',
      '    command:',
      '      - "redis-server"',
      '      - "--appendonly"',
      '      - "yes"',
      'volumes:',
      '  redis-data:',
      '    name: "redis-data"',
      '',
    ].join(LF),
  },
  {
    command:
      'docker run --ulimit nofile=1024:2048 --ulimit nproc=65535 --sysctl net.core.somaxconn=1024 --storage-opt size=1G --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 alpine',
    yaml: [
      'services:',
      '  alpine:',
      '    image: "alpine"',
      '    ulimits:',
      '      nofile:',
      '        soft: 1024',
      '        hard: 2048',
      '      nproc: 65535',
      '    sysctls:',
      '      - "net.core.somaxconn=1024"',
      '    storage_opt:',
      '      size: "1G"',
      '    logging:',
      '      driver: "json-file"',
      '      options:',
      '        max-size: "10m"',
      '        max-file: "3"',
      '',
    ].join(LF),
  },
  {
    command: `docker run --mount type=volume,source=data,target=/data,volume-nocopy --mount type=bind,source=${D}(pwd)/conf,target=/etc/app,readonly --tmpfs /run alpine`,
    yaml: [
      'services:',
      '  alpine:',
      '    image: "alpine"',
      '    volumes:',
      '      - type: "volume"',
      '        source: "data"',
      '        target: "/data"',
      '        volume:',
      '          nocopy: true',
      '      - type: "bind"',
      '        source: "./conf"',
      '        target: "/etc/app"',
      '        read_only: true',
      '    tmpfs:',
      '      - "/run"',
      'volumes:',
      '  data:',
      '    name: "data"',
      '',
    ].join(LF),
  },
  {
    command: `docker run -it --entrypoint /bin/sh --workdir /work -u 1000:1000 -e MODE=production -e 'GREETING=hello world' alpine -c 'echo ${D}HOME'`,
    yaml: [
      'services:',
      '  alpine:',
      '    image: "alpine"',
      '    stdin_open: true',
      '    tty: true',
      '    working_dir: "/work"',
      '    user: "1000:1000"',
      '    environment:',
      '      - "MODE=production"',
      '      - "GREETING=hello world"',
      '    entrypoint:',
      '      - "/bin/sh"',
      '    command:',
      '      - "-c"',
      `      - "echo ${D}${D}HOME"`,
      '',
    ].join(LF),
  },
];

it('recorded commands convert to exactly the YAML in the record', () => {
  expect(RECORDED).toHaveLength(10);
  for (const recorded of RECORDED) {
    const result = convertDockerRun(recorded.command);
    expect(result.yaml, recorded.command).toBe(recorded.yaml);
    expect(result.validation.valid, recorded.command).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(Object.keys(result.document)[0]).toBe('services');
    expect(Object.hasOwn(result.document, 'version')).toBe(false);
  }
});

it('every mapped option produces a service the vendored Compose schema accepts', () => {
  // One sample for every option the table holds, the old and the new spellings included.
  expect(SAMPLES.map((s) => s.option).sort()).toEqual(DOCKER_RUN_OPTIONS.map((o) => o.name).sort());
  for (const sample of SAMPLES) {
    const result = convertDockerRun(sample.command);
    expect(result.validation.errors, sample.command).toEqual([]);
    expect(result.validation.valid, sample.command).toBe(true);
    // The YAML read back is the document that was checked.
    expect(parse(result.yaml), sample.command).toEqual(JSON.parse(JSON.stringify(result.document)));
    const service = Object.values(result.document['services'] as Record<string, Record<string, unknown>>)[0]!;
    const row = result.rows.find((r) => r.option === `--${sample.option}`);
    expect(row, `${sample.option} has a row`).toBeDefined();
    const option = optionByName.get(`--${sample.option}`)!;
    if (sample.result === 'written') {
      expect(option.compose, sample.option).not.toBeNull();
      expect(at(service, sample.path!), `${sample.option} writes ${sample.path}`).toBeDefined();
      expect(
        result.noEquivalent.some((e) => e.option === `--${sample.option}`),
        sample.option,
      ).toBe(false);
    } else if (sample.result === 'needs-service') {
      expect(
        result.needsAnotherService.map((e) => e.option),
        sample.option,
      ).toContain(`--${sample.option}`);
    } else {
      expect(option.compose, sample.option).toBeNull();
      expect(
        result.noEquivalent.map((e) => e.option),
        sample.option,
      ).toContain(`--${sample.option}`);
    }
  }
});

it('options with no Compose equivalent are listed with their reason', () => {
  const result = convertDockerRun(
    'docker run --rm -d --cidfile /tmp/c.id --sig-proxy=false -P -q --detach-keys ctrl-x -a stdout web:1',
  );
  const listed = new Map(result.noEquivalent.map((e) => [e.option, e.reason]));
  for (const name of ['rm', 'detach', 'cidfile', 'sig-proxy', 'publish-all', 'quiet', 'detach-keys', 'attach']) {
    expect(listed.has(`--${name}`), name).toBe(true);
    expect(listed.get(`--${name}`), name).toBe(optionByName.get(`--${name}`)?.reason);
    expect((listed.get(`--${name}`) ?? '').length).toBeGreaterThan(20);
  }
  // Nothing of them is written.
  const service = result.document['services'] as Record<string, Record<string, unknown>>;
  expect(Object.keys(service['web']!)).toEqual(['image']);
  expect(result.hints).toContain('Compose runs a one-off container with docker compose run --rm web.');
  expect(result.hints).toContain('Start it in the background with docker compose up -d.');
  // The hints are given only when the flag is on.
  const off = convertDockerRun('docker run --rm=false --detach=false web');
  expect(off.noEquivalent.map((e) => e.option)).toEqual(['--rm', '--detach']);
  expect(off.hints.some((h) => h.includes('docker compose run --rm'))).toBe(false);
  expect(off.hints.some((h) => h.includes('docker compose up -d'))).toBe(false);
  // A mount option that has no service-level key is listed by its own name.
  const mount = convertDockerRun(
    'docker run --mount type=volume,source=data,target=/d,volume-driver=local,volume-opt=a=b web',
  );
  expect(mount.noEquivalent.map((e) => e.option)).toEqual(['--mount volume-driver', '--mount volume-opt']);
  expect(mount.noEquivalent[0]?.reason).toContain('top-level volumes');
});

it('named volumes and user networks are declared at the top level and storage options are a map', () => {
  const volumes = convertDockerRun(
    'docker run -v data:/var/lib/data -v my.vol:/x:ro -v ./rel:/r -v /abs:/a -v ~/home:/h -v /anon --mount type=volume,source=other,target=/o nginx',
  );
  // Each is declared with its own name, so Compose reuses the volume docker run made instead of a project-prefixed new one.
  expect(volumes.document['volumes']).toEqual({
    data: { name: 'data' },
    'my.vol': { name: 'my.vol' },
    other: { name: 'other' },
  });
  expect(at(volumes.document, 'services.nginx.volumes')).toEqual([
    'data:/var/lib/data',
    'my.vol:/x:ro',
    './rel:/r',
    '/abs:/a',
    '~/home:/h',
    '/anon',
    { type: 'volume', source: 'other', target: '/o' },
  ]);
  // A Windows drive letter is a path, not a volume name.
  const drive = convertDockerRun(`docker run -v C:${BS}${BS}data:/data -v C:/data:/d2 nginx`);
  expect(Object.hasOwn(drive.document, 'volumes')).toBe(false);
  // A one-letter source is not a volume name (docker's names have at least two characters).
  expect(Object.hasOwn(convertDockerRun('docker run -v x:data nginx').document, 'volumes')).toBe(false);
  // A source with a variable cannot be told from a name, so it is not declared.
  expect(Object.hasOwn(convertDockerRun(`docker run -v ${D}DATA:/data nginx`).document, 'volumes')).toBe(false);

  const networks = convertDockerRun('docker run --network appnet --network other nginx');
  expect(networks.document['networks']).toEqual({ appnet: { external: true }, other: { external: true } });
  expect(at(networks.document, 'services.nginx.networks')).toEqual(['appnet', 'other']);
  expect(networks.yaml).toContain(
    'networks:\n      - "appnet"\n      - "other"\nnetworks:\n  appnet:\n    external: true',
  );

  for (const mode of ['host', 'none', 'bridge', 'container:db']) {
    const result = convertDockerRun(`docker run --network ${mode} nginx`);
    expect(at(result.document, 'services.nginx.network_mode'), mode).toBe(mode);
    expect(Object.hasOwn(result.document, 'networks'), mode).toBe(false);
    expect(at(result.document, 'services.nginx.networks'), mode).toBeUndefined();
    expect(result.validation.valid, mode).toBe(true);
  }
  expect(() => convertDockerRun('docker run --network host --network appnet nginx')).toThrow(DockerRunError);

  const storage = convertDockerRun('docker run --storage-opt size=1G --storage-opt dm.basesize=20G nginx');
  expect(at(storage.document, 'services.nginx.storage_opt')).toEqual({ size: '1G', 'dm.basesize': '20G' });
  expect(storage.yaml).toContain('storage_opt:\n      size: "1G"');
  expect(storage.validation.valid).toBe(true);
  expect(Array.isArray(at(storage.document, 'services.nginx.storage_opt'))).toBe(false);
});

it('scalars that YAML 1.1 could misread are double quoted', () => {
  const result = convertDockerRun(
    'docker run --restart no -p 22:22 -p 80 -e A=yes -e B=on -e C=0123 -e D=1e3 -e E=null -e F=~ -l g=true --hostname off --user 0755 --expose 22:22 nginx yes no 1e3 0123 null',
  );
  for (const line of [
    'restart: "no"',
    '- "22:22"',
    '- "80"',
    '- "A=yes"',
    '- "B=on"',
    '- "C=0123"',
    '- "D=1e3"',
    '- "E=null"',
    '- "F=~"',
    '- "g=true"',
    'hostname: "off"',
    'user: "0755"',
    '- "yes"',
    '- "no"',
    '- "1e3"',
    '- "0123"',
    '- "null"',
  ]) {
    expect(result.yaml, line).toContain(line);
  }
  // Read back by a YAML 1.1 reader and a YAML 1.2 reader, the document is the same.
  const expected = JSON.parse(JSON.stringify(result.document));
  expect(parse(result.yaml, { version: '1.1' })).toEqual(expected);
  expect(parse(result.yaml, { version: '1.2' })).toEqual(expected);
  expect(at(expected, 'services.nginx.restart')).toBe('no');
  expect(typeof at(expected, 'services.nginx.hostname')).toBe('string');
  expect(Object.hasOwn(expected, 'version')).toBe(false);
  expect(result.yaml.startsWith('services:')).toBe(true);
  expect(toComposeYaml({ a: 'no', b: 1, c: true, d: ['yes'] })).toBe('a: "no"\nb: 1\nc: true\nd:\n  - "yes"\n');
});

it('options that need another service in the same file are listed, not written', () => {
  const result = convertDockerRun(
    'docker run --link db:database --link cache --volumes-from other:ro --name app web:1',
  );
  const service = at(result.document, 'services.app') as Record<string, unknown>;
  expect(Object.hasOwn(service, 'links')).toBe(false);
  expect(Object.hasOwn(service, 'volumes_from')).toBe(false);
  expect(result.needsAnotherService.map((e) => [e.option, e.key])).toEqual([
    ['--link', 'links'],
    ['--link', 'links'],
    ['--volumes-from', 'volumes_from'],
  ]);
  expect(result.needsAnotherService[0]?.reason).toContain('same Compose file');
  expect(result.noEquivalent).toEqual([]);
  expect(result.validation.valid).toBe(true);

  // Network addresses are written when exactly one user-defined network is named, and listed otherwise.
  const attached = convertDockerRun(
    'docker run --network appnet --ip 172.20.0.5 --ip6 2001:db8::33 --link-local-ip 169.254.1.1 --network-alias web --network-alias api nginx',
  );
  expect(at(attached.document, 'services.nginx.networks')).toEqual({
    appnet: {
      aliases: ['web', 'api'],
      ipv4_address: '172.20.0.5',
      ipv6_address: '2001:db8::33',
      link_local_ips: ['169.254.1.1'],
    },
  });
  expect(attached.needsAnotherService).toEqual([]);
  expect(attached.validation.valid).toBe(true);

  const none = convertDockerRun('docker run --ip 172.20.0.5 --network-alias web nginx');
  expect(none.needsAnotherService.map((e) => [e.option, e.key])).toEqual([
    ['--ip', 'networks.<network>.ipv4_address'],
    ['--network-alias', 'networks.<network>.aliases'],
  ]);
  expect(Object.hasOwn(none.document, 'networks')).toBe(false);
  const host = convertDockerRun('docker run --network host --ip 172.20.0.5 nginx');
  expect(host.needsAnotherService.map((e) => e.option)).toEqual(['--ip']);
  const several = convertDockerRun('docker run --network a --network b --ip 172.20.0.5 nginx');
  expect(several.needsAnotherService.map((e) => e.option)).toEqual(['--ip']);
  expect(at(several.document, 'services.nginx.networks')).toEqual(['a', 'b']);
  // Every row says what became of its option.
  expect(none.rows.map((r) => r.key)).toEqual([
    'not written, needs a user-defined network',
    'not written, needs a user-defined network',
  ]);
});

it('--mount is read into the long volume syntax', () => {
  const bind = convertDockerRun(
    'docker run --mount type=bind,src=/data,dst=/data,ro,bind-propagation=rshared,bind-recursive=disabled,bind-create-src=false,consistency=cached nginx',
  );
  expect(at(bind.document, 'services.nginx.volumes')).toEqual([
    {
      type: 'bind',
      source: '/data',
      target: '/data',
      read_only: true,
      consistency: 'cached',
      bind: { propagation: 'rshared', recursive: 'disabled', create_host_path: false },
    },
  ]);
  const volume = convertDockerRun(
    'docker run --mount source=data,target=/d,readonly=false,volume-subpath=sub,volume-label=a=b,volume-label=c=d nginx',
  );
  expect(at(volume.document, 'services.nginx.volumes')).toEqual([
    {
      type: 'volume',
      source: 'data',
      target: '/d',
      read_only: false,
      volume: { subpath: 'sub', labels: ['a=b', 'c=d'] },
    },
  ]);
  const tmpfs = convertDockerRun('docker run --mount type=tmpfs,target=/t,tmpfs-size=64m,tmpfs-mode=1777 nginx');
  expect(at(tmpfs.document, 'services.nginx.volumes')).toEqual([
    { type: 'tmpfs', target: '/t', tmpfs: { size: '64m', mode: 1023 } },
  ]);
  const sized = convertDockerRun('docker run --mount type=tmpfs,destination=/t,tmpfs-size=1048576 nginx');
  expect(at(sized.document, 'services.nginx.volumes')).toEqual([
    { type: 'tmpfs', target: '/t', tmpfs: { size: 1048576 } },
  ]);
  const image = convertDockerRun('docker run --mount type=image,source=alpine,target=/i,image-subpath=lib nginx');
  expect(at(image.document, 'services.nginx.volumes')).toEqual([
    { type: 'image', source: 'alpine', target: '/i', image: { subpath: 'lib' } },
  ]);
  // A quoted field can hold a comma, and the names are not case sensitive.
  const quoted = convertDockerRun('docker run --mount \'"source=/a,b",TARGET=/c,Type=bind\' nginx');
  expect(at(quoted.document, 'services.nginx.volumes')).toEqual([{ type: 'bind', source: '/a,b', target: '/c' }]);
  for (const result of [bind, volume, tmpfs, sized, image, quoted]) expect(result.validation.valid).toBe(true);

  const marker = 'FODT-MARK-7731';
  for (const text of [
    `docker run --mount type=bind,${marker}=1,target=/x nginx`,
    `docker run --mount type=${marker},target=/x nginx`,
    `docker run --mount type=bind,source=/a nginx`,
    `docker run --mount "type=bind,source=/a,${marker}" nginx`,
    `docker run --mount 'type="${marker}' nginx`,
    `docker run --mount type=bind,target=/x,bind-recursive=${marker} nginx`,
    `docker run --mount type=bind,target=/x,tmpfs-mode=${marker} nginx`,
    `docker run --mount type=tmpfs,target=/x,tmpfs-size=${marker} nginx`,
    `docker run --mount type=bind,target=/x,ro=${marker} nginx`,
    `docker run --mount type=bind, nginx`,
    `docker run --mount "" nginx`,
  ]) {
    let caught: unknown;
    try {
      convertDockerRun(text);
    } catch (error) {
      caught = error;
    }
    expect(caught, text).toBeInstanceOf(DockerRunError);
    const error = caught as DockerRunError;
    expect(error.message, text).not.toContain(marker);
    expect(error.message).toContain('--mount');
    expect([error.line, error.column]).toEqual([1, 12]);
  }
});

it('network options in the long form and the gpu, ulimit and healthcheck forms are read', () => {
  const long = convertDockerRun(
    'docker run --network name=appnet,alias=web,alias=api,ip=172.20.0.9,ip6=2001:db8::9,link-local-ip=169.254.1.2,mac-address=02:42:ac:11:65:43,driver-opt=k=v,gw-priority=2 nginx',
  );
  expect(at(long.document, 'services.nginx.networks')).toEqual({
    appnet: {
      aliases: ['web', 'api'],
      ipv4_address: '172.20.0.9',
      ipv6_address: '2001:db8::9',
      link_local_ips: ['169.254.1.2'],
      mac_address: '02:42:ac:11:65:43',
      driver_opts: { k: 'v' },
      gw_priority: 2,
    },
  });
  expect(long.validation.valid).toBe(true);

  expect(at(convertDockerRun('docker run --gpus all nginx').document, 'services.nginx.gpus')).toBe('all');
  // With no count and no device, docker uses one GPU, so the count is written.
  expect(at(convertDockerRun('docker run --gpus capabilities=utility nginx').document, 'services.nginx.gpus')).toEqual([
    { capabilities: ['utility', 'gpu'], count: 1 },
  ]);
  expect(at(convertDockerRun('docker run --gpus 2 nginx').document, 'services.nginx.gpus')).toEqual([
    { capabilities: ['gpu'], count: 2 },
  ]);
  expect(at(convertDockerRun('docker run --gpus \'"device=0,2"\' nginx').document, 'services.nginx.gpus')).toEqual([
    { capabilities: ['gpu'], device_ids: ['0', '2'] },
  ]);
  expect(
    at(
      convertDockerRun("docker run --gpus 'all,capabilities=utility,driver=nvidia' nginx").document,
      'services.nginx.gpus',
    ),
  ).toEqual([{ capabilities: ['utility', 'gpu'], count: 'all', driver: 'nvidia' }]);
  for (const text of [
    'docker run --gpus all nginx',
    'docker run --gpus 2 nginx',
    'docker run --gpus \'"device=0,2"\' nginx',
  ]) {
    expect(convertDockerRun(text).validation.valid, text).toBe(true);
  }

  const ulimit = convertDockerRun('docker run --ulimit nofile=1024:2048 --ulimit nproc=65535 --ulimit core=-1 nginx');
  expect(at(ulimit.document, 'services.nginx.ulimits')).toEqual({
    nofile: { soft: 1024, hard: 2048 },
    nproc: 65535,
    core: -1,
  });
  expect(ulimit.validation.valid).toBe(true);

  const health = convertDockerRun(
    "docker run --health-cmd 'exit 0' --no-healthcheck --health-start-period 1m30s --health-start-interval 500ms nginx",
  );
  expect(at(health.document, 'services.nginx.healthcheck')).toEqual({
    test: ['CMD-SHELL', 'exit 0'],
    disable: true,
    start_period: '1m30s',
    start_interval: '500ms',
  });
  expect(at(convertDockerRun('docker run --stop-timeout 20 nginx').document, 'services.nginx.stop_grace_period')).toBe(
    '20s',
  );
  expect(at(convertDockerRun('docker run --entrypoint "" nginx').document, 'services.nginx.entrypoint')).toEqual([]);
  expect(at(convertDockerRun('docker run --entrypoint /a/b nginx x').document, 'services.nginx.entrypoint')).toEqual([
    '/a/b',
  ]);
  expect(
    at(
      convertDockerRun('docker run --add-host h:::1 --add-host g=1.2.3.4 --add-host k:host-gateway nginx').document,
      'services.nginx.extra_hosts',
    ),
  ).toEqual(['h=::1', 'g=1.2.3.4', 'k=host-gateway']);
  const sizes = convertDockerRun('docker run -m 512 --memory-swap -1 --shm-size 1.5g --cpus 2 nginx');
  expect(at(sizes.document, 'services.nginx')).toMatchObject({
    mem_limit: 512,
    memswap_limit: -1,
    shm_size: '1.5g',
    cpus: 2,
  });
  expect(sizes.validation.valid).toBe(true);
  expect(convertDockerRun('docker run --entrypoint "sh -c" nginx').hints.some((h) => h.includes('--entrypoint'))).toBe(
    true,
  );
  // Numbers are written as docker read them: a fraction, an exponent and a base prefix all become plain numbers.
  const forms = convertDockerRun('docker run --cpus 1/2 --pids-limit 0x10 --oom-score-adj +5 --cpu-shares 1_000 nginx');
  expect(at(forms.document, 'services.nginx')).toMatchObject({
    cpus: 0.5,
    pids_limit: 16,
    oom_score_adj: 5,
    cpu_shares: 1000,
  });
  expect(at(convertDockerRun('docker run --cpus 1e1 nginx').document, 'services.nginx.cpus')).toBe(10);
  expect(at(convertDockerRun('docker run --cpus .5 nginx').document, 'services.nginx.cpus')).toBe(0.5);
});

it('the service name comes from the argument, the name option or the image', () => {
  const nameOf = (text: string, name?: string): string =>
    Object.keys(convertDockerRun(text, name).document['services'] as object)[0]!;
  expect(nameOf('docker run nginx')).toBe('nginx');
  expect(nameOf('docker run nginx:1.27')).toBe('nginx');
  expect(nameOf('docker run ghcr.io/Example/My_App:2.1')).toBe('my_app');
  expect(nameOf('docker run localhost:5000/team/api@sha256:abc123')).toBe('api');
  expect(nameOf('docker run --name web nginx')).toBe('web');
  expect(nameOf('docker run --name web --name db nginx')).toBe('db');
  expect(nameOf('docker run --name web nginx', 'frontend')).toBe('frontend');
  expect(nameOf('docker run --name web nginx', '  ')).toBe('web');
  expect(nameOf('docker run --name "My App.v2" nginx')).toBe('my-app-v2');
  expect(nameOf('docker run nginx', 'FODT-Canary_7731 / x?')).toBe('fodt-canary_7731-x');
  expect(nameOf('docker run nginx', '!!!')).toBe('app');
  expect(nameOf(`docker run ${D}IMAGE`)).toBe('image');
  expect(nameOf('docker run nginx', '__proto__')).toBe('__proto__');
  const proto = convertDockerRun('docker run nginx', '__proto__');
  expect(Object.keys(proto.document['services'] as object)).toEqual(['__proto__']);
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  expect(proto.validation.valid).toBe(true);
  // A key that does not start with a letter is written in double quotes (the plain-key rule of the YAML writer).
  expect(proto.yaml).toContain('"__proto__":');
  // The container name is the typed name; only the service key is reduced.
  expect(
    at(convertDockerRun('docker run --name "My App.v2" nginx').document, 'services.my-app-v2.container_name'),
  ).toBe('My App.v2');
});

it('pasted values stay data in the YAML: structure never changes', () => {
  const nasty = [
    'a: b',
    '- c',
    '"q"',
    "it's",
    '# not a comment',
    'x' + LF + 'y: z',
    '{a: b}',
    '[1, 2]',
    '&anchor',
    '*alias',
    '!tag',
    '| block',
    '> fold',
    '%dir',
    '@at',
    '`tick',
    ': colon',
    '? key',
    '---',
    '...',
    'tab' + String.fromCharCode(9) + 'x',
    ' lead',
    'trail ',
  ];
  for (const value of nasty) {
    const text = `docker run -e ${shell(`K=${value}`)} -l ${shell(`l=${value}`)} --hostname ${shell(value)} --user ${shell(value)} nginx ${shell(value)}`;
    const result = convertDockerRun(text);
    const service = at(result.document, 'services.nginx') as Record<string, unknown>;
    // The service has exactly the keys the options give; no value became a key.
    expect(Object.keys(service), value).toEqual(['image', 'environment', 'labels', 'hostname', 'user', 'command']);
    expect(Object.keys(result.document), value).toEqual(['services']);
    const back = parse(result.yaml) as Record<string, unknown>;
    expect(back, value).toEqual(JSON.parse(JSON.stringify(result.document)));
    expect(at(back, 'services.nginx.environment'), value).toEqual([`K=${value}`]);
    expect(at(back, 'services.nginx.command'), value).toEqual([value]);
  }
  // Keys that come from pasted text (ulimit names, storage keys, volume and network names) are data too.
  const keys = convertDockerRun(
    'docker run --ulimit __proto__=1 --storage-opt constructor=x --log-opt toString=y -v constructor:/p --network __proto__ nginx',
  );
  expect(at(keys.document, 'services.nginx.ulimits')).toEqual(JSON.parse('{"__proto__": 1}'));
  expect(Object.keys(at(keys.document, 'services.nginx.ulimits') as object)).toEqual(['__proto__']);
  expect(Object.keys(keys.document['volumes'] as object)).toEqual(['constructor']);
  expect(Object.keys(keys.document['networks'] as object)).toEqual(['__proto__']);
  expect(Object.keys(at(keys.document, 'services.nginx.storage_opt') as object)).toEqual(['constructor']);
  expect(Object.keys(at(keys.document, 'services.nginx.logging.options') as object)).toEqual(['toString']);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  const reread = parse(keys.yaml) as Record<string, unknown>;
  expect(keys.yaml).toContain('__proto__');
  expect(Object.keys(at(reread, 'services.nginx.ulimits') as object)).toEqual(['__proto__']);
});

/** Wraps text in single quotes for the shell reader, doubling nothing: the nasty values hold no single quote except one that is escaped. */
function shell(text: string): string {
  return `'${text.split("'").join(`'${BS}''`)}'`;
}

it('a dollar value in a number, size or boolean option is written as text for Compose to fill in', () => {
  const result = convertDockerRun(
    `docker run -m ${D}MEM --cpus ${D}{CPUS:-1} --pids-limit ${D}LIMIT --read-only=${D}RO nginx`,
  );
  expect(at(result.document, 'services.nginx')).toMatchObject({
    mem_limit: `${D}MEM`,
    cpus: `${D}{CPUS:-1}`,
    pids_limit: `${D}LIMIT`,
    read_only: `${D}RO`,
  });
  expect(result.hints.some((h) => h.includes('fill in'))).toBe(true);
  expect(result.yaml).toContain(`mem_limit: "${D}MEM"`);
});

it('unknown options are listed with the closest name and a hint, and repeated options keep the last value', () => {
  const result = convertDockerRun('docker run --nam=web --nonexistent -z --name a --name b -p 80 -p 81 nginx');
  expect(result.unknown).toEqual([
    { name: '--nam', closest: '--name' },
    { name: '--nonexistent', closest: null },
    { name: '-z', closest: null },
  ]);
  expect(result.hints.some((h) => h.includes('unknown option'))).toBe(true);
  const service = at(result.document, 'services.b') as Record<string, unknown>;
  expect(service['container_name']).toBe('b');
  expect(service['ports']).toEqual(['80', '81']);
  const names = result.rows.filter((r) => r.option === '--name').map((r) => r.key);
  expect(names).toEqual(['container_name (replaced by a later --name)', 'container_name']);
  const long = convertDockerRun(`docker run --${'a'.repeat(100)} nginx`);
  expect(long.unknown[0]?.name.length).toBeLessThanOrEqual(41);
});

it('rows show every option read, with values cut at 40 characters and escaped', () => {
  const result = convertDockerRun(
    `docker run -w K=${'v'.repeat(100)} -u 'B=${String.fromCharCode(7)}' -p 80:80 --rm nginx`,
  );
  expect(result.rows.map((r) => [r.option, r.key])).toEqual([
    ['--workdir', 'working_dir'],
    ['--user', 'user'],
    ['--publish', 'ports'],
    ['--rm', 'no Compose equivalent'],
  ]);
  expect(result.rows[0]?.value).toBe(`K=${'v'.repeat(38)}${String.fromCodePoint(0x2026)}`);
  expect(result.rows[1]?.value).toBe(`B=${BS}u{7}`);
  expect(result.rows[3]?.value).toBe('true');
  const bundled = convertDockerRun('docker run -itd nginx');
  expect(bundled.rows.map((r) => r.option)).toEqual(['--interactive', '--tty', '--detach']);
});

it('messages never repeat a marker placed in a value or a name', () => {
  const marker = 'FODT-MARK-7731';
  const texts = [
    `docker run --network name=${marker},bogus=1 nginx`,
    `docker run --network host,${marker} nginx`,
    `docker run --network ${marker}= nginx`,
    `docker run --gpus ${marker} nginx`,
    `docker run --gpus 'all,${marker}=1' nginx`,
    `docker run --ulimit ${marker} nginx`,
    `docker run --log-opt '"${marker}' nginx`,
    `docker run --blkio-weight-device ${marker} nginx`,
    `docker run --device-read-bps ${marker} nginx`,
    `docker run --network name=a,alias=b --network host nginx ${marker}`.replace(marker, ''),
    `docker run --${marker} nginx`.replace('nginx', ''),
  ];
  for (const text of texts) {
    let message = '';
    try {
      const result = convertDockerRun(text);
      message = [
        ...result.hints,
        ...result.noEquivalent.map((e) => e.reason),
        ...result.needsAnotherService.map((e) => e.reason),
        ...result.validation.errors.map((e) => e.message),
      ].join(LF);
    } catch (error) {
      expect(error, text).toBeInstanceOf(DockerRunError);
      message = (error as DockerRunError).message;
    }
    expect(message, text).not.toContain(marker);
  }
});

it('a command at the size limit converts in under a second', () => {
  const words: string[] = [];
  let length = 'docker run '.length;
  let n = 0;
  while (length < 65_000) {
    const word = `-e K${n}=${'v'.repeat(30)}`;
    words.push(word);
    length += word.length + 1;
    n += 1;
  }
  const text = `docker run ${words.join(' ')} nginx`;
  expect(text.length).toBeLessThanOrEqual(65_536);
  const started = performance.now();
  const result = convertDockerRun(text);
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(1_000);
  expect((at(result.document, 'services.nginx.environment') as string[]).length).toBe(n);
  expect(result.validation.valid).toBe(true);
}, 60_000);

it('nothing is written to the console while converting', () => {
  for (const sample of SAMPLES) convertDockerRun(sample.command);
  for (const recorded of RECORDED) convertDockerRun(recorded.command);
  for (const text of ['docker run --mount nope nginx', 'docker run nginx | sh', 'docker run -e nginx']) {
    try {
      convertDockerRun(text);
    } catch {
      // A refusal is fine; only the console is checked.
    }
  }
  validateComposeDocument({ services: { a: { bogus: 1 } } });
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('the schema check lists where a document is wrong and never repeats a value', () => {
  const bad = validateComposeDocument({ services: { web: { image: 'nginx', ports: 'FODT-MARK-7731', bogus: 1 } } });
  expect(bad.valid).toBe(false);
  expect(bad.errors.length).toBeGreaterThan(0);
  expect(bad.errors.length).toBeLessThanOrEqual(20);
  expect(bad.errors.some((e) => e.path === '/services/web/ports')).toBe(true);
  expect(JSON.stringify(bad)).not.toContain('FODT-MARK-7731');
  expect(validateComposeDocument({ services: { web: { image: 'nginx' } } })).toEqual({ valid: true, errors: [] });
  // A service key the specification does not have is an error, and the checker says which.
  expect(bad.errors.some((e) => e.message.includes('bogus'))).toBe(true);
  expect(validateComposeDocument({ services: { web: { image: 'nginx', storage_opt: ['size=1G'] } } }).valid).toBe(
    false,
  );
  expect(validateComposeDocument({ services: { web: { image: 'nginx', links: 5 } } }).valid).toBe(false);

  // A document with many problems lists the first 20 only, each different from the others.
  const many: Record<string, number> = {};
  for (let i = 0; i < 30; i++) many['bogus' + i] = i;
  const flooded = validateComposeDocument({ services: { web: { image: 'nginx', ...many } } });
  expect(flooded.valid).toBe(false);
  expect(flooded.errors).toHaveLength(20);
  expect(new Set(flooded.errors.map((e) => e.path + e.message)).size).toBe(20);
});

it('comma-separated values are read the way docker reads them', () => {
  expect(readCsvRecord('a,b')).toEqual(['a', 'b']);
  expect(readCsvRecord('')).toEqual(['']);
  expect(readCsvRecord('a,')).toEqual(['a', '']);
  expect(readCsvRecord('"a,b",c')).toEqual(['a,b', 'c']);
  expect(readCsvRecord('a,"b""c"')).toEqual(['a', 'b"c']);
  expect(readCsvRecord('x="1"')).toBeNull();
  for (const malformed of ['a"b', '"a', '"a"b', ' "a"', 'a,"b']) {
    expect(readCsvRecord(malformed), malformed).toBeNull();
  }
});

it('a doubled dollar sign is text and a variable is left for Compose to fill in', () => {
  const D2 = D + D;
  for (const text of [D + 'HOME', D + '{HOME}', 'a' + D2 + ' ' + D + 'B', D2 + D + 'X', D + '_x']) {
    expect(hasInterpolation(text), text).toBe(true);
  }
  for (const text of ['', 'plain', D, D2, D2 + 'HOME', D2 + D2 + 'x', D + '1', D + ' x', 'a' + D2 + '{X}']) {
    expect(hasInterpolation(text), text).toBe(false);
  }
});

it('--umask is listed with a reason that says it is only in newer Docker releases', () => {
  const result = convertDockerRun('docker run --umask 022 nginx');
  expect(result.noEquivalent).toHaveLength(1);
  expect(result.noEquivalent[0]?.option).toBe('--umask');
  expect(result.noEquivalent[0]?.reason).toContain('only in newer Docker releases');
  expect(result.noEquivalent[0]?.reason).toContain('no key');
});

it('whole numbers beyond 2^53 stay text in the YAML instead of becoming a rounded float', () => {
  const big = '99999999999999999999';
  const memory = convertDockerRun(`docker run --memory ${big} nginx`);
  expect(at(memory.document, 'services.nginx.mem_limit')).toBe(big);
  expect(memory.yaml).toContain(`mem_limit: "${big}"`);
  expect(memory.yaml).not.toContain('e+');
  expect(memory.validation.valid).toBe(true);
  // The largest whole number JavaScript holds exactly is still a number; the next one is text.
  expect(at(convertDockerRun('docker run --memory 9007199254740991 nginx').document, 'services.nginx.mem_limit')).toBe(
    9007199254740991,
  );
  expect(at(convertDockerRun('docker run --memory 9007199254740992 nginx').document, 'services.nginx.mem_limit')).toBe(
    '9007199254740992',
  );
  expect(at(convertDockerRun('docker run --memory -9007199254740993 nginx').document, 'services.nginx.mem_limit')).toBe(
    '-9007199254740993',
  );
  // The same in every place a size or a limit is read as a whole number.
  const ulimit = convertDockerRun(`docker run --ulimit nofile=${big}:${big} --ulimit nproc=${big} nginx`);
  expect(at(ulimit.document, 'services.nginx.ulimits.nofile')).toEqual({ soft: big, hard: big });
  expect(at(ulimit.document, 'services.nginx.ulimits.nproc')).toBe(big);
  expect(ulimit.yaml).not.toContain('e+');
  const rate = convertDockerRun(`docker run --device-read-bps /dev/sda:${big} nginx`);
  expect(at(rate.document, 'services.nginx.blkio_config.device_read_bps')).toEqual([{ path: '/dev/sda', rate: big }]);
  const tmpfs = convertDockerRun(`docker run --mount type=tmpfs,target=/t,tmpfs-size=${big} nginx`);
  expect(at(tmpfs.document, 'services.nginx.volumes')).toEqual([{ type: 'tmpfs', target: '/t', tmpfs: { size: big } }]);
  const gpus = convertDockerRun(`docker run --gpus count=${big} nginx`);
  expect(at(gpus.document, 'services.nginx.gpus')).toEqual([{ capabilities: ['gpu'], count: big }]);
  expect(gpus.yaml).not.toContain('e+');
  // A gateway priority is a number in the schema, so one that cannot be held exactly is refused instead of rounded.
  expect(() => convertDockerRun(`docker run --network name=n,gw-priority=${big} nginx`)).toThrow(
    /must be a whole number that is not larger than 9,007,199,254,740,991/,
  );
  expect(
    at(
      convertDockerRun('docker run --network name=n,gw-priority=1000 nginx').document,
      'services.nginx.networks.n.gw_priority',
    ),
  ).toBe(1000);
});

it('a value that holds a variable is not judged by the schema check, and the result says how many were left alone', () => {
  // Compose accepts --name $N once N is set, so the schema must not call the unfilled text a refusal.
  const named = convertDockerRun(`docker run --name ${D}N nginx`);
  expect(named.validation.valid).toBe(true);
  expect(named.validation.errors).toEqual([]);
  expect(named.validation.notJudged).toBe(1);
  expect(convertDockerRun(`docker run --name ${D}N -m ${D}MEM -p ${D}PORT:80 nginx`).validation.notJudged).toBe(1);
  // Other problems at other places are still reported, and the unfilled value is not among them.
  const mixed = validateComposeDocument({
    services: { web: { image: 'nginx', container_name: `${D}N`, bogus: 1, pull_policy: `${D}{PP:-always}` } },
  });
  expect(mixed.valid).toBe(false);
  expect(mixed.errors.some((e) => e.message.includes('bogus'))).toBe(true);
  expect(mixed.errors.every((e) => !e.path.endsWith('container_name') && !e.path.endsWith('pull_policy'))).toBe(true);
  expect(mixed.notJudged).toBe(2);
  // The same text with a doubled dollar sign is plain text and is judged like any other.
  const plain = validateComposeDocument({ services: { web: { image: 'nginx', container_name: `${D}${D}N` } } });
  expect(plain.valid).toBe(false);
  expect(plain.notJudged).toBeUndefined();
  // A document with nothing to leave alone has no count.
  expect(validateComposeDocument({ services: { web: { image: 'nginx' } } })).toEqual({ valid: true, errors: [] });
});
