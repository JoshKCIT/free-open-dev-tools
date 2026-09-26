import meta from './meta.json';
import { parseEnv, entriesToObject, type EnvEntry, type EnvProblem, type ParseEnvResult } from './parse-env';
import {
  writeTarget,
  readTarget,
  writeEnv,
  type EnvTarget,
  type WriteOptions,
  type UnrepresentableValue,
} from './targets';

export { meta, parseEnv, entriesToObject, writeEnv };
export type { EnvEntry, EnvProblem, ParseEnvResult, EnvTarget, WriteOptions, UnrepresentableValue };

export class DotenvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DotenvError';
  }
}

const MAX_INPUT_BYTES = 1024 * 1024;

function assertWithinLimit(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
    throw new DotenvError('This file is larger than 1 MB, so it was refused rather than risk freezing the tab.');
  }
}

export interface ConvertOptions extends WriteOptions {
  to: EnvTarget;
}

export interface ConvertResult {
  output: string;
  warnings: string[];
  unrepresentable: UnrepresentableValue[];
}

/**
 * Parses `text` as `.env` and converts it to one of the five targets.
 * Warnings name values that contain `$` (other readers of a .env-shaped
 * file, or a shell, may expand it differently), and any key left out of the
 * target because it does not fit that target's own naming rule.
 */
export function convertEnv(text: string, options: ConvertOptions): ConvertResult {
  assertWithinLimit(text);
  const { entries } = parseEnv(text);
  const { output, warnings, unrepresentable } = writeTarget(entries, options.to, options);
  const dollarWarnings = entries
    .filter((e) => e.value.includes('$'))
    .map(
      (e) =>
        `"${e.key}" contains a dollar sign; other readers of a .env-shaped file (Docker Compose's env_file support, python-dotenv, a shell) may expand it differently.`,
    );
  const leftOutWarnings = unrepresentable.map((u) => `"${u.key}" was left out: ${u.reason}`);
  return { output, warnings: [...warnings, ...dollarWarnings, ...leftOutWarnings], unrepresentable };
}

export { readTarget };
