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
      help: 'Written exactly as you type it. The preview does not load it.',
      visible: whenKind('video'),
    },
    {
      name: 'tracks',
      label: FIELD_LABELS.tracks,
      type: 'textarea',
      rows: 3,
      help: 'One per line: address | kind | language | label | default',
      visible: whenKind('video'),
    },
    {
      name: 'controls',
      label: FIELD_LABELS.controls,
      type: 'checkbox',
      default: true,
      visible: whenKind('video'),
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
  ],
  run(values): ToolResult {
    try {
      const kind = str(values, 'kind', 'video') as MediaKind;
      const spec: MediaSpec = {
        kind,
        src: str(values, 'src'),
        tracks: str(values, 'tracks'),
        controls: bool(values, 'controls'),
      };
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
