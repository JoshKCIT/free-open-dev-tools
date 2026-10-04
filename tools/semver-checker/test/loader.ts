import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFromHere = createRequire(import.meta.url);

/** The folder holding node-semver's published test fixtures, copied unchanged from its v7.8.5 tag. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'node-semver');

export interface Options {
  loose: boolean;
  includePrerelease: boolean;
}

/**
 * node-semver's own constants module. Two published fixtures (range-parse.js and invalid-versions.js) start with a
 * require of '../../internal/constants', which is a path inside node-semver's own repository; here it is answered with
 * the same module from the installed package, so the fixture files themselves stay exactly as published.
 */
const constants = requireFromHere('semver/internal/constants') as { MAX_LENGTH: number; MAX_SAFE_INTEGER: number };

/**
 * Loads one published fixture file (a CommonJS module that assigns an array to module.exports) without changing a
 * byte of it. The array holds the fixture entries exactly as node-semver's own tests read them.
 */
export function loadFixture(name: string): unknown[][] {
  const moduleObject: { exports: unknown } = { exports: {} };
  const fixtureRequire = (id: string): unknown => {
    if (id === '../../internal/constants') return constants;
    throw new Error('the fixture ' + name + ' requires something this loader does not supply');
  };
  const run = new Function('module', 'exports', 'require', readFileSync(join(FIXTURE_DIR, name + '.js'), 'utf8')) as (
    m: { exports: unknown },
    e: unknown,
    r: (id: string) => unknown,
  ) => void;
  run(moduleObject, moduleObject.exports, fixtureRequire);
  return moduleObject.exports as unknown[][];
}

/**
 * Reads the options value of a fixture entry the way node-semver does: a bare true means loose, an object is read for
 * its loose and includePrerelease properties by truth (so 420 is on and NaN, null and 0 are off), anything else is no
 * options at all.
 */
export function toOptions(raw: unknown): Options {
  if (raw === true) return { loose: true, includePrerelease: false };
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { loose?: unknown; includePrerelease?: unknown };
    return { loose: Boolean(record.loose), includePrerelease: Boolean(record.includePrerelease) };
  }
  return { loose: false, includePrerelease: false };
}

export const NO_OPTIONS: Options = { loose: false, includePrerelease: false };
