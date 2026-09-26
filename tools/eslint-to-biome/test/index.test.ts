import { expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateEslintConfig, BIOME_RULE_MAP, BIOME_UNSUPPORTED_RULES } from '../src/index';
import { buildRuleMap } from './build-rule-map';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const FIXTURES_BIOME_DIR = join(__dirname, 'fixtures', 'biome');
const FIXTURES_CONFIGS_DIR = join(__dirname, 'fixtures', 'configs');
const CONFIGURATION_SCHEMA = JSON.parse(readFileSync(join(FIXTURES_BIOME_DIR, 'configuration_schema.json'), 'utf8'));

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_CONFIGS_DIR, name), 'utf8');
}

it('the bundled rule map is exactly what the generator builds from the vendored Biome migrate sources', () => {
  const fresh = buildRuleMap(FIXTURES_BIOME_DIR);
  expect(fresh.map).toEqual(BIOME_RULE_MAP);
  expect(fresh.unsupported).toEqual(BIOME_UNSUPPORTED_RULES);
});

it('every rule in a fixture ESLint config is either mapped or listed as unmapped with a reason, never dropped', () => {
  const text = readFixture('legacy-with-comments.eslintrc.json');
  const result = translateEslintConfig(text, { format: 'json' });
  const requestedRules = (JSON.parse(text.replace(/\/\/[^\n]*/g, '')) as { rules: Record<string, unknown> }).rules;
  const requestedNames = Object.keys(requestedRules);
  const accountedFor = new Set([...result.mapped.map((m) => m.eslint), ...result.unmapped.map((u) => u.eslint)]);
  for (const name of requestedNames) {
    expect(accountedFor.has(name), `${name} was neither mapped nor listed as unmapped`).toBe(true);
  }
});

it('rules from plugins outside the bundled set are listed as unmapped naming the plugin', () => {
  const result = translateEslintConfig('{"rules":{"vue/no-unused-vars":"warn"}}', { format: 'json' });
  expect(result.mapped).toEqual([]);
  expect(result.unmapped).toHaveLength(1);
  expect(result.unmapped[0]!.eslint).toBe('vue/no-unused-vars');
  expect(result.unmapped[0]!.reason).toContain('vue');
});

it('rule options, extends, plugins, overrides and other settings that are not carried over are listed', () => {
  const text = readFixture('legacy-with-comments.eslintrc.json');
  const result = translateEslintConfig(text, { format: 'json' });
  const joined = result.notCarried.join(' | ');
  expect(joined).toContain('"extends"');
  expect(joined).toContain('"plugins"');
  expect(joined).toContain('"parserOptions"');
  expect(joined).toContain('"overrides"');
  expect(joined).toContain('"env"');
  expect(joined).toContain('"settings"');
  expect(joined).toContain('"ignorePatterns"');
  expect(joined).toContain('"root"');
  expect(joined).toContain('eqeqeq');
});

it('nursery and inspired rules are left out unless asked for, as the Biome migrate command does', () => {
  const withoutNursery = translateEslintConfig('{"rules":{"import/first":"error"}}', { format: 'json' });
  expect(withoutNursery.mapped).toEqual([]);
  expect(withoutNursery.unmapped).toHaveLength(1);
  expect(withoutNursery.unmapped[0]!.eslint).toBe('import/first');

  const withNursery = translateEslintConfig('{"rules":{"import/first":"error"}}', {
    format: 'json',
    includeNursery: true,
  });
  expect(withNursery.unmapped).toEqual([]);
  expect(withNursery.mapped).toHaveLength(1);
  expect(withNursery.mapped[0]!.biome).toBe('nursery.useImportsFirst');
});

it('the generated biome.json validates against the pinned Biome configuration schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false, ownProperties: true });
  const validate = ajv.compile(CONFIGURATION_SCHEMA);
  const text = readFixture('legacy-with-comments.eslintrc.json');
  const result = translateEslintConfig(text, { format: 'json' });
  const valid = validate(result.biome);
  expect(valid, JSON.stringify(validate.errors)).toBe(true);
});

