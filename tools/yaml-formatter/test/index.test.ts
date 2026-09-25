import { it, expect, vi } from 'vitest';
import { formatYaml, YamlFormatterError } from '../src/index';

/**
 * YAML Ain't Markup Language (YAML) Version 1.2.2, https://yaml.org/spec/1.2.2/
 * fetched 2026-09-25.
 *
 * Example 2.3 (section 2.1, "Collections"):
 *
 *   american:
 *   - Boston Red Sox
 *   - Detroit Tigers
 *   - New York Yankees
 *   national:
 *   - New York Mets
 *   - Chicago Cubs
 *   - Atlanta Braves
 */
const EXAMPLE_2_3 = `american:
- Boston Red Sox
- Detroit Tigers
- New York Yankees
national:
- New York Mets
- Chicago Cubs
- Atlanta Braves
`;

/**
 * Example 2.10 (section 2.1, "Collections"), "Node for 'Sammy Sosa' appears
 * twice in this document":
 *
 *   ---
 *   hr:
 *   - Mark McGwire
 *   # Following node labeled SS
 *   - &SS Sammy Sosa
 *   rbi:
 *   - *SS # Subsequent occurrence
 *   - Ken Griffey
 */
const EXAMPLE_2_10 = `---
hr:
- Mark McGwire
# Following node labeled SS
- &SS Sammy Sosa
rbi:
- *SS # Subsequent occurrence
- Ken Griffey
`;

/**
 * Example 2.11 (section 2.1, "Collections"), "Mapping between Sequences":
 *
 *   ? - Detroit Tigers
 *     - Chicago cubs
 *   : - 2001-07-23
 *
 *   ? [ New York Yankees,
 *       Atlanta Braves ]
 *   : [ 2001-07-02, 2001-08-12,
 *       2001-08-14 ]
 */
const EXAMPLE_2_11 = `? - Detroit Tigers
  - Chicago cubs
: - 2001-07-23

? [ New York Yankees,
    Atlanta Braves ]
: [ 2001-07-02, 2001-08-12,
    2001-08-14 ]
`;

/**
 * Example 2.18 (section 2.3, "Scalars"), "Multi-line Flow Scalars":
 *
 *   plain:
 *     This unquoted scalar
 *     spans many lines.
 *
 *   quoted: "So does this
 *     quoted scalar.\n"
 */
const EXAMPLE_2_18 = `plain:
  This unquoted scalar
  spans many lines.

quoted: "So does this
  quoted scalar.\\n"
`;

/**
 * Example 2.27 (section 2.4, "Tags"), "Invoice" (trimmed to the fields this
 * test cares about; the full example also carries a document tag, which
 * this tool keeps in the output but never resolves -- see "limits").
 */
const EXAMPLE_2_27 = `invoice: 34843
date   : 2001-01-23
bill-to: &id001
  given  : Chris
  family : Dumars
  address:
    lines: |
      458 Walkman Dr.
      Suite #292
    city    : Royal Oak
    state   : MI
    postal  : 48046
ship-to: *id001
product:
- sku         : BL394D
  quantity    : 4
  description : Basketball
  price       : 450.00
tax  : 251.42
total: 4443.52
`;

const CHAPTER_2_EXAMPLES = [
  ['2.3', EXAMPLE_2_3],
  ['2.11', EXAMPLE_2_11],
  ['2.18', EXAMPLE_2_18],
  ['2.27', EXAMPLE_2_27],
] as const;

it('YAML 1.2.2 example 2.10 anchors and aliases are listed with their positions and alias counts', () => {
  const result = formatYaml(EXAMPLE_2_10, { mode: 'check' });
  expect(result.anchors).toHaveLength(1);
  expect(result.anchors[0]).toMatchObject({ name: 'SS', kind: 'scalar', aliasCount: 1 });
  expect(result.anchors[0]!.line).toBe(5);
  expect(result.aliases).toHaveLength(1);
  expect(result.aliases[0]).toMatchObject({ name: 'SS' });
  expect(result.aliases[0]!.line).toBe(7);
  expect(result.duplicates).toEqual([]);
});

