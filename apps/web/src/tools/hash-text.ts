import {
  meta,
  hashAll,
  decodeInput,
  digestsMatch,
  ALGORITHMS,
  format,
  checksumBytes,
  checksumRows,
  shake,
  md4,
  ntlm,
  SHAKE_MIN_BYTES,
  SHAKE_MAX_BYTES,
  type InputEncoding,
  type OutputFormat,
} from '@fodt/hash-text';
import { defineTool, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

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
        { value: 'checksums', label: 'Checksums (CRC-16, CRC-32 variants, Adler-32)' },
        { value: 'shake', label: 'SHAKE128 and SHAKE256' },
        { value: 'legacy', label: 'MD4 and NTLM' },
      ],
    },
    {
      name: 'shakeBytes',
      label: 'SHAKE output length in bytes',
      type: 'number',
      default: 32,
      min: SHAKE_MIN_BYTES,
      max: SHAKE_MAX_BYTES,
      step: 1,
      help: 'A whole number from 1 to 4096. 32 bytes is 256 bits.',
      visible: (values) => values.family === 'shake',
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
    { label: 'SHAKE128 of abc', values: { input: 'abc', family: 'shake', shakeBytes: 32 } },
    { label: 'MD4 and NTLM of password', values: { input: 'password', family: 'legacy' } },
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

    if (str(values, 'family', 'digests') === 'shake') {
      // The length field is read only here, where it is visible; in every other view a value left in it is ignored.
      const length = num(values, 'shakeBytes', 32);
      let short: Uint8Array;
      let long: Uint8Array;
      try {
        short = shake(bytes, 'shake128', length);
        long = shake(bytes, 'shake256', length);
      } catch (err) {
        return { outputs: [], errors: [{ message: err instanceof Error ? err.message : String(err) }] };
      }
      const rows = [
        { name: 'SHAKE128', text: format(short, output) },
        { name: 'SHAKE256', text: format(long, output) },
      ];
      const wanted = str(values, 'expected').trim();
      const outputs: OutputBlock[] = [];
      if (wanted) {
        outputs.push(compareNote(rows.filter((r) => digestsMatch(r.text, wanted)).map((r) => r.name)));
      }
      for (const r of rows) {
        outputs.push({
          kind: 'code',
          label: `${r.name} (${length} ${length === 1 ? 'byte' : 'bytes'})`,
          value: r.text,
        });
      }
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'SHAKE128 and SHAKE256 are extendable-output functions from FIPS 202: you choose the length, and a shorter output is the start of a longer one.',
      });
      return { outputs, stats: inputStats(bytes, encoding, input) };
    }

    if (str(values, 'family', 'digests') === 'legacy') {
      const rows: { name: string; text: string }[] = [{ name: 'MD4', text: format(md4(bytes), output) }];
      // NTLM is defined over the text of a password, as UTF-16LE, so it has nothing to say about bytes read from hex or Base64.
      if (encoding === 'utf8') rows.push({ name: 'NTLM', text: format(ntlm(input), output) });
      const wanted = str(values, 'expected').trim();
      const outputs: OutputBlock[] = [];
      if (wanted) {
        outputs.push(compareNote(rows.filter((r) => digestsMatch(r.text, wanted)).map((r) => r.name)));
      }
      outputs.push({
        kind: 'table',
        label: 'MD4 and NTLM',
        table: { headers: ['Algorithm', 'Digest'], rows: rows.map((r) => [r.name, r.text]), mono: [1] },
      });
      if (encoding !== 'utf8') {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: 'NTLM applies to text, so it is not shown when the input is read as hex or Base64.',
        });
      }
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value:
          'MD4 and NTLM are broken. They are offered only to match values that older systems already hold; do not use them for anything new or to store passwords.',
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
