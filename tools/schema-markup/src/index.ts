import meta from './meta.json';
import { parsePropertyLines, type PropertyAssignment } from './lines';
import { SCHEMA_ORG_VERSION, TYPES, PROPERTIES, isSubtypeOf } from './schema-org-subset';

export { meta, SCHEMA_ORG_VERSION };

export class SchemaMarkupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMarkupError';
  }
}

const MAX_LINES = 2000;

/** The twelve common content types this tool builds JSON-LD for (D-99). */
export const CONTENT_TYPES = [
  'Article',
  'BlogPosting',
  'Product',
  'Organization',
  'LocalBusiness',
  'Person',
  'Event',
  'Recipe',
  'FAQPage',
  'BreadcrumbList',
  'WebSite',
  'HowTo',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * The type a nested property takes when no explicit `@type` line names one.
 * Each default is a genuine subtype of (or exactly) its property's own
 * schema:rangeIncludes -- test/index.test.ts proves this for every entry.
 */
export const NESTED_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  offers: 'Offer',
  address: 'PostalAddress',
  location: 'Place',
  author: 'Person',
  publisher: 'Organization',
  mainEntity: 'Question',
  acceptedAnswer: 'Answer',
  itemListElement: 'ListItem',
  step: 'HowToStep',
  recipeInstructions: 'HowToStep',
  potentialAction: 'SearchAction',
  aggregateRating: 'AggregateRating',
  brand: 'Brand',
});

export interface JsonLdProblem {
  line: number;
  message: string;
}

export interface BuildJsonLdResult {
  object: Record<string, unknown>;
  json: string;
  scriptTag: string;
  typeChain: string[];
  problems: JsonLdProblem[];
  warnings: string[];
}

// --- container tree, built from the flat assignment list ------------------

interface Container {
  valueLines: { value: string; line: number }[];
  propChildren: Map<string, Container>;
  listChildren: Map<number, Container>;
  explicitType: { value: string; line: number } | null;
}

function newContainer(): Container {
  return { valueLines: [], propChildren: new Map(), listChildren: new Map(), explicitType: null };
}

function buildContainerTree(assignments: PropertyAssignment[]): Container {
  const root = newContainer();
  for (const { path, value, line } of assignments) {
    let current = root;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i]!;
      const isLast = i === path.length - 1;
      if (seg === '@type') {
        // "@type" annotates the container it appears on (never its own
        // child), so it is the one case that does NOT navigate further.
        current.explicitType = { value, line };
        break;
      }
      // Navigate into (creating if needed) the child container this segment
      // names, then -- only for the final segment -- record the value onto
      // THAT child, since propChildren/listChildren always hold "the
      // container for that key", exactly what buildObjectNode reads back.
      if (/^[0-9]+$/.test(seg)) {
        const idx = Number(seg);
        let child = current.listChildren.get(idx);
        if (!child) {
          child = newContainer();
          current.listChildren.set(idx, child);
        }
        current = child;
      } else {
        let child = current.propChildren.get(seg);
        if (!child) {
          child = newContainer();
          current.propChildren.set(seg, child);
        }
        current = child;
      }
      if (isLast) {
        current.valueLines.push({ value, line });
      }
    }
  }
  return root;
}

function collectLines(container: Container): number[] {
  const lines: number[] = [...container.valueLines.map((v) => v.line)];
  if (container.explicitType) lines.push(container.explicitType.line);
  for (const child of container.propChildren.values()) lines.push(...collectLines(child));
  for (const child of container.listChildren.values()) lines.push(...collectLines(child));
  return lines.sort((a, b) => a - b);
}

// --- value formatting -------------------------------------------------------

