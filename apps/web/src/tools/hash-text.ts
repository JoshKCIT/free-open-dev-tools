import {
  meta,
  hashAll,
  decodeInput,
  digestsMatch,
  ALGORITHMS,
  format,
  checksumBytes,
  checksumRows,
  type InputEncoding,
  type OutputFormat,
} from '@fodt/hash-text';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const SECURITY_LABEL: Record<string, string> = {
  broken: 'Broken — do not use for security',
  legacy: 'Legacy',
  ok: 'Suitable',
  checksum: 'Checksum only, not a hash',
};

/** The "Input" statistic, as the digests view shows it; the new views share it. */
function inputStats(bytes: Uint8Array, encoding: InputEncoding, input: string): [string, string][] {
  return [
    ['Input', `${bytes.length} byte${bytes.length === 1 ? '' : 's'}`],
    ...(encoding === 'utf8' && bytes.length !== input.length
      ? ([['Note', 'multi-byte characters present']] as [string, string][])
      : []),
  ];
}

/** The note shown above a table when a pasted value was compared with the values of the chosen view. */
function compareNote(names: string[]): OutputBlock {
  return names.length > 0
    ? { kind: 'note', tone: 'success', value: `That value matches ${names.join(' and ')} of this input.` }
    : {
        kind: 'note',
        tone: 'warn',
        value:
          'That value does not match any value shown for this input. Check the input encoding, and whether the original included a trailing newline.',
      };
}

export default defineTool({
  id: 'hash-text',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'input', label: 'Input', type: 'textarea', rows: 8, placeholder: 'Text to hash' },
    {
      name: 'family',
      label: 'What to compute',
      type: 'select',
      default: 'digests',
      help: 'Digests is the original list. The others add checksums and older functions.',
      options: [
        { value: 'digests', label: 'Digests (MD5, SHA, BLAKE, CRC32)' },
        { value: 'checksums', label: 'Checksums (CRC-16 and CRC-32 variants)' },
      ],
    },
    {
      name: 'encoding',
      label: 'Read the input as',
      type: 'radio',
      default: 'utf8',
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex bytes' },
        { value: 'base64', label: 'Base64' },
      ],
    },
    {
      name: 'output',
      label: 'Show digests as',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Lowercase hex' },
        { value: 'HEX', label: 'Uppercase hex' },
        { value: 'base64', label: 'Base64' },
        { value: 'base64url', label: 'Base64url' },
      ],
    },
    {
      name: 'expected',
      label: 'Compare against a digest (optional)',
      type: 'text',
      placeholder: 'Paste a digest to check it against the results above',
      mono: true,
    },
  ],
  examples: [
    { label: 'Empty string', values: { input: '' } },
    { label: 'abc', values: { input: 'abc' } },
    { label: 'Hex bytes', values: { input: '00 0f ff', encoding: 'hex' } },
    { label: 'Checksums of 123456789', values: { input: '123456789', family: 'checksums' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    const encoding = str(values, 'encoding', 'utf8') as InputEncoding;
    const output = str(values, 'output', 'hex') as OutputFormat;

    let bytes: Uint8Array;
    try {
      bytes = decodeInput(input, encoding);
    } catch (err) {
      return { outputs: [], errors: [{ message: err instanceof Error ? err.message : String(err) }] };
    }

    if (str(values, 'family', 'digests') === 'checksums') {
      const rows = checksumRows(bytes).map((row) => ({
        row,
        text: format(checksumBytes(row.value, row.width), output),
      }));
      const wanted = str(values, 'expected').trim();
      const outputs: OutputBlock[] = [];
      if (wanted) {
        outputs.push(compareNote(rows.filter((r) => digestsMatch(r.text, wanted)).map((r) => r.row.name)));
      }
      outputs.push({
        kind: 'table',
        label: 'Checksums',
        table: {
          headers: ['Name', 'Also known as', 'Width', 'Value', 'Decimal'],
          rows: rows.map((r) => [r.row.name, r.row.aliases.join(', '), r.row.width, r.text, String(r.row.value)]),
          mono: [3, 4],
        },
      });
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: 'Checksums detect accidental changes. They are not hashes and give no security.',
      });
      return { outputs, stats: inputStats(bytes, encoding, input) };
    }

    const results = hashAll(bytes, output);
    const expected = str(values, 'expected').trim();
    const matched = expected ? results.filter((r) => digestsMatch(r.digest, expected)) : [];

    const outputs: OutputBlock[] = [];

    if (expected) {
      outputs.push(
        matched.length > 0
          ? {
              kind: 'note',
              tone: 'success',
              value: `That digest matches ${matched.map((m) => m.label).join(' and ')} of this input.`,
            }
          : {
              kind: 'note',
              tone: 'warn',
              value:
                'That digest does not match any algorithm for this input. Check the input encoding, and whether the original included a trailing newline.',
            },
      );
    }

    outputs.push({
      kind: 'table',
      label: 'Digests',
      table: {
        headers: ['Algorithm', 'Bits', 'Suitability', 'Digest'],
        rows: results.map((r) => [r.label, r.bits, SECURITY_LABEL[r.security] ?? r.security, r.digest]),
        mono: [3],
      },
    });

    const broken = ALGORITHMS.filter((a) => a.security === 'broken');
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `${broken.map((b) => b.label).join(' and ')} are listed because you will meet them in existing systems. Practical collisions exist for both, so neither should be used for signatures, certificates or password storage.`,
    });

    return {
      outputs,
      stats: [
        ['Input', `${bytes.length} byte${bytes.length === 1 ? '' : 's'}`],
        ...(encoding === 'utf8' && bytes.length !== input.length
          ? ([['Note', 'multi-byte characters present']] as [string, string][])
          : []),
      ],
    };
  },
});
