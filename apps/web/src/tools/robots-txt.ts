import { meta, buildRobotsTxt, parseRobotsTxt, checkPath, RobotsTxtError } from '@fodt/robots-txt';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function splitNonEmptyLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

export default defineTool({
  id: 'robots-txt',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to do',
      type: 'radio',
      default: 'build',
      options: [
        { value: 'build', label: 'Build a robots.txt' },
        { value: 'check', label: 'Check a path' },
      ],
    },
    // Build mode
    {
      name: 'agents',
      label: 'User-agents for this group',
      type: 'text',
      default: '*',
      help: 'Comma separated. * means every crawler.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'disallow',
      label: 'Disallow paths',
      type: 'textarea',
      rows: 4,
      mono: true,
      help: 'One path per line.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'allow',
      label: 'Allow paths',
      type: 'textarea',
      rows: 4,
      mono: true,
      help: 'One path per line.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'blockAgents',
      label: 'Crawlers to block entirely',
      type: 'textarea',
      rows: 2,
      mono: true,
      help: 'One product token per line. Each gets its own Disallow: / group.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'sitemaps',
      label: 'Sitemap URLs',
      type: 'textarea',
      rows: 2,
      mono: true,
      help: 'One absolute URL per line.',
      visible: (v) => v.mode === 'build',
    },
    // Check mode
    {
      name: 'robots',
      label: 'robots.txt text',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.mode === 'check',
    },
    {
      name: 'agent',
      label: 'Crawler product token',
      type: 'text',
      default: 'ExampleBot',
      visible: (v) => v.mode === 'check',
    },
    {
      name: 'path',
      label: 'Path or URL',
      type: 'text',
      mono: true,
      visible: (v) => v.mode === 'check',
    },
  ],
  examples: [
    {
      label: 'Block everything except publications',
      values: { mode: 'build', agents: '*', disallow: '/', allow: '/publications/' },
    },
    {
      label: 'Check RFC 9309s own longest-match example',
      values: {
        mode: 'check',
        robots: 'User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif',
        agent: 'foobot',
        path: '/example/page/disallowed.gif',
      },
    },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'build');

    if (mode === 'check') {
      const robots = str(values, 'robots');
      const agent = str(values, 'agent', 'ExampleBot');
      const path = str(values, 'path');
      if (!robots.trim() || !path.trim()) return { outputs: [] };

      try {
        const parsed = parseRobotsTxt(robots);
        const result = checkPath(parsed, agent, path);

        const outputs: OutputBlock[] = [
          {
            kind: 'note',
            label: 'Verdict',
            tone: result.allowed ? 'success' : 'warn',
            value: `${result.allowed ? 'Allowed' : 'Disallowed'}. ${result.reason}`,
          },
          {
            kind: 'keyvalue',
            label: 'Details',
            pairs: [
              [
                'Group used',
                result.groupAgents && result.groupAgents.length > 0 ? result.groupAgents.join(', ') : '(none)',
              ],
              [
                'Deciding rule',
                result.rule
                  ? `${result.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${result.rule.pattern}`
                  : '(none)',
              ],
              ['Line', result.line === null ? '(none)' : String(result.line)],
            ],
          },
        ];

        if (parsed.problems.length > 0) {
          outputs.push({
            kind: 'list',
            label: 'Problems',
            items: parsed.problems.map((p) => (p.line > 0 ? `Line ${p.line}: ${p.message}` : p.message)),
          });
        }

        return { outputs };
      } catch (err) {
        if (err instanceof RobotsTxtError) return { outputs: [], errors: [{ message: err.message }] };
        const message = err instanceof Error ? err.message : 'Could not process that input.';
        return { outputs: [], errors: [{ message }] };
      }
    }

    // Build mode
    const agents = str(values, 'agents', '*')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a !== '');
    const disallow = splitNonEmptyLines(str(values, 'disallow'));
    const allow = splitNonEmptyLines(str(values, 'allow'));
    const blockAgents = splitNonEmptyLines(str(values, 'blockAgents'));
    const sitemaps = splitNonEmptyLines(str(values, 'sitemaps'));

    if (agents.length === 0 && blockAgents.length === 0 && sitemaps.length === 0) return { outputs: [] };

    try {
      const groups = [];
      if (agents.length > 0) {
        groups.push({
          agents,
          rules: [
            ...disallow.map((pattern) => ({ type: 'disallow' as const, pattern })),
            ...allow.map((pattern) => ({ type: 'allow' as const, pattern })),
          ],
        });
      }
      for (const blocked of blockAgents) {
        groups.push({ agents: [blocked], rules: [{ type: 'disallow' as const, pattern: '/' }] });
      }

      const { text, problems } = buildRobotsTxt({ groups, sitemaps });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'robots.txt', language: 'text', value: text, download: 'robots.txt' },
      ];
      if (problems.length > 0) {
        outputs.push({ kind: 'list', label: 'Problems', items: problems.map((p) => `Line ${p.line}: ${p.message}`) });
      }

      return { outputs };
    } catch (err) {
      if (err instanceof RobotsTxtError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
