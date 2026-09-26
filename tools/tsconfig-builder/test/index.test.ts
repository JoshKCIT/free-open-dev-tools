import { describe, it, expect } from 'vitest';
import { buildTsconfig, TsconfigBuilderError, OPTIONS, findOption } from '../src/index';
import { PRESETS, findPreset } from '../src/presets';

describe('presets', () => {
  it('the node-library preset gives module and moduleResolution nodenext and parses with zero errors', () => {
    const { object, conflicts, warnings } = buildTsconfig({ preset: 'node-library' });
    expect(object.compilerOptions.module).toBe('nodenext');
    expect(object.compilerOptions.moduleResolution).toBe('nodenext');
    expect(conflicts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('every preset cites a source line and applies only catalogued option names', () => {
    for (const preset of PRESETS) {
      expect(preset.source.length).toBeGreaterThan(20);
      for (const name of Object.keys(preset.options)) {
        expect(findOption(name), `${preset.id}: ${name}`).toBeDefined();
      }
    }
  });

  it('four presets exist: node-library, node-app, bundler-app, strict-checks', () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual(
      ['bundler-app', 'node-app', 'node-library', 'strict-checks'].sort(),
    );
  });
});

describe('conflicts', () => {
  it('module nodenext with moduleResolution bundler gives a conflict warning the compiler also reports', () => {
    const { conflicts } = buildTsconfig({ options: { module: 'nodenext', moduleResolution: 'bundler' } });
    expect(conflicts.some((c) => c.code === 5095)).toBe(true);
    expect(conflicts.some((c) => c.code === 5109)).toBe(true);
  });

  it('emitDeclarationOnly without declaration gives a conflict warning the compiler also reports', () => {
    const { conflicts } = buildTsconfig({ options: { emitDeclarationOnly: true } });
    expect(conflicts.some((c) => c.code === 5069)).toBe(true);
  });

  it('emitDeclarationOnly with declaration or composite set gives no conflict', () => {
    expect(buildTsconfig({ options: { emitDeclarationOnly: true, declaration: true } }).conflicts).toEqual([]);
    expect(buildTsconfig({ options: { emitDeclarationOnly: true, composite: true } }).conflicts).toEqual([]);
  });
});

describe('unknown options and values', () => {
  it('an option this tool does not recognise is left out and reported as a warning, never written', () => {
    const { object, warnings } = buildTsconfig({ options: { totallyMadeUpOption: true } });
    expect(object.compilerOptions.totallyMadeUpOption).toBeUndefined();
    expect(warnings.some((w) => w.includes('totallyMadeUpOption'))).toBe(true);
  });

  it("a value outside an enum option's accepted list is left out and reported", () => {
    const { object, warnings } = buildTsconfig({ options: { module: 'not-a-real-module' } });
    expect(object.compilerOptions.module).toBeUndefined();
    expect(warnings.some((w) => w.includes('module'))).toBe(true);
  });

  it('a non-boolean string for a boolean option is left out and reported', () => {
    const { object, warnings } = buildTsconfig({ options: { strict: 'yes' } });
    expect(object.compilerOptions.strict).toBeUndefined();
    expect(warnings.some((w) => w.includes('strict'))).toBe(true);
  });

  it('an unrecognised preset id throws TsconfigBuilderError', () => {
    expect(() => buildTsconfig({ preset: 'not-a-real-preset' })).toThrow(TsconfigBuilderError);
  });

  it('findPreset returns undefined for an unknown id', () => {
    expect(findPreset('nope')).toBeUndefined();
  });
});

describe('output shape', () => {
  it('include, exclude and extends are only written when given, and only non-empty entries are kept', () => {
    const withAll = buildTsconfig({
      options: { strict: true },
      include: ['src', '  ', ''],
      exclude: ['dist'],
      extendsPath: './tsconfig.base.json',
    });
    expect(withAll.object.include).toEqual(['src']);
    expect(withAll.object.exclude).toEqual(['dist']);
    expect(withAll.object.extends).toBe('./tsconfig.base.json');

    const withNone = buildTsconfig({ options: { strict: true } });
    expect(withNone.object.include).toBeUndefined();
    expect(withNone.object.exclude).toBeUndefined();
    expect(withNone.object.extends).toBeUndefined();
  });

  it('output is valid JSON that reparses to the same compilerOptions', () => {
    const { output, object } = buildTsconfig({ preset: 'strict-checks', include: ['src'] });
    const reparsed = JSON.parse(output);
    expect(reparsed.compilerOptions).toEqual(object.compilerOptions);
    expect(reparsed.include).toEqual(object.include);
  });

  it('a list-typed option accepts a comma-separated string as well as an array', () => {
    const fromString = buildTsconfig({ options: { lib: 'es2022,dom' } });
    const fromArray = buildTsconfig({ options: { lib: ['es2022', 'dom'] } });
    expect(fromString.object.compilerOptions.lib).toEqual(['es2022', 'dom']);
    expect(fromArray.object.compilerOptions.lib).toEqual(['es2022', 'dom']);
  });
});

describe('catalogue shape', () => {
  it('has at least 50 options', () => {
    expect(OPTIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('covers the whole Type Checking category', () => {
    const typeChecking = OPTIONS.filter((o) => o.category === 'Type Checking');
    expect(typeChecking.length).toBe(20);
  });

  it('every option name is unique', () => {
    const names = OPTIONS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
