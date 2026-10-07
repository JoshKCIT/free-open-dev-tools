import {
  MAX_SHOWN_LINES,
  SamlDecoderError,
  decodeSaml,
  meta,
  parseDateTime,
  visible,
  type SamlReport,
} from '@fodt/saml-decoder';
import { defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: the messages are the ones the OASIS SAML 2.0 Bindings document prints in
// its sections 3.4.8 and 3.5.8 and the Technical Overview Committee Draft 02 prints in its section 5.1.2, and hosts are the
// names those documents use.
const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';
const NOTE_FIRST =
  'Nothing is verified: no signature, certificate or metadata is checked, and nothing is fetched. This page only undoes the wrapping and reads the XML as written.';
const SHOWN_CELL = 200;

// The redirect address of OASIS SAML 2.0 Bindings section 3.4.8 (document lines 723 to 733), joined into one line. Its
// Signature value is the document's own placeholder, not a signature. The marker on the string line keeps the secret
// scan from reading the Base64 as a key.
const EXAMPLE_REDIRECT =
  'https://ServiceProvider.com/SAML/SLO/Browser?SAMLRequest=fVFdS8MwFH0f7D%2BUvGdNsq62oSsIQyhMESc%2B%2BJYlmRbWpObeyvz3puv2IMjyFM7HPedyK1DdsZdb%2F%2BEHfLFfgwVMTt3RgTwzazIEJ72CFqRTnQWJWu7uH7dSLJjsg0ev%2FZFMlttiBWADtt6R%2BSyJr9msiRH7O70sCm31Mj%2Bo%2BC%2B1KA5GlEWeZaogSQMw2MYBKodrIhjLKONU8FdeSsZkVr6T5M0GiHMjvWCknqZXZ2OoPxF7kGnaGOuwxZ%2Fn4L9bY8NC%2By4du1XpRXnxPcXizSZ58KFTeHujEWkNPZylsh9bAMYYUjO2Uiy3jCpTCMo5M1StVjmN9SO150sl9lU6RV2Dp0vsLIy7NM7YU82r9B90PrvCf85W%2FwL8zSVQzAEAAA%3D%3D&RelayState=0043bfc1bc45110dae17004005b13a2b&SigAlg=http%3A%2F%2Fwww.w3.org%2F200%2F09%2Fxmldsig%23rsa-sha1&Signature=NOTAREALSIGNATUREBUTTHEREALONEWOULDGOHERE'; // gitleaks:allow

// The hidden form control of OASIS SAML 2.0 Bindings section 3.5.8 (document lines 956 to 971), with the value wrapped at 64
// columns as printed.
const EXAMPLE_FORM = [
  '<form action="https://IdentityProvider.com/SAML/SLO/Response" method="post">',
  '<input type="hidden" name="RelayState" value="0043bfc1bc45110dae17004005b13a2b"/>',
  '<input type="hidden" name="SAMLResponse" value="PHNhbWxwOkxvZ291dFJlc3BvbnNlIHhtbG5zOnNhbWxwPSJ1cm46b2FzaXM6bmFt',
  'ZXM6dGM6U0FNTDoyLjA6cHJvdG9jb2wiIHhtbG5zPSJ1cm46b2FzaXM6bmFtZXM6',
  'dGM6U0FNTDoyLjA6YXNzZXJ0aW9uIg0KICAgIElEPSJiMDczMGQyMWI2MjgxMTBk',
  'OGI3ZTAwNDAwNWIxM2EyYiIgSW5SZXNwb25zZVRvPSJkMmI3YzM4OGNlYzM2ZmE3',
  'YzM5YzI4ZmQyOTg2NDRhOCINCiAgICBJc3N1ZUluc3RhbnQ9IjIwMDQtMDEtMjFU',
  'MTk6MDA6NDlaIiBWZXJzaW9uPSIyLjAiPg0KICAgIDxJc3N1ZXI+aHR0cHM6Ly9T',
  'ZXJ2aWNlUHJvdmlkZXIuY29tL1NBTUw8L0lzc3Vlcj4NCiAgICA8c2FtbHA6U3Rh',
  'dHVzPg0KICAgICAgICA8c2FtbHA6U3RhdHVzQ29kZSBWYWx1ZT0idXJuOm9hc2lz',
  'Om5hbWVzOnRjOlNBTUw6Mi4wOnN0YXR1czpTdWNjZXNzIi8+DQogICAgPC9zYW1s',
  'cDpTdGF0dXM+DQo8L3NhbWxwOkxvZ291dFJlc3BvbnNlPg=="/>',
  '</form>',
].join('\n'); // gitleaks:allow

// The Response of the SAML V2.0 Technical Overview, Committee Draft 02, section 5.1.2 (document lines 875 to 927), with the
// signature left as the document's own placeholder.
const EXAMPLE_RESPONSE = [
  '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
  '  ID="identifier_2" InResponseTo="identifier_1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"',
  '  Destination="https://sp.example.com/SAML2/SSO/POST">',
  '  <saml:Issuer>https://idp.example.org/SAML2</saml:Issuer>',
  '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
  '  <saml:Assertion ID="identifier_3" Version="2.0" IssueInstant="2004-12-05T09:22:05Z">',
  '    <saml:Issuer>https://idp.example.org/SAML2</saml:Issuer>',
  '    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">...</ds:Signature>',
  '    <saml:Subject>',
  '      <saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">3f7b3dcf-1674-4ecd-92c8-1544f346baf8</saml:NameID>',
  '      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">',
  '        <saml:SubjectConfirmationData InResponseTo="identifier_1" Recipient="https://sp.example.com/SAML2/SSO/POST" NotOnOrAfter="2004-12-05T09:27:05Z"/>',
  '      </saml:SubjectConfirmation>',
  '    </saml:Subject>',
  '    <saml:Conditions NotBefore="2004-12-05T09:17:05Z" NotOnOrAfter="2004-12-05T09:27:05Z">',
  '      <saml:AudienceRestriction><saml:Audience>https://sp.example.com/SAML2</saml:Audience></saml:AudienceRestriction>',
  '    </saml:Conditions>',
  '    <saml:AuthnStatement AuthnInstant="2004-12-05T09:22:00Z" SessionIndex="identifier_3">',
  '      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>',
  '    </saml:AuthnStatement>',
  '  </saml:Assertion>',
  '</samlp:Response>',
].join('\n');

const TIME_REFUSAL =
  'The time must be written as an ISO 8601 date and time, like 2004-12-05T09:22:30Z (UTC), or left empty to use this device clock.';

/** The time the message is judged against: the time typed, or this device's clock read once. */
function readNow(values: Values): number | null {
  const typed = str(values, 'now').trim();
  if (typed === '') return new Date().getTime();
  const parsed = parseDateTime(typed);
  return parsed === null ? null : parsed.ms;
}

function blocksFor(report: SamlReport): OutputBlock[] {
  const outputs: OutputBlock[] = [
    { kind: 'note', tone: 'info', value: NOTE_FIRST },
    { kind: 'note', tone: 'info', value: `Recognised: ${report.binding}. ${report.steps.join(' ')}` },
    { kind: 'keyvalue', label: 'Summary', pairs: report.summary.pairs },
  ];
  if (report.summary.times.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Times',
      table: {
        headers: ['Field', 'Value', 'UTC', 'Status'],
        rows: report.summary.times.map((row) => [row.field, row.value, row.utc, row.status]),
        mono: [1, 2],
      },
    });
  }
  if (report.summary.attributes.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Attributes',
      table: {
        headers: ['Assertion', 'Name', 'NameFormat', 'FriendlyName', 'Value', 'Type'],
        rows: report.summary.attributes.map((row) => [
          row.assertion,
          row.name,
          row.nameFormat,
          row.friendlyName,
          row.value,
          row.type,
        ]),
        mono: [1, 4],
      },
    });
    if (report.summary.attributesOmitted > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `${report.summary.attributesOmitted.toLocaleString('en-US')} more attribute rows are left out of the table.`,
      });
    }
  }
  if (report.signatures.rows.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Signatures (present, not verified)',
      table: { headers: report.signatures.headers, rows: report.signatures.rows, mono: [3] },
    });
    if (report.signatures.omitted > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `${report.signatures.omitted.toLocaleString('en-US')} more signature rows are left out of the table.`,
      });
    }
  }
  const worth = [...report.warnings, ...report.notes];
  if (worth.length > 0) outputs.push({ kind: 'list', label: 'Worth a look', items: worth });
  outputs.push({ kind: 'code', label: 'Formatted XML', language: 'xml', value: report.formatted.text });
  if (report.formatted.omitted > 0) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `${report.formatted.omitted.toLocaleString('en-US')} more lines are not shown: the formatted XML is cut at ${MAX_SHOWN_LINES.toLocaleString('en-US')} lines.`,
    });
  }
  const transport = report.transport;
  if (transport?.signedString !== undefined) {
    outputs.push({ kind: 'code', label: 'Signed string as the binding defines it', value: transport.signedString });
  }
  if (
    transport !== undefined &&
    (transport.relayState !== undefined || transport.sigAlg !== undefined || transport.signaturePresent)
  ) {
    const pairs: [string, string][] = [];
    if (transport.relayState !== undefined) pairs.push(['RelayState', visible(transport.relayState, SHOWN_CELL)]);
    if (transport.sigAlg !== undefined) pairs.push(['SigAlg', visible(transport.sigAlg, SHOWN_CELL)]);
    if (transport.sigAlgNote !== undefined) pairs.push(['SigAlg means', transport.sigAlgNote]);
    if (transport.signatureLength !== undefined) pairs.push(['Signature', transport.signatureLength]);
    outputs.push({ kind: 'keyvalue', label: 'Parameters next to the message', pairs });
  }
  if (report.signatures.certificatePem !== undefined) {
    outputs.push({
      kind: 'code',
      label: 'Embedded certificate (PEM, not read here)',
      value: report.signatures.certificatePem,
    });
  }
  return outputs;
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
      help: 'A redirect address or its query string (SAMLRequest or SAMLResponse), an HTML form or a Base64 value from a form post, or raw XML.',
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
    {
      label: 'OASIS Bindings 2.0 section 3.5.8: a logout response in a form post, the value wrapped at 64 columns',
      values: { message: EXAMPLE_FORM, now: '2004-01-21T19:05:00Z' },
    },
    {
      label: 'SAML V2.0 Technical Overview CD 02 section 5.1.2: a Response with a signed assertion, as raw XML',
      values: { message: EXAMPLE_RESPONSE, now: '2004-12-05T09:22:30Z' },
    },
  ],
  run(values: Values): ToolResult {
    const message = str(values, 'message');
    if (message.trim() === '') return { outputs: [] };
    const now = readNow(values);
    if (now === null) return { outputs: [], errors: [{ message: TIME_REFUSAL }] };
    try {
      return { outputs: blocksFor(decodeSaml(message, { now })) };
    } catch (err) {
      if (err instanceof SamlDecoderError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      return { outputs: [], errors: [{ message: 'This message could not be read here.' }] };
    }
  },
});
