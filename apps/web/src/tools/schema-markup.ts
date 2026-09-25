import {
  meta,
  buildJsonLd,
  CONTENT_TYPES,
  SCHEMA_ORG_VERSION,
  SchemaMarkupError,
  type ContentType,
} from '@fodt/schema-markup';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DEFAULT_PROPERTIES = 'name: Example page\ndatePublished: 2024-01-01\nauthor.name: Jane Doe';

const EXAMPLE_PROPERTIES: Record<ContentType, string> = {
  Article: 'name: A piece\ndatePublished: 2024-01-01\nauthor.name: Jane Doe',
  BlogPosting: 'name: A post\ndatePublished: 2024-01-01\nauthor.name: Jane Doe',
  Product: 'name: Widget\noffers.price: 19.99\noffers.priceCurrency: USD',
  Organization: 'name: Example Corp\nurl: https://www.example.com/',
  LocalBusiness: 'name: Example Cafe\naddress.streetAddress: 1 Main St\naddress.addressLocality: Springfield',
  Person: 'name: Jane Doe',
  Event: 'name: Launch Party\nstartDate: 2024-06-01T18:00:00Z',
  Recipe: 'name: Soup\nrecipeIngredient: Water\nstep.1.text: Boil the water.',
  FAQPage: 'mainEntity.1.name: What?\nmainEntity.1.acceptedAnswer.text: This.',
  BreadcrumbList:
    'itemListElement.1.position: 1\nitemListElement.1.name: Home\nitemListElement.1.item: https://example.com/\nitemListElement.2.position: 2\nitemListElement.2.name: Category\nitemListElement.2.item: https://example.com/category',
  WebSite:
    'name: Example Site\nurl: https://www.example.com/\npotentialAction.@type: SearchAction\npotentialAction.target.@type: EntryPoint\npotentialAction.target.urlTemplate: https://query.example.com/search?q={search_term_string}\npotentialAction.query-input: required name=search_term_string',
  HowTo: 'name: Make tea\nstep.1.text: Boil water.\nstep.2.text: Add tea leaves.',
};

export default defineTool({
  id: 'schema-markup',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'type',
      label: 'Content type',
      type: 'select',
      default: 'Article',
      options: CONTENT_TYPES.map((t) => ({ value: t, label: t })),
    },
    {
      name: 'properties',
      label: 'Properties',
      type: 'textarea',
      rows: 10,
      mono: true,
      default: DEFAULT_PROPERTIES,
      help: 'One "name: value" per line. A dotted path (offers.price) nests an object; a numbered path (mainEntity.1.name) builds a list. An explicit "@type" line overrides a nested object\'s default type.',
    },
  ],
  examples: CONTENT_TYPES.map((t) => ({
    label: `${t} example`,
    values: { type: t, properties: EXAMPLE_PROPERTIES[t] },
  })),
  run(values): ToolResult {
    const type = str(values, 'type', 'Article');
    const properties = str(values, 'properties');
    if (!properties.trim()) return { outputs: [] };

    try {
      const result = buildJsonLd(type, properties);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'JSON-LD script tag',
          language: 'html',
          value: result.scriptTag,
          download: 'schema.html',
        },
        {
          kind: 'code',
          label: 'JSON-LD',
          language: 'json',
          value: result.json,
        },
        {
          kind: 'keyvalue',
          label: 'Type',
          pairs: [
            ['Type chain', result.typeChain.join(' > ')],
            ['schema.org version', SCHEMA_ORG_VERSION],
          ],
        },
      ];

      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      const errors = result.problems.map((p) => ({ message: p.message, line: p.line || undefined }));

      return { outputs, errors: errors.length > 0 ? errors : undefined };
    } catch (err) {
      if (err instanceof SchemaMarkupError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