it('every Biome rule name in the map exists in the pinned Biome configuration schema', () => {
  const defs = CONFIGURATION_SCHEMA.$defs ?? CONFIGURATION_SCHEMA.definitions;
  for (const entry of BIOME_RULE_MAP) {
    for (const target of entry.targets) {
      const groupDefName = target.group.charAt(0).toUpperCase() + target.group.slice(1);
      const groupDef = defs[groupDefName];
      expect(groupDef, `no schema group "${groupDefName}" for ${entry.eslint}`).toBeDefined();
      expect(
        Object.hasOwn(groupDef.properties ?? {}, target.rule),
        `${groupDefName}.${target.rule} (from ${entry.eslint}) is not in the pinned schema`,
      ).toBe(true);
    }
  }
});

it('JSON with comments and YAML eslintrc files are read as data', () => {
  const jsonResult = translateEslintConfig(readFixture('legacy-with-comments.eslintrc.json'), { format: 'json' });
  expect(jsonResult.formatUsed).toBe('json');
  expect(jsonResult.mapped.length).toBeGreaterThan(0);

  const yamlResult = translateEslintConfig(readFixture('legacy.eslintrc.yaml'), { format: 'yaml' });
  expect(yamlResult.formatUsed).toBe('yaml');
  expect(yamlResult.mapped.some((m) => m.eslint === 'no-debugger')).toBe(true);

  const autoJson = translateEslintConfig(readFixture('legacy-with-comments.eslintrc.json'));
  expect(autoJson.formatUsed).toBe('json');
  const autoYaml = translateEslintConfig(readFixture('legacy.eslintrc.yaml'));
  expect(autoYaml.formatUsed).toBe('yaml');
});

it('a package.json eslintConfig key is read as the configuration', () => {
  const result = translateEslintConfig(readFixture('package-with-eslintconfig.json'), { format: 'json' });
  expect(result.mapped.some((m) => m.eslint === 'no-debugger')).toBe(true);
});

it('no-debugger maps to Biome suspicious.noDebugger at error, as the vendored migrate table maps it', () => {
  const result = translateEslintConfig('{"rules":{"no-debugger":"error"}}', { format: 'json' });
  expect(result.mapped).toEqual([{ eslint: 'no-debugger', biome: 'suspicious.noDebugger', level: 'error' }]);
});

it('indent is listed as unmapped with the reason Biome’s unsupported list gives (formatter)', () => {
  const result = translateEslintConfig('{"rules":{"indent":["error",2]}}', { format: 'json' });
  expect(result.mapped).toEqual([]);
  expect(result.unmapped).toHaveLength(1);
  expect(result.unmapped[0]!.reason.toLowerCase()).toContain('formatter');
});

it('eqeqeq maps and lists its options as not carried over', () => {
  const result = translateEslintConfig('{"rules":{"eqeqeq":["error","always",{"null":"ignore"}]}}', { format: 'json' });
  expect(result.mapped).toEqual([{ eslint: 'eqeqeq', biome: 'suspicious.noDoubleEquals', level: 'error' }]);
  expect(result.notCarried.some((n) => n.includes('eqeqeq'))).toBe(true);
});

it('the higher severity wins when several ESLint rules map to the same Biome rule', () => {
  const result = translateEslintConfig('{"rules":{"no-debugger":"warn","no-console":"off"},"overrides":[]}', {
    format: 'json',
  });
  expect(result.mapped.find((m) => m.eslint === 'no-debugger')?.level).toBe('warn');
});

it('a __proto__ global name is collected safely without corrupting the accumulator', () => {
  const result = translateEslintConfig('{"globals":{"__proto__":"readonly","myGlobal":"readonly"}}', {
    format: 'json',
  });
  const globals = (result.biome.javascript as { globals: string[] } | undefined)?.globals ?? [];
  expect(globals.sort()).toEqual(['__proto__', 'myGlobal']);
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamMd = readFileSync(join(FIXTURES_BIOME_DIR, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamMd);
  expect(entries.length).toBeGreaterThanOrEqual(6);
  for (const entry of entries) {
    const actual = gitBlobShaOfFile(join(FIXTURES_BIOME_DIR, entry.path));
    expect(actual, `${entry.path} does not match UPSTREAM.md`).toBe(entry.sha);
  }
});

it('nothing is written to the console while translating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    translateEslintConfig(readFixture('legacy-with-comments.eslintrc.json'), { format: 'json' });
    translateEslintConfig(readFixture('legacy.eslintrc.yaml'), { format: 'yaml' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