const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isValidIso8601(value: string): boolean {
  return ISO_8601.test(value) && !Number.isNaN(Date.parse(value));
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function formatLeafValue(
  propName: string,
  value: string,
  line: number,
  ranges: string[],
  problems: JsonLdProblem[],
): string {
  if (ranges.length === 1 && ranges[0] === 'URL') {
    if (!isAbsoluteUrl(value)) {
      problems.push({ line, message: `"${propName}" must be an absolute URL (its range is URL only).` });
    }
    return value;
  }
  if (ranges.length > 0 && ranges.every((r) => r === 'Date' || r === 'DateTime')) {
    if (!isValidIso8601(value)) {
      problems.push({
        line,
        message: `"${propName}" must be an ISO 8601 date or date-time (its range is Date/DateTime only).`,
      });
    }
    return value;
  }
  return value;
}

// --- node type resolution ---------------------------------------------------

function resolveNodeType(
  container: Container,
  nestedDefaultType: string | undefined,
  ownerRanges: string[] | null,
  problems: JsonLdProblem[],
): string | null {
  if (container.explicitType) {
    const candidate = container.explicitType.value.trim();
    if (!TYPES.has(candidate)) {
      problems.push({
        line: container.explicitType.line,
        message: `"${candidate}" is not one of the bundled schema.org types.`,
      });
    } else if (ownerRanges && ownerRanges.length > 0 && !ownerRanges.some((r) => isSubtypeOf(candidate, r))) {
      problems.push({
        line: container.explicitType.line,
        message: `"${candidate}" is not in this property's range (${ownerRanges.join(', ')}) and is not a subtype of any of them.`,
      });
    } else {
      return candidate;
    }
  }
  return nestedDefaultType ?? null;
}

// --- object building ---------------------------------------------------------

function buildObjectNode(
  container: Container,
  typeName: string,
  problems: JsonLdProblem[],
  warnings: string[],
): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  object['@type'] = typeName;

  const typeRecord = TYPES.get(typeName);

  for (const [propName, child] of container.propChildren) {
    if (typeName === 'SearchAction' && propName === 'query-input') {
      // Actions' "<property>-input" annotation (schema.org's actions
      // documentation): a plain text shorthand, not a registered property,
      // and not itself nested.
      const value = child.valueLines[0]?.value ?? '';
      object['query-input'] = value;
      continue;
    }

    const applicable = typeRecord?.properties.includes(propName) ?? false;
    if (!applicable) {
      for (const line of collectLines(child)) {
        problems.push({
          line,
          message: `"${propName}" is not a property schema.org defines for ${typeName} or a parent type.`,
        });
      }
      continue;
    }

    const propRecord = PROPERTIES.get(propName);
    const ranges = propRecord?.ranges ?? [];

    if (child.listChildren.size > 0) {
      const nestedDefault = NESTED_DEFAULTS[propName];
      const indices = [...child.listChildren.keys()].sort((a, b) => a - b);
      const items: unknown[] = [];
      for (const idx of indices) {
        const itemContainer = child.listChildren.get(idx)!;
        const itemType = resolveNodeType(itemContainer, nestedDefault, ranges, problems);
        if (itemType === null) {
          const lines = collectLines(itemContainer);
          problems.push({
            line: lines[0] ?? 0,
            message: `"${propName}.${idx}" needs an explicit "@type" line: there is no default nested type for "${propName}".`,
          });
          continue;
        }
        items.push(buildObjectNode(itemContainer, itemType, problems, warnings));
      }
      object[propName] = items;
    } else if (child.propChildren.size > 0) {
      const nestedDefault = NESTED_DEFAULTS[propName];
      const itemType = resolveNodeType(child, nestedDefault, ranges, problems);
      if (itemType === null) {
        const lines = collectLines(child);
        problems.push({
          line: lines[0] ?? 0,
          message: `"${propName}" needs an explicit "@type" line: there is no default nested type for "${propName}".`,
        });
      } else {
        object[propName] = buildObjectNode(child, itemType, problems, warnings);
      }
    } else if (child.valueLines.length > 0) {
      const formatted = child.valueLines.map(({ value, line }) =>
        formatLeafValue(propName, value, line, ranges, problems),
      );
      object[propName] = formatted.length > 1 ? formatted : formatted[0];
    }
  }

  return object;
}

function escapeForScriptTag(json: string): string {
  return json.replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026');
}

function typeChainOf(type: string): string[] {
  const record = TYPES.get(type);
  return [type, ...(record?.parents ?? [])];
}

/**
 * Builds schema.org JSON-LD for one of the twelve common content types from
 * simple `path: value` property lines, checked against the bundled schema.org
 * subset (property applicability, nested type ranges, URL/Date/DateTime
 * formats).
 */
export function buildJsonLd(type: string, text: string): BuildJsonLdResult {
  if (!(CONTENT_TYPES as readonly string[]).includes(type)) {
    throw new SchemaMarkupError(`"${type}" is not one of the twelve content types this tool builds.`);
  }

  const rawLineCount = text.split(/\r\n|\r|\n/).length;
  if (rawLineCount > MAX_LINES) {
    throw new SchemaMarkupError(
      `This input has more than ${MAX_LINES} lines, so it was refused rather than risk freezing the tab.`,
    );
  }

  const { assignments, problems: parseProblems } = parsePropertyLines(text);
  const problems: JsonLdProblem[] = [...parseProblems];
  const warnings: string[] = [];

  const root = buildContainerTree(assignments);
  const built = buildObjectNode(root, type, problems, warnings);

  const object: Record<string, unknown> = { '@context': 'https://schema.org', ...built };
  const json = JSON.stringify(object, null, 2);
  const scriptTag = `<script type="application/ld+json">\n${escapeForScriptTag(json)}\n</script>`;

  return { object, json, scriptTag, typeChain: typeChainOf(type), problems, warnings };
}
