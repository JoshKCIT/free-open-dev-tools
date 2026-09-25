import { it, expect, vi } from 'vitest';
import { buildSecurityHeaders, SecurityHeadersError, UnsafeValueError } from '../src/index';
import { renderApache } from '../src/target-apache';
import { renderNginx, NginxDollarSignError } from '../src/target-nginx';

it('CSP Level 3 directives and source expressions are serialised as the specification grammar requires', () => {
  const result = buildSecurityHeaders({
    csp: "default-src 'self'\nimg-src 'self' data: https://cdn.example.invalid",
  });
  const csp = result.headers.find((h) => h.name === 'Content-Security-Policy');
  expect(csp?.value).toBe("default-src 'self'; img-src 'self' data: https://cdn.example.invalid");
  expect(result.warnings.some((w) => /object-src/.test(w))).toBe(true);
  expect(result.warnings.some((w) => /base-uri/.test(w))).toBe(true);

  // Every kind of source expression the fetched ABNF defines.
  const r2 = buildSecurityHeaders({
    csp: "default-src 'self' https: example.com *.example.org:8443/path 'nonce-abc123ABC+/==' 'sha256-abcdEFGH12+/='",
  });
  const csp2 = r2.headers.find((h) => h.name === 'Content-Security-Policy');
  expect(csp2?.value).toContain("'self'");
  expect(csp2?.value).toContain('https:');
  expect(csp2?.value).toContain('example.com');
  expect(csp2?.value).toContain('*.example.org:8443/path');
  expect(csp2?.value).toContain("'nonce-abc123ABC+/=='");
  expect(csp2?.value).toContain("'sha256-abcdEFGH12+/='");
  expect(r2.warnings.filter((w) => w.startsWith('Content-Security-Policy line'))).toEqual([]);
});

it('a source list that mixes none with another source, an unknown directive or an unquoted keyword is reported with its line', () => {
  const result = buildSecurityHeaders({
    csp: "script-src 'none' 'self'\nplugin-types application/x-shockwave-flash\nstyle-src self",
  });
  expect(result.warnings.some((w) => w.startsWith('Content-Security-Policy line 1:') && /'none'/.test(w))).toBe(true);
  expect(
    result.warnings.some((w) => w.startsWith('Content-Security-Policy line 2:') && /not a directive/.test(w)),
  ).toBe(true);
  expect(
    result.warnings.some((w) => w.startsWith('Content-Security-Policy line 3:') && /no surrounding quotes/.test(w)),
  ).toBe(true);
});

it('HSTS max-age and includeSubDomains follow RFC 6797 and preload is refused without both', () => {
  const ok = buildSecurityHeaders({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } });
  const hsts = ok.headers.find((h) => h.name === 'Strict-Transport-Security');
  expect(hsts?.value).toBe('max-age=31536000; includeSubDomains; preload');
  expect(ok.warnings.some((w) => /insecure transport/.test(w))).toBe(true);

  expect(() => buildSecurityHeaders({ hsts: { maxAge: 31536000, includeSubDomains: false, preload: true } })).toThrow(
    SecurityHeadersError,
  );
  expect(() => buildSecurityHeaders({ hsts: { maxAge: 100, includeSubDomains: true, preload: true } })).toThrow(
    SecurityHeadersError,
  );
  expect(() => buildSecurityHeaders({ hsts: { maxAge: -1, includeSubDomains: true, preload: false } })).toThrow(
    SecurityHeadersError,
  );
  expect(() => buildSecurityHeaders({ hsts: { maxAge: 1.5, includeSubDomains: true, preload: false } })).toThrow(
    SecurityHeadersError,
  );

  const noSub = buildSecurityHeaders({ hsts: { maxAge: 604800, includeSubDomains: false, preload: false } });
  expect(noSub.headers.find((h) => h.name === 'Strict-Transport-Security')?.value).toBe('max-age=604800');
});

