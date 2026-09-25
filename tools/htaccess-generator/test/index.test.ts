import { it, expect, vi } from 'vitest';
import { buildHtaccess, HtaccessError } from '../src/index';
import { htpasswdLine } from '../src/htpasswd';

it('forcing HTTPS and choosing the www or bare host produce the RewriteCond and RewriteRule lines the Apache 2.4 mod_rewrite documentation gives', () => {
  // mod_rewrite.html, "Server Variables": "HTTPS ... Will contain the text
  // 'on' if the connection is using SSL/TLS, or 'off' otherwise."
  const https = buildHtaccess({ forceHttps: true });
  expect(https.text).toContain('RewriteEngine On');
  expect(https.text).toContain('RewriteCond %{HTTPS} off');
  // rewrite/flags.html, "R|redirect": a redirect may carry a status via
  // "[R=305]"; "L|last": "[L] flag causes mod_rewrite to stop processing
  // the rule set."
  expect(https.text).toContain('RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]');

  // rewrite/remapping.html, "Canonical Hostnames" recipe; rewrite/flags.html,
  // "NC|nocase": "Use of the [NC] flag causes the RewriteRule to be matched
  // in a case-insensitive manner."
  const www = buildHtaccess({ host: 'www', domain: 'example.com' });
  expect(www.text).toContain('RewriteCond %{HTTP_HOST} !^www\\.example\\.com$ [NC]');
  expect(www.text).toContain('RewriteRule ^ https://www.example.com%{REQUEST_URI} [R=301,L]');

  const bare = buildHtaccess({ host: 'bare', domain: 'example.com' });
  expect(bare.text).toContain('RewriteCond %{HTTP_HOST} !^example\\.com$ [NC]');
  expect(bare.text).toContain('RewriteRule ^ https://example.com%{REQUEST_URI} [R=301,L]');

  expect(() => buildHtaccess({ host: 'www' })).toThrow(HtaccessError);
  expect(() => buildHtaccess({ host: 'www', domain: 'not a host!' })).toThrow(HtaccessError);

  expect(buildHtaccess({ forceHttps: false, host: 'keep' }).text).toBe('');
});

it('path redirects become anchored RewriteRule patterns with regex characters escaped and the chosen status code', () => {
  const result = buildHtaccess({ redirects: '/old page.html /new/ 301' });
  // rewrite/flags.html, "R|redirect": "[R=305]... a 302 status code being
  // used by default if none is specified." This tool always writes an
  // explicit status; here the visitor asked for 301.
  expect(result.text).toContain('RewriteRule ^old\\ page\\.html$ /new/ [R=301,L]');

  const defaulted = buildHtaccess({ redirects: '/a /b' });
  expect(defaulted.text).toContain('RewriteRule ^a$ /b [R=301,L]');

  const withStatus = buildHtaccess({ redirects: '/a /b 302' });
  expect(withStatus.text).toContain('[R=302,L]');

  // A multi-word old path (rare, but a real URL-decoded path can carry a
  // literal space) with an explicit target and status: everything before
  // the target is the old path, rejoined with single spaces.
  const multiWordOld = buildHtaccess({ redirects: '/a b c /target 303' });
  expect(multiWordOld.text).toContain('RewriteRule ^a\\ b\\ c$ /target [R=303,L]');

  expect(() => buildHtaccess({ redirects: 'no-leading-slash /b' })).toThrow(HtaccessError);
  expect(() => buildHtaccess({ redirects: '/a' })).toThrow(HtaccessError);
});

it('caching rules use ExpiresActive and ExpiresByType with the mod_expires interval syntax', () => {
  // mod_expires.html: "Example: # enable expirations\nExpiresActive On";
  // "Alternate Interval Syntax": ExpiresByType text/html "access plus 1
  // month 15 days 2 hours" is the documented form this tool builds from a
  // visitor's own "num type" text.
  const result = buildHtaccess({ cacheRules: 'image/png 1 year\ntext/css 1 month' });
  expect(result.text).toContain('ExpiresActive On');
  expect(result.text).toContain('ExpiresByType image/png "access plus 1 year"');
  expect(result.text).toContain('ExpiresByType text/css "access plus 1 month"');

  expect(() => buildHtaccess({ cacheRules: 'not-a-mime-type' })).toThrow(HtaccessError);
  expect(() => buildHtaccess({ cacheRules: 'image/png' })).toThrow(HtaccessError);
});

it('directory protection writes AuthType Basic, AuthName, AuthUserFile and Require valid-user as mod_auth_basic and mod_authn_file document', () => {
  // mod_auth_basic.html example: "AuthType basic \n AuthName \"private
  // area\""; mod_authn_file.html: "Syntax: AuthUserFile file-path"; the
  // same page: "If it is not absolute, it is treated as relative to the
  // ServerRoot."; mod_authz_core.html: "Require valid-user \n All valid
  // users can access the resource."
  const result = buildHtaccess({
    protect: true,
    realm: 'Restricted Area',
    userFile: '/etc/apache2/.htpasswd',
  });
  expect(result.text).toContain('AuthType Basic');
  expect(result.text).toContain('AuthName "Restricted Area"');
  expect(result.text).toContain('AuthUserFile /etc/apache2/.htpasswd');
  expect(result.text).toContain('Require valid-user');
  expect(result.warnings).toEqual([]);

  const relative = buildHtaccess({ protect: true, realm: 'R', userFile: '.htpasswd' });
  expect(relative.warnings.some((w) => /ServerRoot/.test(w))).toBe(true);

  const quoted = buildHtaccess({ protect: true, realm: 'Say "hi" \\ ok', userFile: '/x' });
  expect(quoted.text).toContain('AuthName "Say \\"hi\\" \\\\ ok"');
});

it('Options minus Indexes turns off directory listings as the core documentation describes', () => {
  // core.html, "Indexes": "Allow use of the directives controlling
  // directory indexing"; the standard way to disable it entirely is
  // "Options -Indexes", documented throughout core.html's Options section.
  const result = buildHtaccess({ noIndexes: true });
  expect(result.text).toContain('Options -Indexes');
  expect(result.sections).toContain('Turn off directory listings');

  expect(buildHtaccess({ noIndexes: false }).text).not.toContain('Options -Indexes');
});

it('a colon or line break in a user name and a line break in any other value are refused', async () => {
  // The colon is this tool's own rule (HtaccessError); a line break is the
  // canonical single-line guard's rule (UnsafeValueError, AA) -- both are
  // "refused", which is all this test's title promises.
  await expect(htpasswdLine('al:ice', 'a password', 5)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('al\nice', 'a password', 5)).rejects.toThrow(/line break|control character/);
  await expect(htpasswdLine('alice', 'a password', 5)).resolves.toBeDefined();

  expect(() => buildHtaccess({ host: 'www', domain: 'example.com\nnewline' })).toThrow(/line break|control character/);
  expect(() => buildHtaccess({ protect: true, realm: 'r\nx', userFile: '/x' })).toThrow(/line break|control character/);
  expect(() => buildHtaccess({ protect: true, realm: 'r', userFile: '/x\ny' })).toThrow(/line break|control character/);
});

it('nothing is written to the console while building rules or hashing', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  buildHtaccess({
    forceHttps: true,
    host: 'www',
    domain: 'example.com',
    redirects: '/old /new 301',
    noIndexes: true,
    cacheRules: 'image/png 1 year',
    protect: true,
    realm: 'R',
    userFile: '/x',
  });
  await htpasswdLine('alice', 'correct horse battery staple', 4);

  expect(logSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();

  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});
