import {
  meta,
  buildDataUri,
  parseDataUri,
  looksLikePlainText,
  DataUriError,
  MAX_DATA_URI_BYTES,
  SIGNATURES,
} from '@fodt/data-uri';
import { defineTool, str, bool, files, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** A human-readable name for which source decided a media type, for the stats line. */
function describeSource(source: string): string {
  switch (source) {
    case 'override':
      return 'the media type you specified';
    case 'signature':
      return "the file's own leading bytes";
    case 'generic-signature':
      return "the file's own leading bytes (a generic container match only)";
    case 'browser-reported':
      return 'what your browser reported for this file';
    default:
      return 'unknown -- neither the signature table nor your browser could tell';
  }
}

/** A filename extension for a decoded download, preferring the signature table's own record of it. */
function extensionFor(mediaType: string): string {
  const bare = mediaType.split(';')[0]!.trim().toLowerCase();
  const bySignature = SIGNATURES.find((s) => s.mediaType.toLowerCase() === bare);
  if (bySignature) return bySignature.extensions[0]!;
  if (bare === 'text/plain') return 'txt';
  if (bare === 'application/octet-stream' || bare === '') return 'bin';
  const subtype = bare.split('/')[1];
  if (subtype) {
    const cleaned = subtype.replace(/^x-/, '').replace(/\+.*/, '');
    if (/^[a-z0-9]+$/.test(cleaned)) return cleaned;
  }
  return 'bin';
}

export default defineTool({
  id: 'data-uri',
  // The first file-reading tool on this site: a file picker is a discrete
  // action, not a keystroke stream, so this page waits for Run rather than
  // converting the moment a file is chosen (ToolRunner.tsx:118's own
  // comment already names file-based work as the autoRun-off case).
  autoRun: false,
  docs: {
    about: meta.about,
    supports: meta.supports,
    limits: meta.limits,
    standards: meta.standards,
  },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'encode',
      options: [
        { value: 'encode', label: 'Encode a file' },
        { value: 'decode', label: 'Decode a data URI' },
      ],
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      // No accept filter: any file works, which is the whole point.
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'mediaTypeOverride',
      label: 'Media type override (optional)',
      type: 'text',
      default: '',
      placeholder: 'Leave blank to detect it automatically',
      help: 'Overrides both the signature table and what your browser reported.',
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'base64',
      label: 'Use base64 (rather than percent-encoding)',
      type: 'checkbox',
      default: true,
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'input',
      label: 'Data URI',
      type: 'textarea',
      rows: 10,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
      visible: (v) => v.direction === 'decode',
    },
  ],
  async run(values): Promise<ToolResult> {
    if (values.direction === 'decode') {
      const input = str(values, 'input');
      if (!input.trim()) return { outputs: [] };

      let parsed;
      try {
        parsed = parseDataUri(input);
      } catch (err) {
        if (err instanceof DataUriError) {
          return {
            outputs: [],
            errors: [
              { message: err.message, line: 1, column: err.position === undefined ? undefined : err.position + 1 },
            ],
          };
        }
        throw err;
      }

      const ext = extensionFor(parsed.mediaType);
      const outputs: OutputBlock[] = [
        {
          kind: 'files',
          label: 'Decoded file',
          files: [{ name: `decoded.${ext}`, mime: parsed.mediaType, content: parsed.bytes }],
        },
      ];
      if (looksLikePlainText(parsed.bytes)) {
        outputs.push({
          kind: 'code',
          label: 'Decoded text',
          value: new TextDecoder().decode(parsed.bytes),
        });
      }

      const paramsText = parsed.params.length > 0 ? parsed.params.map(([k, v]) => `${k}=${v}`).join('; ') : 'none';

      return {
        outputs,
        stats: [
          ['Media type', parsed.mediaType],
          ['Parameters', paramsText],
          ['Encoding', parsed.base64 ? 'base64' : 'percent-encoded'],
          ['Bytes', formatBytes(parsed.bytes.length)],
        ],
      };
    }

    // Encode.
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    if (file.size === 0) {
      return { outputs: [], errors: [{ message: `Could not read '${file.name}': the file is empty.` }] };
    }
    if (file.size > MAX_DATA_URI_BYTES) {
      return {
        outputs: [],
        errors: [
          {
            message: `Could not read '${file.name}': it is ${formatBytes(file.size)}, above the ${formatBytes(MAX_DATA_URI_BYTES)} limit this tool reads before attempting to build a data URI.`,
          },
        ],
      };
    }

    let bytes: Uint8Array;
    try {
      const buffer = await file.arrayBuffer();
      bytes = new Uint8Array(buffer);
    } catch {
      return {
        outputs: [],
        errors: [
          {
            message: `Could not read '${file.name}': the browser could not read this file (it may have been moved or deleted after you selected it).`,
          },
        ],
      };
    }

    const override = str(values, 'mediaTypeOverride').trim();
    let result;
    try {
      result = buildDataUri(bytes, {
        mediaType: override || undefined,
        browserReportedType: file.type,
        base64: bool(values, 'base64', true),
      });
    } catch (err) {
      if (err instanceof DataUriError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }

    const outputs: OutputBlock[] = [
      { kind: 'code', label: 'Data URI', value: result.dataUri, download: 'encoded.txt' },
    ];
    if (result.source === 'generic-signature' || result.source === 'unknown') {
      outputs.unshift({
        kind: 'note',
        tone: 'info',
        value: `This tool could only tell that this file is ${result.source === 'generic-signature' ? 'a generic container format' : 'of an unrecognised type'}. The media type above is its best guess; use the override field if you know the real one.`,
      });
    }

    return {
      outputs,
      stats: [
        ['File', file.name],
        ['Size', formatBytes(file.size)],
        ['Detected type', result.mediaType],
        ['How the type was decided', describeSource(result.source)],
      ],
    };
  },
});
