import {
  meta,
  generate,
  parse,
  NAMESPACES,
  IdentifierError,
  KSUID_EPOCH_SECONDS,
  NANOID_DEFAULT_SIZE,
  NANOID_URL_ALPHABET,
  SNOWFLAKE_DEFAULT_EPOCH,
  detectIdentifier,
  generateKsuids,
  generateNanoIds,
  generateObjectIds,
  generateSnowflakes,
  generateUlids,
  parseEpoch,
  truncatedUuidNote,
  type UuidVersion,
} from '@fodt/uuid';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// The five formats that are not UUID versions. They are values of the same `version` select, tested before the
// UUID versions are turned into a number, so every earlier value follows the path it always did.
const NEW_FORMATS = ['ulid', 'nanoid', 'ksuid', 'snowflake', 'objectid'] as const;
type NewFormat = (typeof NEW_FORMATS)[number];

function isNewFormat(value: unknown): value is NewFormat {
  return typeof value === 'string' && (NEW_FORMATS as readonly string[]).includes(value);
}

const DEFAULT_EPOCH_TEXT = String(SNOWFLAKE_DEFAULT_EPOCH);

const TIME_NOTE =
  'This id carries the time it was made, so anyone holding it can read roughly when. Use a NanoID or a version 4 UUID if that matters.';

const ULID_ORDER_NOTE =
  'ULIDs made together differ only in their last characters: each one made in the same millisecond counts up from the one before it.';

/** Generates one of the five formats. Reads only the fields that are visible for that format. */
function runNewFormat(format: NewFormat, values: Values): ToolResult {
  const count = Math.trunc(Math.min(Math.max(num(values, 'count', 5), 1), 10000));
  try {
    let ids: string[];
    let name: string;
    const stats: [string, string][] = [];
    const notes: OutputBlock[] = [];
    switch (format) {
      case 'ulid':
        ids = generateUlids(count);
        name = 'ULID';
        notes.push({ kind: 'note', tone: 'info', value: `${TIME_NOTE} ${ULID_ORDER_NOTE}` });
        break;
      case 'ksuid':
        ids = generateKsuids(count);
        name = 'KSUID';
        notes.push({ kind: 'note', tone: 'info', value: TIME_NOTE });
        break;
      case 'objectid':
        ids = generateObjectIds(count);
        name = 'ObjectId';
        notes.push({ kind: 'note', tone: 'info', value: TIME_NOTE });
        break;
      case 'snowflake': {
        const epoch = parseEpoch(str(values, 'epoch', DEFAULT_EPOCH_TEXT));
        ids = generateSnowflakes({
          count,
          epoch,
          datacenter: num(values, 'datacenter', 0),
          worker: num(values, 'worker', 0),
        });
        name = 'Snowflake ID';
        stats.push(['Epoch', `${new Date(epoch).toISOString()} (epoch ms ${epoch})`]);
        notes.push({ kind: 'note', tone: 'info', value: TIME_NOTE });
        break;
      }
      default:
        ids = generateNanoIds({
          count,
          size: num(values, 'size', NANOID_DEFAULT_SIZE),
          alphabet: str(values, 'alphabet', NANOID_URL_ALPHABET),
        });
        name = 'NanoID';
        break;
    }
    return {
      outputs: [
        {
          kind: 'code',
          label: `${count} ${name}${count === 1 ? '' : 's'}`,
          value: ids.join('\n'),
          download: 'ids.txt',
        },
        ...notes,
      ],
      stats: [
        ['Generated', String(count)],
        ['Source of randomness', format === 'snowflake' ? 'none, counted from the clock' : 'crypto.getRandomValues'],
        ...stats,
      ],
    };
  } catch (error) {
    if (error instanceof IdentifierError) return { outputs: [], errors: [{ message: error.message }] };
    return { outputs: [], errors: [{ message: 'Could not make the identifiers.' }] };
  }
}

/**
 * Names text that is not a UUID when it has the shape of a ULID, KSUID, MongoDB ObjectId or Snowflake ID. Returns null
 * when nothing fits, so the page keeps its earlier answer for text that is not an identifier at all.
 */
