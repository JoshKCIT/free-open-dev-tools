import {
  ManifestBuilderError,
  buildManifest,
  installAdvice,
  manifestLinkTag,
  manifestToJson,
  meta,
  processManifest,
  type ManifestFinding,
  type ProcessedRow,
} from '@fodt/web-manifest-builder';
import { defineTool, grid, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

/** The most findings listed; the counts above the list cover every finding. */
const MAX_FINDINGS_SHOWN = 200;

const DISPLAY_OPTIONS = [
  { value: 'unset', label: 'Not set' },
  { value: 'fullscreen', label: 'fullscreen' },
  { value: 'standalone', label: 'standalone' },
  { value: 'minimal-ui', label: 'minimal-ui' },
  { value: 'browser', label: 'browser' },
];

const ORIENTATION_OPTIONS = [
  { value: 'unset', label: 'Not set' },
  { value: 'any', label: 'any' },
  { value: 'natural', label: 'natural' },
  { value: 'landscape', label: 'landscape' },
  { value: 'portrait', label: 'portrait' },
  { value: 'portrait-primary', label: 'portrait-primary' },
  { value: 'portrait-secondary', label: 'portrait-secondary' },
  { value: 'landscape-primary', label: 'landscape-primary' },
  { value: 'landscape-secondary', label: 'landscape-secondary' },
];

const DIR_OPTIONS = [
  { value: 'unset', label: 'Not set' },
  { value: 'ltr', label: 'ltr' },
  { value: 'rtl', label: 'rtl' },
  { value: 'auto', label: 'auto' },
];

const DEFAULT_ICONS = [
  ['icons/icon-192.png', '192x192', 'image/png', ''],
  ['icons/icon-512.png', '512x512', 'image/png', ''],
];

const DEFAULT_SHORTCUTS = [['', '']];

/** A select value that means "leave the member out". */
function choice(values: Values, name: string): string {
  const value = str(values, name, 'unset');
  return value === 'unset' ? '' : value;
}

function severityLabel(finding: ManifestFinding): string {
  return finding.severity === 'ignored' ? 'ignored' : finding.severity === 'warning' ? 'warning' : 'note';
}

function tableRows(rows: ProcessedRow[]): string[][] {
  return rows.map((row) => [row.member, row.written, row.processed, row.status]);
}

function outputsFor(values: Values): { outputs: OutputBlock[]; stats: [string, string][] } {
  const manifestUrl = str(values, 'manifestUrl');
  const pageUrl = str(values, 'pageUrl');
  const manifest = buildManifest({
    name: str(values, 'name'),
    shortName: str(values, 'shortName'),
    id: str(values, 'id'),
    startUrl: str(values, 'startUrl'),
    scope: str(values, 'scope'),
    display: choice(values, 'display'),
    displayOverride: str(values, 'displayOverride'),
    orientation: choice(values, 'orientation'),
    dir: choice(values, 'dir'),
    lang: str(values, 'lang'),
    themeColor: str(values, 'themeColor'),
    backgroundColor: str(values, 'backgroundColor'),
    icons: grid(values, 'icons'),
    shortcuts: grid(values, 'shortcuts'),
  });
  const { processed, findings } = processManifest(manifest, manifestUrl, pageUrl);

  const outputs: OutputBlock[] = [
    {
      kind: 'code',
      label: 'Manifest',
      language: 'json',
      value: manifestToJson(manifest),
      download: 'manifest.webmanifest',
    },
    {
      kind: 'table',
      label: 'How a browser reads it',
      table: {
        headers: ['Member', 'Written', 'Processed', 'Status'],
        rows: tableRows(processed.rows),
        mono: [0, 1, 2],
      },
    },
  ];

  const ignored = findings.filter((finding) => finding.severity === 'ignored').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  if (findings.length === 0) {
    outputs.push({ kind: 'note', tone: 'success', value: 'No findings: every member is read as written.' });
  } else {
    outputs.push({
      kind: 'list',
      label: 'Findings',
      items: findings
        .slice(0, MAX_FINDINGS_SHOWN)
        .map((finding) => `${severityLabel(finding)}: ${finding.member}: ${finding.message}`),
    });
    if (findings.length > MAX_FINDINGS_SHOWN) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing the first ${MAX_FINDINGS_SHOWN} of ${findings.length} findings.`,
      });
    }
  }

  outputs.push({
    kind: 'code',
    label: 'Link tag for the page',
    language: 'html',
    value: manifestLinkTag(manifestUrl, pageUrl),
  });

  const advice = installAdvice(processed);
  outputs.push({
    kind: 'note',
    label: 'Advice some browsers apply',
    tone: 'info',
    value:
      'This is advice, not part of the W3C Web Application Manifest specification, and it is not written into the manifest. ' +
      (advice.length === 0
        ? 'Nothing is missing from what browsers commonly look for before they offer to install a web app.'
        : 'Browsers commonly look for these before they offer to install a web app. ' + advice.join(' ')),
  });

  return {
    outputs,
    stats: [
      ['Members written', String(Object.keys(manifest).length)],
      ['Ignored by a browser', String(ignored)],
      ['Warnings', String(warnings)],
    ],
  };
}

export default defineTool({
  id: 'web-manifest-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'manifestUrl',
      label: 'Manifest address',
      type: 'text',
      default: 'https://example.com/manifest.webmanifest',
      mono: true,
      help: 'Where the manifest will be served. Relative addresses in it are resolved against this. Text only: nothing is requested.',
    },
    {
      name: 'pageUrl',
      label: 'Page address',
      type: 'text',
      default: 'https://example.com/',
      mono: true,
      help: 'The page that links the manifest. The start URL must be on its origin. Text only: nothing is requested.',
    },
    { name: 'name', label: 'Name', type: 'text', default: 'My web app', help: 'name: the full name of the app.' },
    {
      name: 'shortName',
      label: 'Short name',
      type: 'text',
      default: 'My app',
      help: 'short_name: used where there is little room.',
    },
    {
      name: 'startUrl',
      label: 'Start URL',
      type: 'text',
      default: '/',
      mono: true,
      help: 'start_url: where the app opens. Empty means the page address.',
    },
    {
      name: 'id',
      label: 'ID',
      type: 'text',
      mono: true,
      placeholder: 'Defaults to the start URL',
      help: 'id: the identity of the app, on the start URL origin. Its fragment is dropped.',
    },
    {
      name: 'scope',
      label: 'Scope',
      type: 'text',
      mono: true,
      placeholder: 'Defaults to the start URL folder',
      help: 'scope: the addresses that belong to the app. It must contain the start URL.',
    },
    {
      name: 'display',
      label: 'Display',
      type: 'select',
      default: 'standalone',
      options: DISPLAY_OPTIONS,
      help: 'display: how the app is shown.',
    },
    {
      name: 'displayOverride',
      label: 'display_override',
      type: 'text',
      mono: true,
      placeholder: 'For example window-controls-overlay, minimal-ui',
      help: 'Not part of the W3C specification. Display modes separated by commas or spaces.',
    },
    {
      name: 'orientation',
      label: 'Orientation',
      type: 'select',
      default: 'unset',
      options: ORIENTATION_OPTIONS,
      help: 'orientation: the screen orientation the app prefers.',
    },
    {
      name: 'dir',
      label: 'Direction',
      type: 'select',
      default: 'unset',
      options: DIR_OPTIONS,
      help: 'dir: the direction of the text in name and short_name.',
    },
    {
      name: 'lang',
      label: 'Language',
      type: 'text',
      default: 'en',
      mono: true,
      help: 'lang: a BCP 47 language tag such as en, en-US or zh-Hans-CN.',
    },
    {
      name: 'themeColor',
      label: 'Theme colour',
      type: 'color',
      default: '#0b57d0',
      help: 'theme_color: hex, rgb(), hsl() or a colour name.',
    },
    {
      name: 'backgroundColor',
      label: 'Background colour',
      type: 'color',
      default: '#ffffff',
      help: 'background_color: shown while the app loads.',
    },
    {
      name: 'icons',
      label: 'Icons',
      type: 'grid',
      default: DEFAULT_ICONS,
      maxRows: 50,
      maxColumns: 4,
      help: 'One icon per row. Columns, left to right: src, sizes, type, purpose. Addresses are resolved against the manifest address and never fetched.',
    },
    {
      name: 'shortcuts',
      label: 'Shortcuts',
      type: 'grid',
      default: DEFAULT_SHORTCUTS,
      maxRows: 20,
      maxColumns: 2,
      help: 'One shortcut per row. Columns, left to right: name, url. The url must be within the scope.',
    },
  ],
  examples: [
    {
      label: 'A standalone app',
      values: {
        manifestUrl: 'https://example.com/app/manifest.webmanifest',
        pageUrl: 'https://example.com/app/start.html',
        name: 'Super Racer 3000',
        shortName: 'Racer3K',
        startUrl: '/app/start.html',
        id: 'superracer',
        scope: '/app/',
        display: 'standalone',
        displayOverride: '',
        orientation: 'landscape',
        dir: 'ltr',
        lang: 'en',
        themeColor: '#0b57d0',
        backgroundColor: '#ffffff',
        icons: [
          ['icons/icon-192.png', '192x192', 'image/png', ''],
          ['icons/icon-512.png', '512x512', 'image/png', 'maskable any'],
        ],
        shortcuts: [['Play Later', '/app/play-later']],
      },
    },
    {
      label: 'A scope that does not contain the start address',
      values: {
        manifestUrl: 'https://example.com/manifest.webmanifest',
        pageUrl: 'https://example.com/',
        name: 'My web app',
        shortName: 'My app',
        startUrl: '/app/start.html',
        id: '',
        scope: '/other/',
        display: 'standalone',
        displayOverride: '',
        orientation: 'unset',
        dir: 'unset',
        lang: 'en',
        themeColor: '#0b57d0',
        backgroundColor: '#ffffff',
        icons: [['icons/icon-192.png', '192x192', 'image/png', '']],
        shortcuts: [['Settings', '/other/settings']],
      },
    },
  ],
  run(values): ToolResult {
    try {
      const { outputs, stats } = outputsFor(values);
      return { outputs, stats };
    } catch (error) {
      if (error instanceof ManifestBuilderError) return { outputs: [], errors: [{ message: error.message }] };
      return { outputs: [], errors: [{ message: 'Could not build this manifest.' }] };
    }
  },
});
