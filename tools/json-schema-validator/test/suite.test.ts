import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { validateJson } from '../src/index';

interface SuiteTestCase {
  description: string;
  data: unknown;
  valid: boolean;
}

interface SuiteGroup {
  description: string;
  schema: unknown;
  tests: SuiteTestCase[];
}

const FIXTURES_ROOT = join(__dirname, 'fixtures', 'json-schema-test-suite');

/**
 * Every case where this tool's own answer differs from the vendored
 * JSON-Schema-Test-Suite's documented expectation, named exactly
 * "file | group description | test description" (this plan's H rule: a
 * case the wrapped library answers differently is listed by its exact
 * description, and the test below asserts the failing set equals this list
 * exactly, so a change to either side is caught rather than silently
 * absorbed). Two causes, both named in meta.json's own limits:
 *
 *  - 14 of the draft 2020-12 cases are this tool's own deliberate choice:
 *    it always asserts `format` when format checking is on (the default),
 *    even under 2020-12's default annotation-only vocabulary. These are
 *    the suite's own "... is only an annotation by default" cases.
 *  - Everything else is a genuine Ajv 8.20.0 behaviour, confirmed this
 *    session by reproducing each case standalone against Ajv directly,
 *    outside this package:
 *      - properties.json/required.json ("... Javascript object property
 *        names ..."): Ajv's compiled validator reads an object's
 *        INHERITED `constructor`/`toString` (from Object.prototype) as
 *        present even when the parsed JSON document has no such own
 *        property -- exactly the class of JS-implementation bug this
 *        suite group's own comment ("Ensure JS implementations don't
 *        universally consider e.g. __proto__ to always be present in an
 *        object") exists to catch.
 *      - ref.json's two "... with defs" groups and the URN case: a real
 *        RangeError ("Maximum call stack size exceeded") thrown from deep
 *        inside Ajv's own URI-resolution dependency (fast-uri) when a
 *        sub-schema's relative $id combines with a sibling $ref in this
 *        specific self-referencing shape -- reproduced with a four-line
 *        standalone script calling only `ajv.compile()`, no test-suite
 *        machinery involved. That compile failure makes this tool refuse
 *        the schema outright, so only the suite's own "valid" cases for
 *        that schema differ (the suite's "invalid" cases already expect
 *        rejection, which a refused compile also produces).
 *      - dynamicRef.json, unevaluatedItems.json, unevaluatedProperties.json:
 *        $dynamicRef/dynamic-scope edge cases Ajv 8.20.0 does not resolve
 *        the way the suite documents.
 *
 * (enum.json's own "empty enum" group also fails to compile in this tool,
 * since Ajv separately rejects an empty enum array outright -- but every
 * one of that group's own tests expects rejection anyway, so a refused
 * compile matches the suite exactly there and none of its cases appear
 * in the list below.)
 */
const KNOWN_DIFFERENCES_DRAFT7: string[] = [
  // ownProperties: true makes Ajv count only the data object's own keys, so inherited
  // Object.prototype members such as constructor and toString no longer read as present.
  // The one remaining quirk: an own __proto__ key is still skipped by the property checks.
  'properties.json | properties whose names are Javascript object property names | __proto__ not valid',
  'ref.json | ref overrides any sibling keywords | ref valid, maxItems ignored',
];