function inspectIdentifier(input: string, values: Values): ToolResult | null {
  let epochUsed = 0;
  try {
    const found = detectIdentifier(input, () => {
      epochUsed = parseEpoch(str(values, 'epoch', DEFAULT_EPOCH_TEXT));
      return epochUsed;
    });
    if (found === null) return null;
    const pairs: [string, string][] = [];
    const outputs: OutputBlock[] = [];
    switch (found.format) {
      case 'ulid':
        pairs.push(
          ['Format', 'ULID'],
          ['Time', `${found.ms} ms since 1970-01-01`],
          ['ISO time', found.iso],
          ['Random part', `${found.randomHex} (80 bits)`],
        );
        break;
      case 'ksuid':
        pairs.push(
          ['Format', 'KSUID'],
          ['Time', `${KSUID_EPOCH_SECONDS + found.timestamp} s since 1970-01-01`],
          ['ISO time', found.iso],
          ['Stored timestamp', `${found.timestamp} s since 2014-05-13T16:53:20Z`],
          ['Payload', `${found.payloadHex} (128 bits)`],
        );
        break;
      case 'objectid':
        pairs.push(
          ['Format', 'MongoDB ObjectId'],
          ['Time', `${found.timestamp} s since 1970-01-01`],
          ['ISO time', found.iso],
          ['Random value', `${found.randomHex} (5 bytes)`],
          ['Counter', String(found.counter)],
        );
        break;
      default:
        pairs.push(
          ['Format', 'Snowflake ID'],
          ['Time', `${found.ms} ms since 1970-01-01`],
          ['ISO time', found.iso],
          ['Epoch used', `${new Date(epochUsed).toISOString()} (epoch ms ${epochUsed})`],
          ['Datacenter', String(found.datacenter)],
          ['Worker', String(found.worker)],
          ['Sequence', String(found.sequence)],
        );
        outputs.push({
          kind: 'note',
          tone: 'info',
          value:
            'Any whole number of up to 19 digits reads as a Snowflake ID. The time shown is right only if the epoch field holds the epoch that made the id.',
        });
        break;
    }
    // A UUID missing its last digits has a ULID, KSUID or ObjectId shape: the decode stays and a warning is added.
    const truncated = truncatedUuidNote(input);
    if (truncated !== null) outputs.push({ kind: 'note', tone: 'warn', value: truncated });
    return { outputs: [{ kind: 'keyvalue', label: 'Fields', pairs }, ...outputs] };
  } catch (error) {
    if (error instanceof IdentifierError) return { outputs: [], errors: [{ message: error.message }] };
    return { outputs: [], errors: [{ message: 'Could not read this identifier.' }] };
  }
}

