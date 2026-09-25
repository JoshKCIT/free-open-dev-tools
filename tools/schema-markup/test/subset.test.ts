/**
 * Independently re-derives the bundled schema.org subset from the vendored
 * release file, using the same extraction rule the bundle's own generation
 * follows (documented in schema-org-subset.ts's header comment): the twelve
 * content types plus every type NESTED_DEFAULTS reaches, plus every
 * ancestor of those reached by walking rdfs:subClassOf within schema.org's
 * own namespace, core vocabulary only (no schema:isPartOf).
 *
 * `it` is a required top-level title here, matched by exact fullName in
 * this plan's own verify script -- not nested inside a `describe()`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { SCHEMA_ORG_VERSION, TYPES, PROPERTIES } from '../src/schema-org-subset';
import { CONTENT_TYPES, NESTED_DEFAULTS } from '../src/index';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'schemaorg-release', 'schemaorg-current-https.jsonld');

interface GraphNode {
  '@id': string;
  '@type': string | string[];
  'rdfs:subClassOf'?: { '@id': string } | { '@id': string }[];
  'schema:domainIncludes'?: { '@id': string } | { '@id': string }[];
  'schema:rangeIncludes'?: { '@id': string } | { '@id': string }[];
  'schema:isPartOf'?: unknown;
}

const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { '@graph': GraphNode[] };
const g = raw['@graph'];

function shortId(id: string): string {
  return id.replace(/^schema:/, '');
}
function idsOf(v: { '@id': string } | { '@id': string }[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => x['@id']);
}
const isCore = (n: GraphNode) => !n['schema:isPartOf'];

const typeNodes = new Map<string, GraphNode>();
const propNodes = new Map<string, GraphNode>();
for (const n of g) {
  if (!isCore(n)) continue;
  const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
  if (types.includes('rdfs:Class')) typeNodes.set(shortId(n['@id']), n);
  if (types.includes('rdf:Property')) propNodes.set(shortId(n['@id']), n);
}

function parentsOf(shortName: string): string[] {
  const n = typeNodes.get(shortName);
  if (!n) return [];
  return idsOf(n['rdfs:subClassOf'])
    .filter((id) => id.startsWith('schema:'))
    .map(shortId)
    .filter((p) => typeNodes.has(p));
}

function ancestorChain(shortName: string): string[] {
  const seen = new Set<string>();
  const queue = [...parentsOf(shortName)];
  const order: string[] = [];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    order.push(p);
    for (const gp of parentsOf(p)) queue.push(gp);
  }
  return order;
}

const NESTED_EXTRA = [
  'Offer',
  'PostalAddress',
  'Place',
  'Question',
  'Answer',
  'ListItem',
  'HowToStep',
  'SearchAction',
  'EntryPoint',
  'ImageObject',
  'AggregateRating',
  'Brand',
];

const seeds = [...CONTENT_TYPES, ...NESTED_EXTRA];
const finalTypeSet = new Set(seeds);
for (const s of seeds) for (const a of ancestorChain(s)) finalTypeSet.add(a);

const selfAndAncestors = new Map<string, Set<string>>();
for (const t of finalTypeSet) selfAndAncestors.set(t, new Set([t, ...ancestorChain(t)]));

const typeProperties = new Map<string, Set<string>>();
for (const t of finalTypeSet) typeProperties.set(t, new Set());

for (const propName of propNodes.keys()) {
  const node = propNodes.get(propName)!;
  const domains = idsOf(node['schema:domainIncludes'])
    .filter((id) => id.startsWith('schema:'))
    .map(shortId);
  if (domains.length === 0) continue;
  for (const t of finalTypeSet) {
    const chain = selfAndAncestors.get(t)!;
    if (domains.some((dom) => chain.has(dom))) typeProperties.get(t)!.add(propName);
  }
}

const finalPropertySet = new Set<string>();
for (const t of finalTypeSet) for (const p of typeProperties.get(t)!) finalPropertySet.add(p);

it('the bundled schema.org subset equals what the vendored schema.org release file gives for the same types', () => {
  expect(SCHEMA_ORG_VERSION).toBe('30.1');

  expect(new Set(TYPES.keys())).toEqual(finalTypeSet);
  expect(TYPES.size).toBe(finalTypeSet.size);

  for (const t of finalTypeSet) {
    const bundled = TYPES.get(t);
    expect(bundled, `type "${t}" missing from bundle`).toBeDefined();
    expect(new Set(bundled!.parents), `parents of ${t}`).toEqual(new Set(ancestorChain(t)));
    expect(new Set(bundled!.properties), `properties of ${t}`).toEqual(typeProperties.get(t));
  }

  expect(new Set(PROPERTIES.keys())).toEqual(finalPropertySet);
  for (const p of finalPropertySet) {
    const bundled = PROPERTIES.get(p);
    expect(bundled, `property "${p}" missing from bundle`).toBeDefined();
    const node = propNodes.get(p)!;
    const ranges = idsOf(node['schema:rangeIncludes'])
      .filter((id) => id.startsWith('schema:'))
      .map(shortId)
      .sort();
    expect([...bundled!.ranges].sort(), `ranges of ${p}`).toEqual(ranges);
  }
});

it('every NESTED_DEFAULTS entry is exactly, or a subtype of, a range type schema.org declares for that property', () => {
  for (const [propName, defaultType] of Object.entries(NESTED_DEFAULTS)) {
    const propNode = propNodes.get(propName);
    expect(propNode, `property "${propName}" not found in vendored file`).toBeDefined();
    const ranges = idsOf(propNode!['schema:rangeIncludes'])
      .filter((id) => id.startsWith('schema:'))
      .map(shortId);
    const defaultAncestors = new Set([defaultType, ...ancestorChain(defaultType)]);
    const inRange = ranges.some((r) => defaultAncestors.has(r));
    expect(
      inRange,
      `default "${defaultType}" for "${propName}" is not in ranges ${JSON.stringify(ranges)} nor a subtype of one`,
    ).toBe(true);
  }
});
