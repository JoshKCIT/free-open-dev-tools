import {
  meta,
  wallClock,
  formatStrftime,
  formatLdml,
  formatIntl,
  parseMoment,
  DateFormatError,
} from '@fodt/date-format';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The IANA zones worth offering by default. Any IANA name typed elsewhere in this tool's own text is not accepted here -- this select only offers a fixed short list. */
const COMMON_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const STYLE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'full', label: 'Full' },
  { value: 'long', label: 'Long' },
  { value: 'medium', label: 'Medium' },
  { value: 'short', label: 'Short' },
];

export default defineTool({
  id: 'date-format',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'moment',
      label: 'Moment (needs an explicit Z or UTC offset)',
      type: 'text',
      mono: true,
      default: '1996-07-10T15:08:56-07:00',
      placeholder: '1996-07-10T15:08:56-07:00',
    },
    {
      name: 'zone',
      label: 'Zone to render in',
      type: 'select',
      default: 'America/Los_Angeles',
      options: COMMON_ZONES.map((z) => ({ value: z, label: z })),
    },
    {
      name: 'strftime',
      label: 'strftime pattern (POSIX/C locale)',
      type: 'text',
      mono: true,
      default: '%Y-%m-%d %H:%M:%S %z',
    },
    {
      name: 'ldml',
      label: 'Unicode LDML pattern (UTS #35)',
      type: 'text',
      mono: true,
      default: "yyyy.MM.dd G 'at' HH:mm:ss zzz",
    },
    {
      name: 'locale',
      label: 'Intl locale',
      type: 'select',
      default: 'en-US',
      options: [
        { value: 'en-US', label: 'en-US' },
        { value: 'en-GB', label: 'en-GB' },
        { value: 'de-DE', label: 'de-DE' },
        { value: 'fr-FR', label: 'fr-FR' },
        { value: 'ja-JP', label: 'ja-JP' },
      ],
    },
    { name: 'dateStyle', label: 'Intl date style', type: 'select', default: 'full', options: STYLE_OPTIONS },
    { name: 'timeStyle', label: 'Intl time style', type: 'select', default: 'medium', options: STYLE_OPTIONS },
  ],
  examples: [
    {
      label: 'RFC 5322-style with a strftime pattern',
      values: { moment: '1996-07-10T15:08:56-07:00', strftime: '%a, %d %b %Y %H:%M:%S %z' },
    },
  ],
  run(values): ToolResult {
    const momentInput = str(values, 'moment');
    if (!momentInput.trim()) return { outputs: [] };

    let moment: Date;
    try {
      moment = parseMoment(momentInput);
    } catch (err) {
      return { outputs: [], errors: [{ message: err instanceof Error ? err.message : String(err) }] };
    }

    const zone = str(values, 'zone', 'UTC');
    const wall = wallClock(moment, zone);

    const outputs: OutputBlock[] = [];

    const strftimePattern = str(values, 'strftime');
    if (strftimePattern) {
      try {
        outputs.push({
          kind: 'code',
          label: 'strftime (POSIX/C locale)',
          value: formatStrftime(strftimePattern, wall),
        });
      } catch (err) {
        return {
          outputs,
          errors: [{ message: err instanceof DateFormatError ? err.message : String(err) }],
        };
      }
    }

    const ldmlPattern = str(values, 'ldml');
    if (ldmlPattern) {
      try {
        outputs.push({ kind: 'code', label: 'LDML (Unicode UTS #35)', value: formatLdml(ldmlPattern, wall) });
      } catch (err) {
        return {
          outputs,
          errors: [{ message: err instanceof DateFormatError ? err.message : String(err) }],
        };
      }
    }

    const locale = str(values, 'locale', 'en-US');
    const dateStyle = str(values, 'dateStyle', 'full') as 'full' | 'long' | 'medium' | 'short' | 'none';
    const timeStyle = str(values, 'timeStyle', 'medium') as 'full' | 'long' | 'medium' | 'short' | 'none';
    outputs.push({
      kind: 'code',
      label: 'Intl.DateTimeFormat',
      value: formatIntl(moment, { locale, zone, dateStyle, timeStyle }),
    });

    return { outputs };
  },
});