export default defineTool({
  id: 'uuid',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'generate',
      options: [
        { value: 'generate', label: 'Generate' },
        { value: 'inspect', label: 'Inspect an existing UUID' },
      ],
    },
    {
      name: 'version',
      label: 'Version',
      type: 'select',
      default: '4',
      options: [
        { value: '4', label: 'v4 — random (the usual default)' },
        { value: '7', label: 'v7 — time-ordered, sorts by creation' },
        { value: '1', label: 'v1 — time-based, random node id' },
        { value: '5', label: 'v5 — deterministic from a name, SHA-1' },
        { value: '3', label: 'v3 — deterministic from a name, MD5 (legacy)' },
        { value: 'ulid', label: 'ULID — time-ordered, 26 characters' },
        { value: 'nanoid', label: 'NanoID — short and random, your size and alphabet' },
        { value: 'ksuid', label: 'KSUID — time-ordered, 27 characters' },
        { value: 'snowflake', label: 'Snowflake ID — 64-bit number with a time' },
        { value: 'objectid', label: 'MongoDB ObjectId — 24 hex digits with a time' },
      ],
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'count',
      label: 'How many',
      type: 'number',
      default: 5,
      min: 1,
      max: 10000,
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'namespace',
      label: 'Namespace',
      type: 'select',
      default: NAMESPACES.dns,
      options: [
        { value: NAMESPACES.dns, label: 'DNS' },
        { value: NAMESPACES.url, label: 'URL' },
        { value: NAMESPACES.oid, label: 'OID' },
        { value: NAMESPACES.x500, label: 'X.500' },
      ],
      visible: (v) => v.mode === 'generate' && (v.version === '3' || v.version === '5'),
    },
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      default: 'www.example.com',
      placeholder: 'The name to hash into a UUID',
      visible: (v) => v.mode === 'generate' && (v.version === '3' || v.version === '5'),
    },
    {
      name: 'uppercase',
      label: 'Uppercase',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'generate' && !isNewFormat(v.version),
    },
    {
      name: 'hyphens',
      label: 'Keep hyphens',
      type: 'checkbox',
      default: true,
      visible: (v) => v.mode === 'generate' && !isNewFormat(v.version),
    },
    {
      name: 'wrapper',
      label: 'Wrap as',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'Plain' },
        { value: 'braces', label: 'Braces {…}' },
        { value: 'urn', label: 'URN urn:uuid:…' },
      ],
      visible: (v) => v.mode === 'generate' && !isNewFormat(v.version),
    },
    {
      name: 'toInspect',
      label: 'UUID to inspect',
      type: 'text',
      mono: true,
      placeholder: '2ed6657d-e927-568b-95e1-2665a8aea6a2',
      help: 'A UUID, ULID, KSUID, MongoDB ObjectId or Snowflake ID.',
      visible: (v) => v.mode === 'inspect',
    },
    {
      name: 'size',
      label: 'Size',
      type: 'number',
      default: 21,
      min: 1,
      max: 255,
      help: 'Characters in each NanoID, from 1 to 255.',
      visible: (v) => v.mode === 'generate' && v.version === 'nanoid',
    },
    {
      name: 'alphabet',
      label: 'Alphabet',
      type: 'text',
      mono: true,
      default: NANOID_URL_ALPHABET,
      help: 'From 2 to 255 different characters, with no spaces, combining marks or invisible characters. The default is the 64 character URL-safe alphabet.',
      visible: (v) => v.mode === 'generate' && v.version === 'nanoid',
    },
    {
      name: 'epoch',
      label: 'Epoch',
      type: 'text',
      mono: true,
      default: DEFAULT_EPOCH_TEXT,
      help: 'Milliseconds since 1970-01-01, or an ISO date. Type 0 for the Unix epoch. The default is the reference epoch of the published layout, 2010-11-04T01:42:54.657Z.',
      visible: (v) => v.mode === 'inspect' || (v.mode === 'generate' && v.version === 'snowflake'),
    },
    {
      name: 'datacenter',
      label: 'Datacenter',
      type: 'number',
      default: 0,
      min: 0,
      max: 31,
      help: 'The 5 datacenter bits of each Snowflake ID, from 0 to 31.',
      visible: (v) => v.mode === 'generate' && v.version === 'snowflake',
    },
    {
      name: 'worker',
      label: 'Worker',
      type: 'number',
      default: 0,
      min: 0,
      max: 31,
      help: 'The 5 worker bits of each Snowflake ID, from 0 to 31.',
      visible: (v) => v.mode === 'generate' && v.version === 'snowflake',
    },
  ],
  examples: [
    { label: 'Ten v7', values: { mode: 'generate', version: '7', count: 10 } },
    { label: 'Deterministic v5', values: { mode: 'generate', version: '5', name: 'www.example.com' } },
    { label: 'Inspect', values: { mode: 'inspect', toInspect: '2ed6657d-e927-568b-95e1-2665a8aea6a2' } },
    { label: 'Five ULIDs', values: { mode: 'generate', version: 'ulid', count: 5 } },
    { label: 'Inspect a ULID', values: { mode: 'inspect', toInspect: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } },
  ],
  run(values): ToolResult {
    if (values.mode === 'inspect') {
      const input = str(values, 'toInspect');
      if (!input.trim()) return { outputs: [] };
      const parsed = parse(input);
      if (!parsed.valid) {
        // Not a UUID: try the other identifier shapes, and keep the earlier answer when none fits.
        const identifier = inspectIdentifier(input, values);
        if (identifier) return identifier;
        return { outputs: [], errors: parsed.problems.map((message) => ({ message })) };
      }
      const pairs: [string, string][] = [
        ['Canonical', parsed.canonical],
        ['Version', parsed.isNil ? 'nil UUID' : parsed.isMax ? 'max UUID' : String(parsed.version)],
        ['Variant', parsed.variant],
        ['Hex', parsed.hex],
        ['URN', parsed.urn],
        ['Base64url', parsed.base64url],
      ];
      if (parsed.timestamp) {
        pairs.push(['Created', `${parsed.timestamp.iso} (epoch ms ${parsed.timestamp.ms})`]);
      }
      if (parsed.clockSequence !== undefined) pairs.push(['Clock sequence', String(parsed.clockSequence)]);
      if (parsed.node) {
        pairs.push([
          'Node id',
          `${parsed.node}${parsed.nodeIsRandom ? ' (random, not a MAC address)' : ' (looks like a real MAC address)'}`,
        ]);
      }

      const outputs: OutputBlock[] = [{ kind: 'keyvalue', label: 'Fields', pairs }];
      for (const p of parsed.problems) outputs.push({ kind: 'note', tone: 'warn', value: p });
      if (parsed.version === 1 && parsed.nodeIsRandom === false) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value:
            'The node identifier has the multicast bit clear, which suggests a real network card address is embedded in this id.',
        });
      }
      return { outputs };
    }

    const format = str(values, 'version', '4');
    if (isNewFormat(format)) return runNewFormat(format, values);

    const version = Number(format) as UuidVersion;
    const count = Math.min(Math.max(num(values, 'count', 5), 1), 10000);
    const wrapper = str(values, 'wrapper', 'none');

    const ids = generate({
      version,
      count,
      namespace: str(values, 'namespace', NAMESPACES.dns),
      name: str(values, 'name'),
      uppercase: bool(values, 'uppercase'),
      hyphens: bool(values, 'hyphens', true),
      braces: wrapper === 'braces',
      urn: wrapper === 'urn',
    });

    const outputs: OutputBlock[] = [
      { kind: 'code', label: `${count} UUID${count === 1 ? '' : 's'}`, value: ids.join('\n'), download: 'uuids.txt' },
    ];

    if (version === 3) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value:
          'Version 3 uses MD5, which is cryptographically broken. It exists for compatibility with systems that already use it. Choose version 5 for anything new.',
      });
    }
    if (version === 1 || version === 7) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This version embeds the time it was created, so anyone holding the id can read roughly when it was made. Use version 4 if that matters.',
      });
    }
    if (version === 3 || version === 5) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This version is deterministic: the same namespace and name always produce the same id, which is the point of it.',
      });
    }

    return {
      outputs,
      stats: [
        ['Generated', String(count)],
        ['Source of randomness', version === 3 || version === 5 ? 'none, deterministic' : 'crypto.getRandomValues'],
      ],
    };
  },
});
