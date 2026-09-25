import { meta, buildNginxConfig, PATTERNS, NginxConfigError, type NginxPattern } from '@fodt/nginx-config';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const PATTERN_OPTIONS: { value: NginxPattern; label: string }[] = [
  { value: 'static', label: 'Static site' },
  { value: 'spa', label: 'Single-page app' },
  { value: 'proxy', label: 'Reverse proxy' },
  { value: 'php', label: 'PHP through FastCGI' },
];

export default defineTool({
  id: 'nginx-config',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'pattern', label: 'Hosting pattern', type: 'select', default: 'static', options: PATTERN_OPTIONS },
    {
      name: 'serverNames',
      label: 'Server names (space separated)',
      type: 'text',
      default: 'example.com www.example.com',
      mono: true,
    },
    {
      name: 'root',
      label: 'Document root',
      type: 'text',
      mono: true,
      default: '/var/www/example.com',
      visible: (v) => str(v, 'pattern', 'static') !== 'proxy',
    },
    {
      name: 'upstream',
      label: 'Upstream URL',
      type: 'text',
      mono: true,
      default: 'http://127.0.0.1:3000',
      visible: (v) => str(v, 'pattern', 'static') === 'proxy',
    },
    {
      name: 'fastcgi',
      label: 'FastCGI target',
      type: 'text',
      mono: true,
      default: 'unix:/run/php/php-fpm.sock',
      visible: (v) => str(v, 'pattern', 'static') === 'php',
    },
    { name: 'https', label: 'HTTPS', type: 'checkbox', default: false },
    {
      name: 'certificate',
      label: 'Certificate path',
      type: 'text',
      mono: true,
      default: '/etc/ssl/example.com.crt',
      visible: (v) => bool(v, 'https', false),
    },
    {
      name: 'certificateKey',
      label: 'Certificate key path',
      type: 'text',
      mono: true,
      default: '/etc/ssl/example.com.key',
      visible: (v) => bool(v, 'https', false),
    },
    {
      name: 'canonicalHost',
      label: 'Canonical host',
      type: 'radio',
      default: 'keep',
      options: [
        { value: 'keep', label: 'Keep as typed' },
        { value: 'www', label: 'Always use www.' },
        { value: 'bare', label: 'Always drop www.' },
      ],
    },
    { name: 'gzip', label: 'Enable gzip compression', type: 'checkbox', default: false },
    { name: 'cacheAssets', label: 'Cache static assets', type: 'checkbox', default: false },
    { name: 'basicAuth', label: 'Password-protect with Basic authentication', type: 'checkbox', default: false },
    {
      name: 'realm',
      label: 'Realm',
      type: 'text',
      default: 'Restricted',
      visible: (v) => bool(v, 'basicAuth', false),
    },
    {
      name: 'userFile',
      label: 'Password file path (auth_basic_user_file)',
      type: 'text',
      mono: true,
      default: '/etc/nginx/.htpasswd',
      visible: (v) => bool(v, 'basicAuth', false),
    },
    { name: 'maxBodyMb', label: 'Max request body (MB, 0 to omit)', type: 'number', default: 0, min: 0 },
  ],
  examples: [
    { label: 'Static site over HTTPS', values: { https: true, canonicalHost: 'www' } },
    { label: 'Reverse proxy to a local app server', values: { pattern: 'proxy' } },
  ],
  run(values): ToolResult {
    try {
      const pattern = str(values, 'pattern', 'static') as NginxPattern;
      if (!PATTERNS.includes(pattern)) {
        return { outputs: [], errors: [{ message: `"${pattern}" is not a known hosting pattern.` }] };
      }
      const https = bool(values, 'https', false);
      const result = buildNginxConfig({
        pattern,
        serverNames: str(values, 'serverNames'),
        root: str(values, 'root'),
        upstream: str(values, 'upstream'),
        fastcgi: str(values, 'fastcgi'),
        https: https
          ? { certificate: str(values, 'certificate'), certificateKey: str(values, 'certificateKey') }
          : null,
        canonicalHost: str(values, 'canonicalHost', 'keep') as 'keep' | 'www' | 'bare',
        gzip: bool(values, 'gzip', false),
        cacheAssets: bool(values, 'cacheAssets', false),
        basicAuth: bool(values, 'basicAuth', false)
          ? { realm: str(values, 'realm', 'Restricted'), userFile: str(values, 'userFile') }
          : null,
        maxBodyMb: num(values, 'maxBodyMb', 0),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'nginx server block',
          language: 'nginx',
          value: result.text,
          download: 'site.conf',
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      outputs.push({
        kind: 'note',
        label: 'Testing',
        tone: 'info',
        value:
          'This server block cannot be tested here: this tool does not run nginx, so a module your build lacks, a clashing server block or a missing certificate only shows up on the real server.',
      });

      return { outputs };
    } catch (err) {
      if (err instanceof NginxConfigError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
