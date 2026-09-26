/**
 * Package name rules transcribed from npm's own published name-validation
 * package's source (the `npm` GitHub organisation, its `lib/index.js`,
 * fetched this session) -- the exact rules, and the exact wording of every
 * error and warning message, so this tool's own answer always matches what
 * that package (a devDependency-only test oracle, never bundled -- D-82)
 * decides. Its name is deliberately not spelled out in this file (see
 * `test/npm-oracles.test.ts` for the import): the release gate refuses to
 * ship a package name literal inside this folder's own runtime source.
 *
 * Node.js's own core module list (from `node:module`'s `builtinModules`,
 * this project's own pinned Node.js runtime, fetched live this session) is
 * transcribed below rather than imported, since a bundled package must
 * carry no runtime dependency.
 */

// node:module builtinModules, this session's Node.js runtime -- the same
// list the oracle's own source reads to warn about a core
// module name.
const NODE_BUILTIN_MODULES: readonly string[] = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

// The excluded literal names the oracle's own source lists.
const EXCLUDED_NAMES: readonly string[] = ['node_modules', 'favicon.ico'];

const SCOPED_PACKAGE_PATTERN = /^(?:@([^/]+?)\/)?([^/]+?)$/;

export interface PackageNameCheck {
  validForNewPackages: boolean;
  validForOldPackages: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Checks a package name exactly as npm's own name-validation package
 * decides, including its literal error and warning wording, so the answer
 * this tool gives is never a paraphrase of the real oracle's own answer.
 */
export function checkPackageName(name: string): PackageNameCheck {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (typeof name !== 'string') {
    errors.push('name must be a string');
    return { validForNewPackages: false, validForOldPackages: false, warnings, errors };
  }

  if (name.length === 0) {
    errors.push('name length must be greater than zero');
  }
  if (name.startsWith('.')) {
    errors.push('name cannot start with a period');
  }
  if (name.startsWith('-')) {
    errors.push('name cannot start with a hyphen');
  }
  if (/^_/.test(name)) {
    errors.push('name cannot start with an underscore');
  }
  if (name.trim() !== name) {
    errors.push('name cannot contain leading or trailing spaces');
  }

  for (const excluded of EXCLUDED_NAMES) {
    if (name.toLowerCase() === excluded) {
      errors.push(`${excluded} is not a valid package name`);
    }
  }

  if (NODE_BUILTIN_MODULES.includes(name.toLowerCase())) {
    warnings.push(`${name} is a core module name`);
  }
  if (name.length > 214) {
    warnings.push('name can no longer contain more than 214 characters');
  }
  if (name.toLowerCase() !== name) {
    warnings.push('name can no longer contain capital letters');
  }
  if (/[~'!()*]/.test(name.split('/').slice(-1)[0] ?? '')) {
    warnings.push('name can no longer contain special characters ("~\'!()*")');
  }

  if (encodeURIComponent(name) !== name) {
    const match = SCOPED_PACKAGE_PATTERN.exec(name);
    let handledByScope = false;
    if (match) {
      const user = match[1];
      const pkg = match[2] ?? '';
      if (pkg.startsWith('.')) {
        errors.push('name cannot start with a period');
      }
      if (user !== undefined && encodeURIComponent(user) === user && encodeURIComponent(pkg) === pkg) {
        handledByScope = true;
      }
    }
    if (!handledByScope) {
      errors.push('name can only contain URL-friendly characters');
    }
  }

  return {
    validForNewPackages: errors.length === 0 && warnings.length === 0,
    validForOldPackages: errors.length === 0,
    warnings,
    errors,
  };
}