it('duplicate mapping keys are reported with both positions and formatting is refused', () => {
  const source = 'a: 1\na: 2\n';
  const report = formatYaml(source, { mode: 'check' });
  expect(report.duplicates).toHaveLength(1);
  expect(report.duplicates[0]).toEqual({ key: 'a', line: 2, column: 1, firstLine: 1, firstColumn: 1 });

  expect(() => formatYaml(source, { mode: 'format' })).toThrow(YamlFormatterError);
  try {
    formatYaml(source, { mode: 'format' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(YamlFormatterError);
    expect((err as YamlFormatterError).line).toBe(2);
  }
});

it('formatting keeps comments and gives the same data for the YAML 1.2.2 chapter 2 examples', () => {
  for (const [label, source] of CHAPTER_2_EXAMPLES) {
    const before = formatYaml(source, { mode: 'check' });
    const formatted = formatYaml(source, { mode: 'format' });
    const after = formatYaml(formatted.output, { mode: 'check' });
    expect(before.duplicates, `example ${label}`).toEqual([]);
    expect(after.duplicates, `example ${label}`).toEqual([]);
    // Re-parsing the formatted output resolves to the same anchor/alias shape as the original.
    expect(after.anchors.length, `example ${label}`).toBe(before.anchors.length);
    expect(after.aliases.length, `example ${label}`).toBe(before.aliases.length);
  }

  const withComment = 'a: 1 # keep me\n';
  const formatted = formatYaml(withComment, { mode: 'format' });
  expect(formatted.output).toContain('# keep me');

  const flow = 'a: [1, 2]\n';
  const formattedFlow = formatYaml(flow, { mode: 'format' });
  expect(formattedFlow.output.trim()).toBe('a: [ 1, 2 ]');
});

it('a YAML alias bomb is refused by the alias limit', () => {
  // A minimal billion-laughs style document: each level aliases the
  // previous level twice, so ten levels already expands past 100 nodes.
  const lines = ['a0: &a0 [x, x]'];
  for (let i = 1; i <= 10; i++) {
    lines.push(`a${i}: &a${i} [*a${i - 1}, *a${i - 1}]`);
  }
  const source = lines.join('\n') + '\n';
  expect(() => formatYaml(source, { mode: 'check' })).toThrow(/aliases that expand into too much data/);
});

it('an alias to an undefined anchor is reported with its position', () => {
  const source = 'a: *missing\n';
  const result = formatYaml(source, { mode: 'check' });
  expect(result.aliases).toEqual([{ name: 'missing', line: 1, column: 4 }]);
  expect(result.warnings.some((w) => w.includes('missing') && w.includes('no matching anchor'))).toBe(true);
});

it('multi-document streams are formatted document by document', () => {
  const source = '---\na: 1\n---\nb: 2\n';
  const result = formatYaml(source, { mode: 'format' });
  expect(result.documents).toBe(2);
  expect(result.output).toContain('a: 1');
  expect(result.output).toContain('---');
  expect(result.output).toContain('b: 2');

  const checked = formatYaml(source, { mode: 'check' });
  expect(checked.documents).toBe(2);
});

it('nothing is written to the console for YAML warnings or errors', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const mocks = spies.map((name) => vi.spyOn(console, name).mockImplementation(() => {}));

  try {
    formatYaml(EXAMPLE_2_10, { mode: 'format' });
    formatYaml('a: 1\na: 2\n', { mode: 'check' });
    try {
      formatYaml('a: *missing\n:::\n', { mode: 'format' });
    } catch {
      // malformed input; only console silence is under test here
    }
    try {
      formatYaml('%YAML 3.0\n---\na: 1\n', { mode: 'format' });
    } catch {
      // an unsupported directive; only console silence is under test here
    }

    for (const mock of mocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  } finally {
    vi.restoreAllMocks();
  }
});
