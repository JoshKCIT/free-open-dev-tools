import { meta, buildHtaccess, HTPASSWD_COST, HtaccessError } from '@fodt/htaccess-generator';
import { htpasswdInWorker } from '../lib/run-htaccess-in-worker';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/**
 * A test-only affordance, exposing `htpasswdInWorker` directly so the
 * browser test suite can call it with a shorter time limit or an
 * already-aborted signal. No real user interaction can reach either path
 * directly: `ToolRunner` always hands `run()` a freshly constructed,
 * non-aborted `AbortController`, and a real visitor cannot dial down the
 * fixed 60-second limit. Same pattern `apps/web/src/tools/bcrypt.ts` uses
 * for the same reason. Unconditionally assigned, and a real visitor never
 * reads or calls it.
 */
declare global {
  interface Window {
    __FODT_HTACCESS_TEST_HOOKS__?: { htpasswdInWorker: typeof htpasswdInWorker };
  }
}
if (typeof window !== 'undefined') {
  window.__FODT_HTACCESS_TEST_HOOKS__ = { htpasswdInWorker };
}

const DEFAULT_CACHE_RULES = 'image/png 1 year\nimage/jpeg 1 year\ntext/css 1 month\napplication/javascript 1 month';

export default defineTool({
  id: 'htaccess-generator',
  // A .htpasswd line hashes with bcrypt (a salted, random-looking output,
  // D-10) at a cost that can be slow (D-14), so this page waits for a
  // deliberate Run press and offers Cancel, like the bcrypt page itself.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'forceHttps', label: 'Force HTTPS', type: 'checkbox', default: false },
    { name: 'noIndexes', label: 'Turn off directory listings', type: 'checkbox', default: true },
    {
      name: 'host',
      label: 'Canonical host',
      type: 'radio',
      default: 'keep',
      options: [
        { value: 'keep', label: 'Keep as typed' },
        { value: 'www', label: 'Always use www.' },
        { value: 'bare', label: 'Always drop www.' },
      ],
    },
    {
      name: 'domain',
      label: 'Domain',
      type: 'text',
      placeholder: 'example.com',
      default: '',
      visible: (v) => str(v, 'host', 'keep') !== 'keep',
    },
    {
      name: 'redirects',
      label: 'Redirects (one per line)',
      type: 'textarea',
      rows: 3,
      mono: true,
      placeholder: '/old-page.html /new-page/ 301',
      default: '',
    },
    { name: 'caching', label: 'Cache static assets', type: 'checkbox', default: false },
    {
      name: 'cacheRules',
      label: 'Cache rules (one "type/subtype interval" per line)',
      type: 'textarea',
      rows: 4,
      mono: true,
      default: DEFAULT_CACHE_RULES,
      visible: (v) => bool(v, 'caching', false),
    },
    {
      name: 'protection',
      label: 'Directory protection',
      type: 'radio',
      default: 'none',
      options: [
        { value: 'none', label: 'No password' },
        { value: 'basic', label: 'Password-protect with Basic authentication' },
      ],
    },
    {
      name: 'realm',
      label: 'Realm',
      type: 'text',
      default: 'Restricted',
      visible: (v) => str(v, 'protection', 'none') === 'basic',
    },
    {
      name: 'userFile',
      label: 'Password file path (AuthUserFile)',
      type: 'text',
      mono: true,
      default: '/etc/apache2/.htpasswd',
      visible: (v) => str(v, 'protection', 'none') === 'basic',
    },
    {
      name: 'username',
      label: 'Username',
      type: 'text',
      default: '',
      visible: (v) => str(v, 'protection', 'none') === 'basic',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      default: '',
      help: 'Used only to make the hash in your browser. Never shown back or sent.',
      visible: (v) => str(v, 'protection', 'none') === 'basic',
    },
    {
      name: 'cost',
      label: 'Hash cost factor',
      type: 'range',
      default: HTPASSWD_COST.default,
      min: HTPASSWD_COST.min,
      max: HTPASSWD_COST.max,
      step: 1,
      help: `${HTPASSWD_COST.min} (fastest) to ${HTPASSWD_COST.max} (slowest, and strongest).`,
      visible: (v) => str(v, 'protection', 'none') === 'basic',
    },
  ],
  examples: [
    {
      label: 'Force HTTPS and www, turn off directory listings',
      values: { forceHttps: true, host: 'www', domain: 'example.com' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const protection = str(values, 'protection', 'none');
    const username = str(values, 'username');
    const password = str(values, 'password');

    let result;
    try {
      result = buildHtaccess({
        forceHttps: bool(values, 'forceHttps', false),
        host: str(values, 'host', 'keep') as 'keep' | 'www' | 'bare',
        domain: str(values, 'domain'),
        redirects: str(values, 'redirects'),
        noIndexes: bool(values, 'noIndexes', true),
        cacheRules: bool(values, 'caching', false) ? str(values, 'cacheRules') : '',
        protect: protection === 'basic',
        realm: str(values, 'realm', 'Restricted'),
        userFile: str(values, 'userFile'),
      });
    } catch (err) {
      if (err instanceof HtaccessError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }

    const outputs: OutputBlock[] = [
      { kind: 'code', label: '.htaccess', language: 'apache', value: result.text, download: '.htaccess' },
    ];
    const warnings = [...result.warnings];

    if (protection === 'basic' && username && password) {
      const cost = Math.round(Number(values.cost ?? HTPASSWD_COST.default));
      let htpasswd;
      try {
        htpasswd = await htpasswdInWorker({ user: username, password, cost }, ctx);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        // Not only a package error: a native worker failure or the time
        // limit crosses the worker boundary as a plain Error with its own
        // descriptive fixed message (run-htaccess-in-worker.ts), which is
        // exactly as useful as a package error's -- checked against Error,
        // not a narrower class, for the same reason bcrypt.ts's page
        // checks it (found and fixed there after writing that page's own
        // native-failure scenarios).
        return {
          outputs,
          errors: [{ message: err instanceof Error ? err.message : 'Could not make the .htpasswd line.' }],
        };
      }
      outputs.push({
        kind: 'code',
        label: '.htpasswd line',
        value: htpasswd.line,
        download: '.htpasswd',
      });
      warnings.push(...htpasswd.warnings);
    }

    if (warnings.length > 0) {
      outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: warnings.join('\n') });
    }
    outputs.push({
      kind: 'note',
      label: 'Testing',
      tone: 'info',
      value:
        'This configuration, and any .htpasswd line above, must still be tested on the target server: this tool does not run Apache, so it cannot tell whether your host enables the modules these rules need.',
    });

    return { outputs, stats: [['Sections', String(result.sections.length)]] };
  },
});
