import { meta, buildSitemaps, SitemapError } from '@fodt/sitemap-generator';
import {
  defineTool,
  str,
  num,
  formatBytes,
  type DownloadableFile,
  type OutputBlock,
  type ToolResult,
} from '../lib/tool-ui';

const CHANGE_FREQUENCY_OPTIONS = [
  { value: '', label: '(omit)' },
  { value: 'always', label: 'always' },
  { value: 'hourly', label: 'hourly' },
  { value: 'daily', label: 'daily' },
  { value: 'weekly', label: 'weekly' },
  { value: 'monthly', label: 'monthly' },
  { value: 'yearly', label: 'yearly' },
  { value: 'never', label: 'never' },
];

export default defineTool({
  id: 'sitemap-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'urls',
      label: 'URLs',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'baseUrl',
      label: 'Base URL',
      type: 'text',
      mono: true,
      help: 'Where the sitemap files will be published.',
    },
    { name: 'lastmod', label: 'Default lastmod', type: 'text', mono: true },
    { name: 'changefreq', label: 'Default changefreq', type: 'select', default: '', options: CHANGE_FREQUENCY_OPTIONS },
    { name: 'priority', label: 'Default priority', type: 'text', mono: true, help: 'Empty means omit.' },
    { name: 'maxUrls', label: 'Max URLs per file', type: 'number', default: 50000, min: 1, max: 50000 },
  ],
  examples: [
    {
      label: 'Two pages with a shared base URL',
      values: {
        urls: 'https://example.com/\nhttps://example.com/about',
        baseUrl: 'https://example.com/',
        lastmod: '2026-09-25',
      },
    },
  ],
  run(values): ToolResult {
    const urls = str(values, 'urls');
    if (!urls.trim()) return { outputs: [] };

    const baseUrl = str(values, 'baseUrl');
    const lastmod = str(values, 'lastmod');
    const changefreq = str(values, 'changefreq');
    const priority = str(values, 'priority');
    const maxUrlsInput = num(values, 'maxUrls', 50000);
    const maxUrls = Math.min(50000, Math.max(1, Math.trunc(maxUrlsInput)));

    try {
      const result = buildSitemaps(urls, {
        baseUrl: baseUrl || undefined,
        lastmod: lastmod || undefined,
        changefreq: changefreq || undefined,
        priority: priority || undefined,
        maxUrls,
      });

      if (result.files.length === 0) {
        return { outputs: [], errors: [{ message: 'No usable URL was found in that list.' }] };
      }

      const outputs: OutputBlock[] = [];
      let largestBytes = 0;
      for (const f of result.files) largestBytes = Math.max(largestBytes, f.bytes);
      if (result.index) largestBytes = Math.max(largestBytes, result.index.bytes);

      if (result.files.length === 1) {
        outputs.push({
          kind: 'code',
          label: 'sitemap.xml',
          language: 'xml',
          value: result.files[0]!.xml,
          download: 'sitemap.xml',
        });
      } else {
        const downloadFiles: DownloadableFile[] = result.files.map((f) => ({
          name: f.name,
          mime: 'application/xml',
          content: f.xml,
        }));
        if (result.index)
          downloadFiles.push({ name: result.index.name, mime: 'application/xml', content: result.index.xml });
        outputs.push({ kind: 'files', label: 'Sitemap files', files: downloadFiles });
        if (result.index) {
          outputs.push({
            kind: 'code',
            label: result.index.name,
            language: 'xml',
            value: result.index.xml,
            download: result.index.name,
          });
        }
      }

      if (result.problems.length > 0) {
        outputs.push({
          kind: 'list',
          label: 'Problems',
          items: result.problems.map((p) => (p.line > 0 ? `Line ${p.line}: ${p.message}` : p.message)),
        });
      }

      const totalUrls = result.files.reduce((sum, f) => sum + f.urlCount, 0);

      return {
        outputs,
        stats: [
          ['URLs', String(totalUrls)],
          ['Files', String(result.files.length)],
          ['Largest file', `${formatBytes(largestBytes)} (${largestBytes} bytes)`],
        ],
      };
    } catch (err) {
      if (err instanceof SitemapError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
