import {
  meta,
  buildMedia,
  MarkupError,
  MEDIA_KINDS,
  FIELD_LABELS,
  type MediaKind,
  type MediaSpec,
} from '@fodt/media-embed-builder';
import { defineTool, bool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const KIND_LABELS: Record<MediaKind, string> = {
  video: 'video',
  audio: 'audio',
  image: 'Responsive image (img with srcset)',
  picture: 'Picture with sources',
};

/** Whether the chosen media uses a field, so a value typed before switching media never reaches a run. */
function whenKind(...kinds: MediaKind[]): (values: Values) => boolean {
  return (values) => kinds.includes(str(values, 'kind', 'video') as MediaKind);
}

/** The text fields each media reads, in the order the page shows them. */
const READS: Record<MediaKind, string[]> = {
  video: [
    'src',
    'mediaSources',
    'tracks',
    'poster',
    'width',
    'height',
    'preload',
    'loading',
    'crossorigin',
    'fallback',
  ],
  audio: ['src', 'mediaSources', 'tracks', 'preload', 'loading', 'crossorigin', 'fallback'],
  image: ['imageSrc', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'crossorigin'],
  picture: ['imageSrc', 'pictureSources', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'crossorigin'],
};

/** The checkboxes each media reads. */
const FLAGS: Record<MediaKind, (keyof MediaSpec)[]> = {
  video: ['controls', 'autoplay', 'muted', 'loop', 'playsinline'],
  audio: ['controls', 'autoplay', 'muted', 'loop'],
  image: ['decorative'],
  picture: ['decorative'],
};

export default defineTool({
  id: 'media-embed-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'kind',
      label: FIELD_LABELS.kind,
      type: 'select',
      default: 'video',
      options: MEDIA_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
    },
    {
      name: 'src',
      label: FIELD_LABELS.src,
      type: 'text',
      mono: true,
      placeholder: 'brave.webm',
      help: 'One file. Leave blank to use the source lines instead; the two cannot be mixed. Written exactly as you type it and never loaded in the preview.',
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'mediaSources',
      label: FIELD_LABELS.mediaSources,
      type: 'textarea',
      rows: 3,
      help: 'One per line: address | type | media',
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'tracks',
      label: FIELD_LABELS.tracks,
      type: 'textarea',
      rows: 3,
      help: 'One per line: address | kind | language | label | default',
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'poster',
      label: FIELD_LABELS.poster,
      type: 'text',
      mono: true,
      placeholder: 'poster.jpg',
      help: 'The picture shown before the video plays. Written exactly as you type it and never loaded in the preview.',
      visible: whenKind('video'),
    },
    {
      name: 'imageSrc',
      label: FIELD_LABELS.imageSrc,
      type: 'text',
      mono: true,
      placeholder: 'photo-800.jpg',
      help: 'The image shown when no source or candidate is chosen. Written exactly as you type it. The preview shows a grey placeholder instead of loading it.',
      visible: whenKind('image', 'picture'),
    },
    {
      name: 'pictureSources',
      label: FIELD_LABELS.pictureSources,
      type: 'textarea',
      rows: 3,
      help: 'One per line: srcset | type | media | sizes. A source followed by another source needs a type or a media value.',
      visible: whenKind('picture'),
    },
    {
      name: 'srcset',
      label: FIELD_LABELS.srcset,
      type: 'text',
      mono: true,
      placeholder: 'photo-400.jpg 400w, photo-800.jpg 800w',
      help: 'Candidates separated by commas, each an address and then a width such as 400w or a density such as 2x, never both kinds.',
      visible: whenKind('image', 'picture'),
    },
    {
      name: 'sizes',
      label: FIELD_LABELS.sizes,
      type: 'text',
      mono: true,
      placeholder: '(max-width: 600px) 100vw, 800px',
      help: 'Needed with width descriptors. Media conditions with lengths, ending in a length; no percentages. auto works only with loading set to lazy.',
      visible: whenKind('image', 'picture'),
    },
    {
      name: 'alt',
      label: FIELD_LABELS.alt,
      type: 'text',
      help: 'Describes the image in words for a visitor who cannot see it. Required unless the image is decorative.',
      visible: whenKind('image', 'picture'),
    },
    {
      name: 'decorative',
      label: FIELD_LABELS.decorative,
      type: 'checkbox',
      default: false,
      visible: whenKind('image', 'picture'),
    },
    {
      name: 'width',
      label: FIELD_LABELS.width,
      type: 'text',
      mono: true,
      help: 'Whole pixels. Giving both width and height lets the browser reserve space and avoids layout shift.',
      visible: whenKind('video', 'image', 'picture'),
    },
    {
      name: 'height',
      label: FIELD_LABELS.height,
      type: 'text',
      mono: true,
      help: 'Whole pixels.',
      visible: whenKind('video', 'image', 'picture'),
    },
    {
      name: 'controls',
      label: FIELD_LABELS.controls,
      type: 'checkbox',
      default: true,
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'autoplay',
      label: FIELD_LABELS.autoplay,
      type: 'checkbox',
      default: false,
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'muted',
      label: FIELD_LABELS.muted,
      type: 'checkbox',
      default: false,
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'loop',
      label: FIELD_LABELS.loop,
      type: 'checkbox',
      default: false,
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'playsinline',
      label: FIELD_LABELS.playsinline,
      type: 'checkbox',
      default: false,
      visible: whenKind('video'),
    },
    {
      name: 'preload',
      label: FIELD_LABELS.preload,
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(not set)' },
        { value: 'auto', label: 'auto' },
        { value: 'metadata', label: 'metadata' },
        { value: 'none', label: 'none' },
      ],
      visible: whenKind('video', 'audio'),
    },
    {
      name: 'loading',
      label: FIELD_LABELS.loading,
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(not set)' },
        { value: 'lazy', label: 'lazy' },
        { value: 'eager', label: 'eager' },
      ],
      help: 'Lazy loading defers the fetch until the element is near the viewport. On video and audio only some browsers act on it.',
      visible: whenKind('video', 'audio', 'image', 'picture'),
    },
    {
      name: 'crossorigin',
      label: FIELD_LABELS.crossorigin,
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(not set)' },
        { value: 'anonymous', label: 'anonymous' },
        { value: 'use-credentials', label: 'use-credentials' },
      ],
      visible: whenKind('video', 'audio', 'image', 'picture'),
    },
    {
      name: 'fallback',
      label: FIELD_LABELS.fallback,
      type: 'text',
      help: 'Optional. Shown only by a browser that cannot play media; it is not a substitute for captions.',
      visible: whenKind('video', 'audio'),
    },
  ],
  examples: [
    {
      label: 'WHATWG 4.8.10 example: a video with subtitles and captions',
      values: {
        kind: 'video',
        src: 'brave.webm',
        tracks:
          'brave.en.vtt | subtitles | en | English\nbrave.en.hoh.vtt | captions | en | English for the Hard of Hearing',
      },
    },
    {
      label: 'Audio with an Ogg and an MP3 source',
      values: {
        kind: 'audio',
        mediaSources: 'song.ogg | audio/ogg\nsong.mp3 | audio/mpeg',
      },
    },
    {
      label: 'A responsive image with width descriptors and sizes',
      values: {
        kind: 'image',
        imageSrc: 'photo-800.jpg',
        srcset: 'photo-400.jpg 400w, photo-800.jpg 800w',
        sizes: '(max-width: 600px) 100vw, 800px',
        alt: 'A harbour at dusk',
        width: '800',
        height: '533',
      },
    },
    {
      label: 'A picture with a modern format and a fallback',
      values: {
        kind: 'picture',
        imageSrc: 'hero.jpg',
        pictureSources: 'hero.avif | image/avif',
        alt: 'Hero image',
        width: '400',
        height: '300',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const kind = str(values, 'kind', 'video') as MediaKind;
      const spec: MediaSpec = { kind };
      const typed: Record<string, string> = {};
      for (const name of READS[kind]) typed[name === 'imageSrc' ? 'src' : name] = str(values, name);
      Object.assign(spec, typed);
      const flags: Record<string, boolean> = {};
      for (const name of FLAGS[kind]) flags[name] = bool(values, name);
      Object.assign(spec, flags);
      const built = buildMedia(spec);
      if (built === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: built.html, download: 'media-embed-builder.html' },
        {
          kind: 'sandboxed-html',
          label: 'Preview (addresses replaced, nothing is loaded)',
          copy: false,
          html: built.preview,
        },
      ];
      if (built.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: built.warnings.join('\n') });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof MarkupError) return { outputs: [], errors: [{ message: `${err.field}: ${err.message}` }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
