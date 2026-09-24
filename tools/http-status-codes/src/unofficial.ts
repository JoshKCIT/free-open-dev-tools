/**
 * Widely used unofficial HTTP status codes, not in the IANA registry (D-33).
 * Included only because each origin was fetched this session; if a source
 * cannot be fetched, its codes are dropped and the omission is recorded in
 * the plan SUMMARY rather than transcribed from memory.
 *
 * nginx 444 and 499: https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_request.h
 * (fetched 2026-09-24, `#define NGX_HTTP_CLOSE 444` and
 * `#define NGX_HTTP_CLIENT_CLOSED_REQUEST 499`, with their preceding comments).
 *
 * Cloudflare 520-526: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/
 * (fetched 2026-09-24).
 */

export interface UnofficialStatusEntry {
  code: number;
  description: string;
  label: string;
  origin: string;
  sourceUrl: string;
}

export const UNOFFICIAL_CODES: UnofficialStatusEntry[] = [
  {
    code: 444,
    description: 'No Response',
    label: 'Unofficial (nginx)',
    origin:
      'nginx source comment: "The special code to close connection without any response" (NGX_HTTP_CLOSE, src/http/ngx_http_request.h)',
    sourceUrl: 'https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_request.h',
  },
  {
    code: 499,
    description: 'Client Closed Request',
    label: 'Unofficial (nginx)',
    origin:
      'nginx source comment: "HTTP does not define the code for the case when a client closed the connection while we are processing its request so we introduce own code" (NGX_HTTP_CLIENT_CLOSED_REQUEST, src/http/ngx_http_request.h)',
    sourceUrl: 'https://raw.githubusercontent.com/nginx/nginx/master/src/http/ngx_http_request.h',
  },
  {
    code: 520,
    description: 'Web Server Returns an Unknown Error',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 520: web server returns an unknown error"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 521,
    description: 'Web Server Is Down',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 521: web server is down"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 522,
    description: 'Connection Timed Out',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 522: connection timed out"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 523,
    description: 'Origin Is Unreachable',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 523: origin is unreachable"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 524,
    description: 'A Timeout Occurred',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 524: a timeout occurred"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 525,
    description: 'SSL Handshake Failed',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 525: SSL handshake failed"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
  {
    code: 526,
    description: 'Invalid SSL Certificate',
    label: 'Unofficial (Cloudflare)',
    origin: 'Cloudflare 5xx error reference, "Error 526: invalid SSL certificate"',
    sourceUrl: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/',
  },
];