const KNOWN_DIFFERENCES_2020_12: string[] = [
  // ownProperties: true makes Ajv count only the data object's own keys, so inherited
  // Object.prototype members such as constructor and toString no longer read as present.
  // The one remaining quirk: an own __proto__ key is still skipped by the property checks.
  'properties.json | properties whose names are Javascript object property names | __proto__ not valid',
  'dynamicRef.json | $dynamicRef avoids the root of each schema, but scopes are still registered | data is sufficient for schema at second#/$defs/length',
  'dynamicRef.json | $dynamicRef points to a boolean schema | follow $dynamicRef to a false schema',
  'dynamicRef.json | $dynamicRef skips over intermediate resources - direct reference | integer property passes',
  'dynamicRef.json | A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated | An array of strings is valid',
  'dynamicRef.json | A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope | The recursive part is valid against the root',
  "dynamicRef.json | A $dynamicRef that initially resolves to a schema without a matching $dynamicAnchor behaves like a normal $ref to $anchor | The recursive part doesn't need to validate against the root",
  'dynamicRef.json | A $dynamicRef to a $dynamicAnchor in the same schema resource behaves like a normal $ref to an $anchor | An array of strings is valid',
  'dynamicRef.json | A $dynamicRef to an $anchor in the same schema resource behaves like a normal $ref to an $anchor | An array of strings is valid',
  'dynamicRef.json | A $dynamicRef with a non-matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor | Any array is valid',
  "dynamicRef.json | A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution | An array of strings is valid",
  'dynamicRef.json | A $dynamicRef without a matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor | Any array is valid',
  'dynamicRef.json | A $dynamicRef without anchor in fragment behaves identical to $ref | An array of numbers is valid',
  'dynamicRef.json | An $anchor with the same name as a $dynamicAnchor is not used for dynamic scope resolution | Any array is valid',
  'dynamicRef.json | after leaving a dynamic scope, it is not used by a $dynamicRef | /then/$defs/thingy is the final stop for the $dynamicRef',
  'dynamicRef.json | multiple dynamic paths to the $dynamicRef keyword | number list with string values',
  'dynamicRef.json | multiple dynamic paths to the $dynamicRef keyword | string list with number values',
  'format.json | date format | invalid date string is only an annotation by default',
  'format.json | date-time format | invalid date-time string is only an annotation by default',
  'format.json | duration format | invalid duration string is only an annotation by default',
  'format.json | email format | invalid email string is only an annotation by default',
  'format.json | hostname format | invalid hostname string is only an annotation by default',
  'format.json | ipv4 format | invalid ipv4 string is only an annotation by default',
  'format.json | ipv6 format | invalid ipv6 string is only an annotation by default',
  'format.json | json-pointer format | invalid json-pointer string is only an annotation by default',
  'format.json | regex format | invalid regex string is only an annotation by default',
  'format.json | relative-json-pointer format | invalid relative-json-pointer string is only an annotation by default',
  'format.json | time format | invalid time string is only an annotation by default',
  'format.json | uri format | invalid uri string is only an annotation by default',
  'format.json | uri-reference format | invalid uri-reference string is only an annotation by default',
  'format.json | uri-template format | invalid uri-template string is only an annotation by default',
  'format.json | uuid format | invalid uuid string is only an annotation by default',
  'ref.json | URN ref with nested pointer ref | a string is valid',
  'ref.json | refs with relative uris and defs | valid on both fields',
  'ref.json | relative refs with absolute uris and defs | valid on both fields',
  "unevaluatedItems.json | unevaluatedItems and contains interact to control item dependency relationship | only a's and c's are invalid",
  "unevaluatedItems.json | unevaluatedItems and contains interact to control item dependency relationship | only b's and c's are invalid",
  "unevaluatedItems.json | unevaluatedItems and contains interact to control item dependency relationship | only b's are invalid",
  "unevaluatedItems.json | unevaluatedItems and contains interact to control item dependency relationship | only c's are invalid",
  'unevaluatedItems.json | unevaluatedItems can see annotations from if without then and else | valid in case if is evaluated',
  'unevaluatedItems.json | unevaluatedItems depends on adjacent contains | contains passes, second item is not evaluated',
  'unevaluatedItems.json | unevaluatedItems depends on multiple nested contains | 7 not evaluated, fails unevaluatedItems',
  'unevaluatedItems.json | unevaluatedItems with $dynamicRef | with no unevaluated items',
  'unevaluatedItems.json | unevaluatedItems with minContains = 0 | all items evaluated by contains',
  'unevaluatedItems.json | unevaluatedItems with nested items | with invalid additional item',
  'unevaluatedItems.json | unevaluatedItems with nested items | with no additional items',
  'unevaluatedProperties.json | unevaluatedProperties can see annotations from if without then and else | valid in case if is evaluated',
  'unevaluatedProperties.json | unevaluatedProperties with $dynamicRef | with no unevaluated properties',
  'unevaluatedProperties.json | unevaluatedProperties with if/then/else, then not defined | when if is false and has unevaluated properties',
  'unevaluatedProperties.json | unevaluatedProperties with if/then/else, then not defined | when if is true and has no unevaluated properties',
];

interface SuiteRunResult {
  total: number;
  skippedGroups: number;
  failing: string[];
}

/**
 * Walks every vendored `.json` file in `dirName`, compiling and validating
 * each group's schema against each of its own tests through this
 * package's own public `validateJson`, so this proves what a real caller
 * gets -- not an internal Ajv shortcut. A group whose schema text contains
 * `http://localhost:1234` needs the suite's own remote HTTP server, which
 * this tool never contacts, and is skipped and counted rather than run.
 */
function runSuite(dirName: string, draft: 'draft-07' | '2020-12'): SuiteRunResult {
  const dir = join(FIXTURES_ROOT, dirName);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let total = 0;
  let skippedGroups = 0;
  const failing: string[] = [];

  for (const file of files) {
    const groups = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SuiteGroup[];
    for (const group of groups) {
      if (JSON.stringify(group.schema).includes('http://localhost:1234')) {
        skippedGroups++;
        continue;
      }
      const schemaText = JSON.stringify(group.schema);
      for (const testCase of group.tests) {
        total++;
        const key = `${file} | ${group.description} | ${testCase.description}`;
        let valid: boolean;
        try {
          const result = validateJson(schemaText, JSON.stringify(testCase.data), { draft, checkFormats: true });
          valid = result.valid;
        } catch {
          // A compile failure (e.g. the empty-enum case above) counts as
          // "not valid" for this comparison -- it is still a difference
          // from the suite's expectation when the suite expects `true`,
          // and KNOWN_DIFFERENCES names every such case explicitly.
          valid = false;
        }
        if (valid !== testCase.valid) failing.push(key);
      }
    }
  }
  return { total, skippedGroups, failing };
}

// Each run builds a fresh Ajv instance per test case (proving what a real
// caller of validateJson gets, not an internal shortcut), across 900-1244
// cases per draft -- comfortably real work, well past vitest's 5s default.
const SUITE_TIMEOUT_MS = 60_000;

it(
  'JSON-Schema-Test-Suite draft-07 vendored cases give the expected validity',
  () => {
    const { total, skippedGroups, failing } = runSuite('draft7', 'draft-07');
    expect(total).toBeGreaterThan(800);
    expect(skippedGroups).toBe(3);
    expect([...failing].sort()).toEqual([...KNOWN_DIFFERENCES_DRAFT7].sort());
  },
  SUITE_TIMEOUT_MS,
);

it(
  'JSON-Schema-Test-Suite draft 2020-12 vendored cases give the expected validity',
  () => {
    const { total, skippedGroups, failing } = runSuite('draft2020-12', '2020-12');
    expect(total).toBeGreaterThan(1100);
    expect(skippedGroups).toBe(11);
    expect([...failing].sort()).toEqual([...KNOWN_DIFFERENCES_2020_12].sort());
  },
  SUITE_TIMEOUT_MS,
);
