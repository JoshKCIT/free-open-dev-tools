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
};

/** Whether the chosen media uses a field, so a value typed before switching media never reaches a run. */
function whenKind(...kinds: MediaKind[]): (values: Values) => boolean {
  return (values) => kinds.includes(str(values, 'kind', 'video') as MediaKind);
}

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
      name: 'width',
      label: FIELD_LABELS.width,
      type: 'text',
      mono: true,
      help: 'Whole pixels. Giving both width and height lets the browser reserve space and avoids layout shift.',
      visible: whenKind('video'),
    },
    {
      name: 'height',
      label: FIELD_LABELS.height,
      type: 'text',
      mono: true,
      help: 'Whole pixels.',
      visible: whenKind('video'),
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
      visible: whenKind('video', 'audio'),
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
      visible: whenKind('video', 'audio'),
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
  ],
  run(values): ToolResult {
    try {
      const kind = str(values, 'kind', 'video') as MediaKind;
      const spec: MediaSpec = { kind };
      const names = ['src', 'mediaSources', 'tracks', 'preload', 'loading', 'crossorigin', 'fallback'];
      if (kind === 'video') names.push('poster', 'width', 'height');
      const typed: Record<string, string> = {};
      for (const name of names) typed[name] = str(values, name);
      Object.assign(spec, typed);
      for (const name of ['controls', 'autoplay', 'muted', 'loop'] as const) spec[name] = bool(values, name);
      if (kind === 'video') spec.playsinline = bool(values, 'playsinline');
      const built = buildMedia(spec);
      if (built === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Markup', language: 'html', value: built.html, download: 'media-embed-builder.html' },
        { kind: 'sandboxed-html', label: 'Preview (addresses replaced, nothing is loaded)', html: built.preview },
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
