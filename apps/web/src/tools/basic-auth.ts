import { meta, buildHeader, parseHeader, buildChallenge, BasicAuthError } from '@fodt/basic-auth';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'basic-auth',
  docs: {
    about: meta.about,
    supports: meta.supports,
    limits: meta.limits,
    standards: meta.standards,
  },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'build',
      options: [
        { value: 'build', label: 'Build credentials' },
        { value: 'decode', label: 'Decode a header' },
        { value: 'challenge', label: 'Build a challenge' },
      ],
    },
    {
      name: 'userid',
      label: 'User identifier',
      type: 'text',
      placeholder: 'Aladdin',
      default: '',
      help: 'Cannot contain a colon — the first colon separates it from the password.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      placeholder: 'open sesame',
      default: '',
      help: 'Nothing leaves your browser. A password may contain colons.',
      visible: (v) => v.mode === 'build',
    },
    {
      name: 'headerValue',
      label: 'Authorization header value',
      type: 'text',
      mono: true,
      placeholder: 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      default: '',
      visible: (v) => v.mode === 'decode',
    },
    {
      name: 'realm',
      label: 'Realm',
      type: 'text',
      placeholder: 'WallyWorld',
      default: '',
      visible: (v) => v.mode === 'challenge',
    },
    {
      name: 'challengeCharset',
      label: 'Add charset="UTF-8"',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'challenge',
    },
  ],
  examples: [
    { label: 'RFC worked example', values: { mode: 'build', userid: 'Aladdin', password: 'open sesame' } },
    { label: 'Decode', values: { mode: 'decode', headerValue: 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==' } },
    { label: 'Challenge', values: { mode: 'challenge', realm: 'WallyWorld', challengeCharset: false } },
  ],
  run(values): ToolResult {
    if (values.mode === 'build') {
      const userid = str(values, 'userid');
      const password = str(values, 'password');
      if (!userid && !password) return { outputs: [] };
      try {
        const header = buildHeader({ userid, password });
        return {
          // No `download`: this output carries a real credential the visitor typed.
          outputs: [{ kind: 'code', label: 'Authorization header value', value: header }],
          stats: [['Encoded length', `${header.length} chars`]],
        };
      } catch (err) {
        if (err instanceof BasicAuthError) {
          return { outputs: [], errors: [{ message: err.message }] };
        }
        throw err;
      }
    }

    if (values.mode === 'decode') {
      const headerValue = str(values, 'headerValue');
      if (!headerValue.trim()) return { outputs: [] };
      try {
        const { userid, password } = parseHeader(headerValue);
        return {
          outputs: [
            {
              kind: 'keyvalue',
              label: 'Decoded credentials',
              pairs: [
                ['User identifier', userid],
                ['Password', password],
              ],
            },
          ],
        };
      } catch (err) {
        if (err instanceof BasicAuthError) {
          return {
            outputs: [],
            errors: [
              { message: err.message, line: 1, column: err.position === undefined ? undefined : err.position + 1 },
            ],
          };
        }
        throw err;
      }
    }

    const realm = str(values, 'realm');
    if (!realm) return { outputs: [] };
    try {
      const challenge = buildChallenge(realm, { charset: bool(values, 'challengeCharset', false) });
      return {
        // No `download` on any output block on this page (acceptance criteria): the
        // build and challenge modes are both credential-adjacent, and matching the
        // rule uniformly avoids a visitor treating one mode as "more sensitive"
        // than the other.
        outputs: [{ kind: 'code', label: 'WWW-Authenticate value', value: challenge }],
      };
    } catch (err) {
      if (err instanceof BasicAuthError) {
        return {
          outputs: [],
          errors: [
            { message: err.message, line: 1, column: err.position === undefined ? undefined : err.position + 1 },
          ],
        };
      }
      throw err;
    }
  },
});
