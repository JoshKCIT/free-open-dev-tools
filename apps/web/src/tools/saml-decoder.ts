import { SamlDecoderError, decodeSaml, meta, parseDateTime } from '@fodt/saml-decoder';
import { defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: the messages are the ones the OASIS SAML 2.0 Bindings document prints in
// its section 3.4.8, and hosts are the names that document uses.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_FIRST =
  'Nothing is verified: no signature, certificate or metadata is checked, and nothing is fetched. This page only undoes the wrapping and reads the XML as written.';

// The redirect address of OASIS SAML 2.0 Bindings section 3.4.8 (document lines 723 to 733), joined into one line. Its
// Signature value is the document's own placeholder, not a signature. The marker on the string line keeps the secret
// scan from reading the Base64 as a key.
const EXAMPLE_REDIRECT =
  'https://ServiceProvider.com/SAML/SLO/Browser?SAMLRequest=fVFdS8MwFH0f7D%2BUvGdNsq62oSsIQyhMESc%2B%2BJYlmRbWpObeyvz3puv2IMjyFM7HPedyK1DdsZdb%2F%2BEHfLFfgwVMTt3RgTwzazIEJ72CFqRTnQWJWu7uH7dSLJjsg0ev%2FZFMlttiBWADtt6R%2BSyJr9msiRH7O70sCm31Mj%2Bo%2BC%2B1KA5GlEWeZaogSQMw2MYBKodrIhjLKONU8FdeSsZkVr6T5M0GiHMjvWCknqZXZ2OoPxF7kGnaGOuwxZ%2Fn4L9bY8NC%2By4du1XpRXnxPcXizSZ58KFTeHujEWkNPZylsh9bAMYYUjO2Uiy3jCpTCMo5M1StVjmN9SO150sl9lU6RV2Dp0vsLIy7NM7YU82r9B90PrvCf85W%2FwL8zSVQzAEAAA%3D%3D&RelayState=0043bfc1bc45110dae17004005b13a2b&SigAlg=http%3A%2F%2Fwww.w3.org%2F200%2F09%2Fxmldsig%23rsa-sha1&Signature=NOTAREALSIGNATUREBUTTHEREALONEWOULDGOHERE'; // gitleaks:allow

const TIME_REFUSAL =
  'The time must be written as an ISO 8601 date and time, like 2004-12-05T09:22:30Z (UTC), or left empty to use this device clock.';

/** The time the message is judged against: the time typed, or this device's clock read once. */
function readNow(values: Values): number | null {
  const typed = str(values, 'now').trim();
  if (typed === '') return new Date().getTime();
  const parsed = parseDateTime(typed);
  return parsed === null ? null : parsed.ms;
}

export default defineTool({
  id: 'saml-decoder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'message',
      label: 'SAML message',
      type: 'textarea',
      rows: 10,
      placeholder: PASTE_PLACEHOLDER,
      help: 'A redirect address or its query string (SAMLRequest or SAMLResponse), or raw XML.',
      wide: true,
    },
    {
      name: 'now',
      label: 'Time to judge the message against (UTC)',
      type: 'text',
      placeholder: '2004-12-05T09:22:30Z',
      help: 'Optional. Leave it empty to use this device clock, read once for each run. No clock skew is allowed.',
    },
  ],
  examples: [
    {
      label: 'OASIS Bindings 2.0 section 3.4.8: a logout request in a redirect address',
      values: { message: EXAMPLE_REDIRECT, now: '2004-01-21T19:05:00Z' },
    },
  ],
  run(values: Values): ToolResult {
    const message = str(values, 'message');
    if (message.trim() === '') return { outputs: [] };
    const now = readNow(values);
    if (now === null) return { outputs: [], errors: [{ message: TIME_REFUSAL }] };
    try {
      const report = decodeSaml(message, { now });
      const outputs: OutputBlock[] = [
        { kind: 'note', tone: 'info', value: NOTE_FIRST },
        {
          kind: 'note',
          tone: 'info',
          value: `Recognised: ${report.binding}. ${report.steps.join(' ')}`,
        },
        { kind: 'keyvalue', label: 'Summary', pairs: report.summary.pairs },
      ];
      if (report.warnings.length > 0) {
        outputs.push({ kind: 'list', label: 'Worth a look', items: report.warnings });
      }
      return { outputs };
    } catch (err) {
      if (err instanceof SamlDecoderError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return { outputs: [], errors: [{ message: 'This message could not be read here.' }] };
    }
  },
});
