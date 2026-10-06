import {
  meta,
  FAVICON_SET,
  buildIco,
  readIcoDirectory,
  linkTags,
  manifestJson,
  type FaviconOptions,
  type FaviconSource,
  type FaviconShape,
  type FaviconFit,
  type FontFamily,
} from '@fodt/favicon-generator';
import { FAVICON_GENERATOR_STALL_LIMIT_MS, buildFaviconInWorker } from '../lib/run-favicon-generator-in-worker';
import {
  defineTool,
  bool,
  str,
  files,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

function sourceIs(values: Values, source: FaviconSource): boolean {
  return str(values, 'source', 'text') === source;
}

const fields: Field[] = [
  {
    name: 'source',
    label: 'Source',
    type: 'radio',
    default: 'text',
    options: [
      { value: 'text', label: 'Text' },
      { value: 'emoji', label: 'Emoji' },
      { value: 'image', label: 'Image' },
    ],
  },
  {
    name: 'text',
    label: 'Text (1 to 3 characters)',
    type: 'text',
    default: 'Ab',
    visible: (values) => sourceIs(values, 'text'),
  },
  {
    name: 'emoji',
    label: 'Emoji (exactly one)',
    type: 'text',
    default: '🎉',
    visible: (values) => sourceIs(values, 'emoji'),
  },
  { name: 'file', label: 'Image', type: 'file', accept: ACCEPT, visible: (values) => sourceIs(values, 'image') },
  {
    name: 'fit',
    label: 'Fit',
    type: 'radio',
    default: 'cover',
    options: [
      { value: 'cover', label: 'Cover' },
      { value: 'contain', label: 'Contain' },
    ],
    visible: (values) => sourceIs(values, 'image'),
  },
  {
    name: 'shape',
    label: 'Shape',
    type: 'select',
    default: 'square',
    options: [
      { value: 'square', label: 'Square' },
      { value: 'rounded', label: 'Rounded' },
      { value: 'circle', label: 'Circle' },
    ],
  },
  { name: 'foreground', label: 'Foreground colour', type: 'color', default: '#000000' },
  { name: 'background', label: 'Background colour', type: 'color', default: '#ffffff' },
  {
    name: 'transparent',
    label: 'Leave the background transparent where the format allows',
    type: 'checkbox',
    default: false,
    help: 'The Apple touch icon is always opaque; Apple fills a transparent one in black.',
  },
  {
    name: 'font',
    label: 'Font',
    type: 'select',
    default: 'sans-serif',
    options: [
      { value: 'sans-serif', label: 'Sans-serif' },
      { value: 'serif', label: 'Serif' },
      { value: 'monospace', label: 'Monospace' },
    ],
    visible: (values) => sourceIs(values, 'text'),
  },
  { name: 'bold', label: 'Bold', type: 'checkbox', default: true, visible: (values) => sourceIs(values, 'text') },
  { name: 'appName', label: 'Site name (for the manifest)', type: 'text', default: 'My site' },
];

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

export default defineTool({
  id: 'favicon-generator',
  // The Image source reads a picked file only once the visitor presses Run
  // (D-130, D-10); text and emoji sources are just as worker-backed since
  // drawing and encoding six sizes is real background work either way.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: FAVICON_GENERATOR_STALL_LIMIT_MS, kind: 'quiet' },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  async run(values, ctx): Promise<ToolResult> {
    const source = str(values, 'source', 'text') as FaviconSource;
    const picked = files(values, 'file');
    if (source === 'image' && picked.length === 0) return { outputs: [] };
    const file = source === 'image' ? picked[0]! : null;

    const options: FaviconOptions = {
      source,
      text: str(values, 'text', 'Ab'),
      emoji: str(values, 'emoji', '🎉'),
      fit: str(values, 'fit', 'cover') as FaviconFit,
      shape: str(values, 'shape', 'square') as FaviconShape,
      foreground: str(values, 'foreground', '#000000'),
      background: str(values, 'background', '#ffffff'),
      transparent: bool(values, 'transparent', false),
      font: str(values, 'font', 'sans-serif') as FontFamily,
      bold: bool(values, 'bold', true),
      appName: str(values, 'appName', 'My site'),
    };

    let result;
    try {
      result = await buildFaviconInWorker(options, file, ctx);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: `Could not build the favicon set: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }

    const { pngs, warnings } = result;
    const icoImages = [16, 32, 48].map((size) => ({ width: size, height: size, bytes: new Uint8Array(pngs[size]!) }));
    const icoBytes = buildIco(icoImages);
    const icoEntries = readIcoDirectory(icoBytes);

    const outputs: OutputBlock[] = [];
    const downloadFiles = FAVICON_SET.map((entry) => ({
      name: entry.name,
      mime: entry.mediaType,
      content: entry.purpose === 'ico' ? icoBytes : new Uint8Array(pngs[entry.size]!),
    }));
    outputs.push({ kind: 'files', label: 'Favicon set', files: downloadFiles });

    outputs.push({
      kind: 'image',
      label: 'Preview (32px)',
      src: bytesToDataUrl(new Uint8Array(pngs[32]!), 'image/png'),
      alt: 'Favicon preview at 32 pixels',
      width: 32,
      height: 32,
    });
    outputs.push({
      kind: 'image',
      label: 'Preview (180px, Apple touch icon)',
      src: bytesToDataUrl(new Uint8Array(pngs[180]!), 'image/png'),
      alt: 'Apple touch icon preview at 180 pixels',
      width: 180,
      height: 180,
    });

    outputs.push({ kind: 'code', label: 'HTML link tags', language: 'html', value: linkTags() });
    outputs.push({
      kind: 'code',
      label: 'site.webmanifest',
      language: 'json',
      value: manifestJson({ appName: options.appName, background: options.background, foreground: options.foreground }),
      download: 'site.webmanifest',
    });

    return {
      outputs,
      warnings,
      stats: [
        ['Sizes written', FAVICON_SET.map((e) => `${e.size}px`).join(', ')],
        ['ICO entries', icoEntries.map((e) => `${e.width} × ${e.height}`).join(', ')],
      ],
    };
  },
});
