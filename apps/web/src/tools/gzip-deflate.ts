import {
  meta,
  decompress,
  compress,
  GzipDeflateError,
  type CompressFormat,
  type CompressOutputEncoding,
} from '@fodt/gzip-deflate';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DISPLAY_LIMIT = 1_048_576;
const PREVIEW_BYTES = 4096;

function toHexPreview(bytes: Uint8Array): string {
  const slice = bytes.length > PREVIEW_BYTES ? bytes.slice(0, PREVIEW_BYTES) : bytes;
  let out = '';
  for (const b of slice) out += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
  return out.trim() + (bytes.length > PREVIEW_BYTES ? ' …' : '');
}

function formatMtime(mtime: number): string {
  if (mtime === 0) return 'not set (0)';
  return new Date(mtime * 1000).toISOString();
}

function ratioText(inputBytes: number, outputBytes: number): string {
  if (inputBytes === 0) return outputBytes === 0 ? '1:1' : 'n/a';
  return `${(outputBytes / inputBytes).toFixed(3)}:1`;
}

export default defineTool({
  id: 'gzip-deflate',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  autoRun: true,
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'decompress',
      options: [
        { value: 'decompress', label: 'Decompress' },
        { value: 'compress', label: 'Compress' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
    },
    {
      name: 'inputEncoding',
      label: 'Input encoding',
      type: 'select',
      default: 'base64',
      options: [
        { value: 'base64', label: 'Base64 (standard or URL-safe)' },
        { value: 'hex', label: 'Hex' },
        { value: 'url-base64', label: 'URL-encoded Base64 (for example a SAMLRequest value)' },
      ],
      visible: (v) => v.direction === 'decompress',
    },
    {
      name: 'container',
      label: 'Container',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto-detect' },
        { value: 'gzip', label: 'gzip' },
        { value: 'zlib', label: 'zlib' },
        { value: 'raw', label: 'Raw deflate' },
      ],
      visible: (v) => v.direction === 'decompress',
    },
    {
      name: 'compressInput',
      label: 'Input is',
      type: 'select',
      default: 'text',
      options: [
        { value: 'text', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex bytes' },
      ],
      visible: (v) => v.direction === 'compress',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'select',
      default: 'gzip',
      options: [
        { value: 'gzip', label: 'gzip' },
        { value: 'zlib', label: 'zlib' },
        { value: 'raw', label: 'Raw deflate' },
      ],
      visible: (v) => v.direction === 'compress',
    },
    {
      name: 'level',
      label: 'Level',
      type: 'select',
      default: '6',
      options: Array.from({ length: 10 }, (_, n) => ({ value: String(n), label: String(n) })),
      visible: (v) => v.direction === 'compress',
    },
    {
      name: 'outputEncoding',
      label: 'Output encoding',
      type: 'select',
      default: 'base64',
      options: [
        { value: 'base64', label: 'Base64' },
        { value: 'base64url', label: 'Base64url (unpadded)' },
        { value: 'hex', label: 'Hex' },
      ],
      visible: (v) => v.direction === 'compress',
    },
    {
      name: 'percentEncode',
      label: 'Percent-encode the output (for a URL)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'compress' && (v.outputEncoding === 'base64' || v.outputEncoding === 'base64url'),
    },
  ],
  examples: [
    {
      label: 'Decompress a gzip sample',
      values: {
        direction: 'decompress',
        inputEncoding: 'base64',
        container: 'auto',
        input: 'H4sIAAAAAAAAA/NIzcnJV0grys9VSK/KLNDjcs7PLShKLS5OTVHIzFMoyUhVSCrKLy9OLdLjAgCgKKvsLAAAAA==',
      },
    },
    {
      label: 'Compress a short text to gzip',
      values: {
        direction: 'compress',
        compressInput: 'text',
        format: 'gzip',
        level: '6',
        outputEncoding: 'base64',
        input: 'hello there',
      },
    },
    {
      label: 'A URL-encoded Base64 raw-deflate value (SAML-style)',
      values: {
        direction: 'decompress',
        inputEncoding: 'url-base64',
        container: 'raw',
        input: 'sylOzM0psHIsLcnIC0otLE0tLlHwdLFVik%2BtSMwtyElV0rcDAA%3D%3D',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    if (values.direction === 'compress') {
      try {
        const result = compress(input, {
          inputKind: str(values, 'compressInput', 'text') as 'text' | 'hex',
          format: str(values, 'format', 'gzip') as CompressFormat,
          level: num(values, 'level', 6),
          outputEncoding: str(values, 'outputEncoding', 'base64') as CompressOutputEncoding,
          percentEncode: bool(values, 'percentEncode', false),
        });
        const format = str(values, 'format', 'gzip') as CompressFormat;
        const ext = format === 'gzip' ? 'gz' : format === 'zlib' ? 'zz' : 'deflate';
        return {
          outputs: [
            { kind: 'code', label: 'Compressed', value: result.text, download: 'compressed.txt' },
            {
              kind: 'files',
              label: 'Exact bytes',
              files: [{ name: `compressed.${ext}`, mime: 'application/octet-stream', content: result.bytes }],
            },
          ],
          stats: [
            ['Input bytes', String(result.inputBytes.length)],
            ['Output bytes', String(result.bytes.length)],
            ['Ratio', ratioText(result.inputBytes.length, result.bytes.length)],
          ],
        };
      } catch (err) {
        if (err instanceof GzipDeflateError) {
          return {
            outputs: [],
            errors: [{ message: err.message, column: err.position === undefined ? undefined : err.position + 1 }],
          };
        }
        throw err;
      }
    }

    try {
      const result = decompress(input, {
        inputEncoding: str(values, 'inputEncoding', 'base64') as 'base64' | 'hex' | 'url-base64',
        container: str(values, 'container', 'auto') as 'auto' | 'gzip' | 'zlib' | 'raw',
      });

      const outputs: OutputBlock[] = [];
      if (result.text !== null) {
        const shown = result.text.length > DISPLAY_LIMIT ? result.text.slice(0, DISPLAY_LIMIT) : result.text;
        if (result.text.length > DISPLAY_LIMIT) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: `Showing the first ${DISPLAY_LIMIT.toLocaleString()} characters. The download holds the complete text.`,
          });
        }
        outputs.push({ kind: 'code', label: 'Decompressed text (UTF-8)', value: shown, download: 'decompressed.txt' });
      } else {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: 'These bytes are not valid UTF-8, so they are shown as hex. The download holds the exact bytes.',
        });
        outputs.push({ kind: 'code', label: 'Decompressed bytes (hex)', value: toHexPreview(result.bytes) });
        outputs.push({
          kind: 'files',
          label: 'Exact bytes',
          files: [{ name: 'decompressed.bin', mime: 'application/octet-stream', content: result.bytes }],
        });
      }

      outputs.push({
        kind: 'keyvalue',
        label: 'Container',
        pairs: [
          ['Container', `${result.container}${result.detected ? ' (detected)' : ' (chosen)'}`],
          ['Compressed bytes', String(result.compressedBytes)],
          ['Decompressed bytes', String(result.bytes.length)],
          ...result.checks.map((c): [string, string] => ['Check', c]),
          ...(result.zlibHeader
            ? ([
                ['Window bits', String(result.zlibHeader.windowBits)],
                ['Compression level hint', result.zlibHeader.levelHint],
              ] as [string, string][])
            : []),
        ],
      });

      if (result.members.length > 0) {
        const shownMembers = result.members.slice(0, 20);
        outputs.push({
          kind: 'table',
          label: 'gzip members',
          table: {
            headers: ['Member', 'Modified', 'OS', 'Name', 'Comment', 'Extra (bytes)', 'Size'],
            rows: shownMembers.map((m, i) => [
              i + 1,
              formatMtime(m.mtime),
              m.osName,
              m.name ?? '',
              m.comment ?? '',
              m.extra ? m.extra.length : 0,
              m.size,
            ]),
          },
        });
        if (result.members.length > 20) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: `${result.members.length - 20} more member(s) not shown.`,
          });
        }
      }

      return {
        outputs,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
        stats: [
          ['Input bytes', String(result.compressedBytes)],
          ['Output bytes', String(result.bytes.length)],
          ['Ratio', ratioText(result.compressedBytes, result.bytes.length)],
        ],
      };
    } catch (err) {
      if (err instanceof GzipDeflateError) {
        return {
          outputs: [],
          errors: [{ message: err.message, column: err.position === undefined ? undefined : err.position + 1 }],
        };
      }
      throw err;
    }
  },
});
