import { meta, buildMetaTags, buildSocialPreview, MetaTagsError, describeRemoved } from '@fodt/meta-tags';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'meta-tags',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'title', label: 'Title', type: 'text', placeholder: 'Type or paste here. Nothing leaves your browser.' },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      rows: 3,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'canonical',
      label: 'Canonical URL',
      type: 'text',
      mono: true,
      placeholder: 'https://www.example.com/page',
    },
    { name: 'imageUrl', label: 'Image URL', type: 'text', mono: true, placeholder: 'https://www.example.com/card.png' },
    { name: 'imageAlt', label: 'Image description', type: 'text' },
    { name: 'siteName', label: 'Site name', type: 'text' },
    { name: 'locale', label: 'Locale', type: 'text', placeholder: 'en_US' },
    { name: 'twitterSite', label: 'Twitter/X site handle', type: 'text', placeholder: '@example' },
    { name: 'twitterCreator', label: 'Twitter/X author handle', type: 'text', placeholder: '@example' },
    {
      name: 'robots',
      label: 'Robots',
      type: 'select',
      default: 'index, follow',
      options: [
        { value: 'index, follow', label: 'index, follow' },
        { value: 'noindex, follow', label: 'noindex, follow' },
        { value: 'index, nofollow', label: 'index, nofollow' },
        { value: 'noindex, nofollow', label: 'noindex, nofollow' },
      ],
    },
    {
      name: 'ogType',
      label: 'Open Graph type',
      type: 'select',
      default: 'website',
      options: [
        { value: 'website', label: 'website' },
        { value: 'article', label: 'article' },
      ],
    },
    {
      name: 'twitterCard',
      label: 'Twitter/X card layout',
      type: 'select',
      default: 'summary_large_image',
      options: [
        { value: 'summary_large_image', label: 'summary_large_image' },
        { value: 'summary', label: 'summary' },
      ],
    },
  ],
  examples: [
    {
      label: "ogp.me's own worked example",
      values: {
        title: 'The Rock',
        canonical: 'https://www.imdb.com/title/tt0117500/',
        imageUrl: 'https://ia.media-imdb.com/images/rock.jpg',
        ogType: 'article',
      },
    },
  ],
  run(values): ToolResult {
    const title = str(values, 'title');
    const description = str(values, 'description');
    const canonical = str(values, 'canonical');
    const imageUrl = str(values, 'imageUrl');
    if (!title.trim() && !description.trim() && !canonical.trim() && !imageUrl.trim()) {
      return { outputs: [] };
    }

    const fields = {
      title,
      description,
      canonical,
      imageUrl,
      imageAlt: str(values, 'imageAlt'),
      siteName: str(values, 'siteName'),
      locale: str(values, 'locale'),
      twitterSite: str(values, 'twitterSite'),
      twitterCreator: str(values, 'twitterCreator'),
      robots: str(values, 'robots', 'index, follow'),
      ogType: str(values, 'ogType', 'website'),
      twitterCard: str(values, 'twitterCard', 'summary_large_image') as 'summary' | 'summary_large_image',
    };

    try {
      const tags = buildMetaTags(fields);
      const preview = buildSocialPreview(fields, window);

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Tags for your head', language: 'html', value: tags.html, download: 'meta-tags.html' },
        { kind: 'sandboxed-html', label: 'Social preview', html: preview.html },
      ];
      const notes = [...tags.warnings, ...describeRemoved(preview.removed)];
      if (notes.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: notes.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof MetaTagsError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
