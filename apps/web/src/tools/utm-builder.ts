import { meta, buildCampaignUrl, UTM_PARAMETERS, UtmBuilderError } from '@fodt/utm-builder';
import { defineTool, str, bool, type Field, type OutputBlock, type ToolResult } from '../lib/tool-ui';

// Help text for each parameter field, transcribed from the Google Analytics
// documentation this tool's package meta.json cites.
const PARAMETER_HELP: Record<string, string> = {
  utm_id: 'Campaign ID. Used to identify a specific campaign or promotion.',
  utm_source: 'Referrer, for example: google, newsletter4, billboard.',
  utm_medium: 'Marketing medium, for example: cpc, banner, email.',
  utm_campaign: 'Product, slogan, promo code, for example: spring_sale.',
  utm_source_platform: 'The platform responsible for directing traffic to this property.',
  utm_term: 'Paid keyword.',
  utm_content: 'Used to differentiate creatives that otherwise point at the same place.',
  utm_creative_format: 'Type of creative, for example: display, native, video, search.',
  utm_marketing_tactic: 'Targeting criteria applied to a campaign, for example: remarketing, prospecting.',
};

const parameterFields: Field[] = UTM_PARAMETERS.map((p) => ({
  name: p.name,
  label: p.name,
  type: 'text',
  help: PARAMETER_HELP[p.name],
}));

export default defineTool({
  id: 'utm-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'url',
      label: 'Destination URL',
      type: 'text',
      mono: true,
      placeholder: 'https://www.example.com/page',
    },
    ...parameterFields,
    { name: 'lowercase', label: 'Lower-case every value', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: "Google Analytics' own worked example",
      values: {
        url: 'https://www.example.com/',
        utm_source: 'summer-mailer',
        utm_medium: 'email',
        utm_campaign: 'summer-sale',
      },
    },
  ],
  run(values): ToolResult {
    const url = str(values, 'url');
    if (!url.trim()) return { outputs: [] };

    const params: Record<string, string> = {};
    for (const { name } of UTM_PARAMETERS) {
      const value = str(values, name);
      if (value.trim()) params[name] = value;
    }

    try {
      const result = buildCampaignUrl(url, params, { lowercase: bool(values, 'lowercase', false) });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Campaign URL', value: result.url, download: 'campaign-url.txt' },
        {
          kind: 'keyvalue',
          label: 'Added parameters',
          pairs: [
            ...result.added.map((n): [string, string] => [n, 'added']),
            ...result.replaced.map((n): [string, string] => [n, 'replaced']),
          ],
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof UtmBuilderError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