it('Referrer-Policy, X-Content-Type-Options, COOP, COEP and CORP accept only the tokens their specifications define', () => {
  const r = buildSecurityHeaders({
    referrerPolicy: 'strict-origin-when-cross-origin',
    nosniff: true,
    coop: 'same-origin',
    coep: 'require-corp',
    corp: 'same-origin',
  });
  expect(r.headers).toEqual(
    expect.arrayContaining([
      { name: 'X-Content-Type-Options', value: 'nosniff' },
      { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { name: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ]),
  );

  expect(() => buildSecurityHeaders({ referrerPolicy: 'nope' })).toThrow(SecurityHeadersError);
  expect(() => buildSecurityHeaders({ coop: 'nope' })).toThrow(SecurityHeadersError);
  expect(() => buildSecurityHeaders({ coep: 'nope' })).toThrow(SecurityHeadersError);
  expect(() => buildSecurityHeaders({ corp: 'nope' })).toThrow(SecurityHeadersError);
});

it('Permissions-Policy is written as an RFC 9651 structured field dictionary with quoted origins', () => {
  const r = buildSecurityHeaders({
    permissions: 'geolocation=(self "https://example.invalid")\ncamera=()\nmicrophone=*',
  });
  const pp = r.headers.find((h) => h.name === 'Permissions-Policy');
  expect(pp?.value).toBe('geolocation=(self "https://example.invalid"), camera=(), microphone=*');

  expect(() => buildSecurityHeaders({ permissions: 'geolocation=(self "not a url")' })).toThrow(SecurityHeadersError);
  expect(() => buildSecurityHeaders({ permissions: 'geolocation=(self "https://example.invalid/path")' })).toThrow(
    SecurityHeadersError,
  );

  const unknown = buildSecurityHeaders({ permissions: 'made-up-feature=(self)' });
  expect(unknown.warnings.some((w) => /made-up-feature/.test(w))).toBe(true);
});

it('Apache, nginx, Netlify and generic output carry the same header values', () => {
  const r = buildSecurityHeaders({ nosniff: true, referrerPolicy: 'no-referrer', path: '/*' });
  expect(r.headers.length).toBeGreaterThan(0);
  for (const h of r.headers) {
    expect(r.apache).toContain(`Header always set ${h.name} "${h.value}"`);
    expect(r.nginx).toContain(`add_header ${h.name} "${h.value}" always;`);
    expect(r.netlify).toContain(`  ${h.name}: ${h.value}`);
    expect(r.generic).toContain(`${h.name}: ${h.value}`);
  }
  expect(r.netlify.split('\n')[0]).toBe('/*');
});

it('a value with a line break is refused before any target is written', () => {
  expect(() => buildSecurityHeaders({ permissions: 'geolocation\u0000=(self)' })).toThrow(UnsafeValueError);
  try {
    buildSecurityHeaders({ permissions: 'geolocation\u0000=(self)' });
    expect.fail('should have thrown UnsafeValueError');
  } catch (err) {
    expect(err).toBeInstanceOf(UnsafeValueError);
    const message = (err as UnsafeValueError).message;
    expect(message).not.toMatch(/IfModule|add_header|_headers/);
  }
});

it('a double quote or backslash is escaped for Apache and nginx, a percent sign is doubled for Apache and a dollar sign is refused for nginx', () => {
  const headers = [{ name: 'X-Test', value: 'a "quoted" \\ 100% value' }];
  const apache = renderApache(headers);
  expect(apache).toContain('Header always set X-Test "a \\"quoted\\" \\\\ 100%% value"');

  const nginx = renderNginx(headers);
  expect(nginx).toContain('add_header X-Test "a \\"quoted\\" \\\\ 100% value" always;');

  expect(() => renderNginx([{ name: 'X-Test', value: 'has a $dollar' }])).toThrow(NginxDollarSignError);
});

it('nothing is written to the console while building headers', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    buildSecurityHeaders({
      csp: "default-src 'self'\nplugin-types x",
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      referrerPolicy: 'no-referrer',
      nosniff: true,
      permissions: 'geolocation=(self "https://example.invalid")',
      coop: 'same-origin',
      coep: 'require-corp',
      corp: 'same-origin',
    });
    try {
      buildSecurityHeaders({ hsts: { maxAge: -1, includeSubDomains: true, preload: false } });
    } catch {
      /* the refusal is expected; the point is console silence */
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
});
