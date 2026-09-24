/**
 * Generated snapshot of the IANA HTTP Status Code Registry. Never hand-edited.
 *
 * Source: https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv
 * Registry's own last-updated date (http-status-codes.xml <updated>): 2025-09-15
 * Fetched: 2026-09-24
 */

export interface StatusReference {
  label: string;
  url: string;
}

export type StatusRegistrationStatus = 'registered' | 'temporary' | 'unused';

export interface StatusEntry {
  code: number;
  description: string;
  references: StatusReference[];
  status: StatusRegistrationStatus;
}

export interface UnassignedRange {
  start: number;
  end: number;
}

export const STATUS_CODES: StatusEntry[] = [
  {
    code: 100,
    description: 'Continue',
    references: [{ label: 'RFC 9110 section 15.2.1', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.2.1' }],
    status: 'registered',
  },
  {
    code: 101,
    description: 'Switching Protocols',
    references: [{ label: 'RFC 9110 section 15.2.2', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.2.2' }],
    status: 'registered',
  },
  {
    code: 102,
    description: 'Processing',
    references: [{ label: 'RFC 2518', url: 'https://www.rfc-editor.org/rfc/rfc2518' }],
    status: 'registered',
  },
  {
    code: 103,
    description: 'Early Hints',
    references: [{ label: 'RFC 8297', url: 'https://www.rfc-editor.org/rfc/rfc8297' }],
    status: 'registered',
  },
  {
    code: 104,
    description:
      'Upload Resumption Supported (TEMPORARY - registered 2024-11-13, extension registered 2025-09-15, expires 2026-11-13)',
    references: [
      {
        label: 'draft-ietf-httpbis-resumable-upload-05',
        url: 'https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-05',
      },
    ],
    status: 'temporary',
  },
  {
    code: 200,
    description: 'OK',
    references: [{ label: 'RFC 9110 section 15.3.1', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.1' }],
    status: 'registered',
  },
  {
    code: 201,
    description: 'Created',
    references: [{ label: 'RFC 9110 section 15.3.2', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.2' }],
    status: 'registered',
  },
  {
    code: 202,
    description: 'Accepted',
    references: [{ label: 'RFC 9110 section 15.3.3', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.3' }],
    status: 'registered',
  },
  {
    code: 203,
    description: 'Non-Authoritative Information',
    references: [{ label: 'RFC 9110 section 15.3.4', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.4' }],
    status: 'registered',
  },
  {
    code: 204,
    description: 'No Content',
    references: [{ label: 'RFC 9110 section 15.3.5', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.5' }],
    status: 'registered',
  },
  {
    code: 205,
    description: 'Reset Content',
    references: [{ label: 'RFC 9110 section 15.3.6', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.6' }],
    status: 'registered',
  },
  {
    code: 206,
    description: 'Partial Content',
    references: [{ label: 'RFC 9110 section 15.3.7', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.3.7' }],
    status: 'registered',
  },
  {
    code: 207,
    description: 'Multi-Status',
    references: [{ label: 'RFC 4918', url: 'https://www.rfc-editor.org/rfc/rfc4918' }],
    status: 'registered',
  },
  {
    code: 208,
    description: 'Already Reported',
    references: [{ label: 'RFC 5842', url: 'https://www.rfc-editor.org/rfc/rfc5842' }],
    status: 'registered',
  },
  {
    code: 226,
    description: 'IM Used',
    references: [{ label: 'RFC 3229', url: 'https://www.rfc-editor.org/rfc/rfc3229' }],
    status: 'registered',
  },
  {
    code: 300,
    description: 'Multiple Choices',
    references: [{ label: 'RFC 9110 section 15.4.1', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.1' }],
    status: 'registered',
  },
  {
    code: 301,
    description: 'Moved Permanently',
    references: [{ label: 'RFC 9110 section 15.4.2', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.2' }],
    status: 'registered',
  },
  {
    code: 302,
    description: 'Found',
    references: [{ label: 'RFC 9110 section 15.4.3', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.3' }],
    status: 'registered',
  },
  {
    code: 303,
    description: 'See Other',
    references: [{ label: 'RFC 9110 section 15.4.4', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.4' }],
    status: 'registered',
  },
  {
    code: 304,
    description: 'Not Modified',
    references: [{ label: 'RFC 9110 section 15.4.5', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.5' }],
    status: 'registered',
  },
  {
    code: 305,
    description: 'Use Proxy',
    references: [{ label: 'RFC 9110 section 15.4.6', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.6' }],
    status: 'registered',
  },
  {
    code: 306,
    description: '(Unused)',
    references: [{ label: 'RFC 9110 section 15.4.7', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.7' }],
    status: 'unused',
  },
  {
    code: 307,
    description: 'Temporary Redirect',
    references: [{ label: 'RFC 9110 section 15.4.8', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.8' }],
    status: 'registered',
  },
  {
    code: 308,
    description: 'Permanent Redirect',
    references: [{ label: 'RFC 9110 section 15.4.9', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.4.9' }],
    status: 'registered',
  },
  {
    code: 400,
    description: 'Bad Request',
    references: [{ label: 'RFC 9110 section 15.5.1', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.1' }],
    status: 'registered',
  },
  {
    code: 401,
    description: 'Unauthorized',
    references: [{ label: 'RFC 9110 section 15.5.2', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.2' }],
    status: 'registered',
  },
  {
    code: 402,
    description: 'Payment Required',
    references: [{ label: 'RFC 9110 section 15.5.3', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.3' }],
    status: 'registered',
  },
  {
    code: 403,
    description: 'Forbidden',
    references: [{ label: 'RFC 9110 section 15.5.4', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.4' }],
    status: 'registered',
  },
  {
    code: 404,
    description: 'Not Found',
    references: [{ label: 'RFC 9110 section 15.5.5', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5' }],
    status: 'registered',
  },
  {
    code: 405,
    description: 'Method Not Allowed',
    references: [{ label: 'RFC 9110 section 15.5.6', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.6' }],
    status: 'registered',
  },
  {
    code: 406,
    description: 'Not Acceptable',
    references: [{ label: 'RFC 9110 section 15.5.7', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.7' }],
    status: 'registered',
  },
  {
    code: 407,
    description: 'Proxy Authentication Required',
    references: [{ label: 'RFC 9110 section 15.5.8', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.8' }],
    status: 'registered',
  },
  {
    code: 408,
    description: 'Request Timeout',
    references: [{ label: 'RFC 9110 section 15.5.9', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.9' }],
    status: 'registered',
  },
  {
    code: 409,
    description: 'Conflict',
    references: [{ label: 'RFC 9110 section 15.5.10', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10' }],
    status: 'registered',
  },
  {
    code: 410,
    description: 'Gone',
    references: [{ label: 'RFC 9110 section 15.5.11', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.11' }],
    status: 'registered',
  },
  {
    code: 411,
    description: 'Length Required',
    references: [{ label: 'RFC 9110 section 15.5.12', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.12' }],
    status: 'registered',
  },
  {
    code: 412,
    description: 'Precondition Failed',
    references: [{ label: 'RFC 9110 section 15.5.13', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.13' }],
    status: 'registered',
  },
  {
    code: 413,
    description: 'Content Too Large',
    references: [{ label: 'RFC 9110 section 15.5.14', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.14' }],
    status: 'registered',
  },
  {
    code: 414,
    description: 'URI Too Long',
    references: [{ label: 'RFC 9110 section 15.5.15', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.15' }],
    status: 'registered',
  },
  {
    code: 415,
    description: 'Unsupported Media Type',
    references: [{ label: 'RFC 9110 section 15.5.16', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.16' }],
    status: 'registered',
  },
  {
    code: 416,
    description: 'Range Not Satisfiable',
    references: [{ label: 'RFC 9110 section 15.5.17', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.17' }],
    status: 'registered',
  },
  {
    code: 417,
    description: 'Expectation Failed',
    references: [{ label: 'RFC 9110 section 15.5.18', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.18' }],
    status: 'registered',
  },
  {
    code: 418,
    description: '(Unused)',
    references: [{ label: 'RFC 9110 section 15.5.19', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.19' }],
    status: 'unused',
  },
  {
    code: 421,
    description: 'Misdirected Request',
    references: [{ label: 'RFC 9110 section 15.5.20', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.20' }],
    status: 'registered',
  },
  {
    code: 422,
    description: 'Unprocessable Content',
    references: [{ label: 'RFC 9110 section 15.5.21', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.21' }],
    status: 'registered',
  },
  {
    code: 423,
    description: 'Locked',
    references: [{ label: 'RFC 4918', url: 'https://www.rfc-editor.org/rfc/rfc4918' }],
    status: 'registered',
  },
  {
    code: 424,
    description: 'Failed Dependency',
    references: [{ label: 'RFC 4918', url: 'https://www.rfc-editor.org/rfc/rfc4918' }],
    status: 'registered',
  },
  {
    code: 425,
    description: 'Too Early',
    references: [{ label: 'RFC 8470', url: 'https://www.rfc-editor.org/rfc/rfc8470' }],
    status: 'registered',
  },
  {
    code: 426,
    description: 'Upgrade Required',
    references: [{ label: 'RFC 9110 section 15.5.22', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.5.22' }],
    status: 'registered',
  },
  {
    code: 428,
    description: 'Precondition Required',
    references: [{ label: 'RFC 6585', url: 'https://www.rfc-editor.org/rfc/rfc6585' }],
    status: 'registered',
  },
  {
    code: 429,
    description: 'Too Many Requests',
    references: [{ label: 'RFC 6585', url: 'https://www.rfc-editor.org/rfc/rfc6585' }],
    status: 'registered',
  },
  {
    code: 431,
    description: 'Request Header Fields Too Large',
    references: [{ label: 'RFC 6585', url: 'https://www.rfc-editor.org/rfc/rfc6585' }],
    status: 'registered',
  },
  {
    code: 451,
    description: 'Unavailable For Legal Reasons',
    references: [{ label: 'RFC 7725', url: 'https://www.rfc-editor.org/rfc/rfc7725' }],
    status: 'registered',
  },
  {
    code: 500,
    description: 'Internal Server Error',
    references: [{ label: 'RFC 9110 section 15.6.1', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.1' }],
    status: 'registered',
  },
  {
    code: 501,
    description: 'Not Implemented',
    references: [{ label: 'RFC 9110 section 15.6.2', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.2' }],
    status: 'registered',
  },
  {
    code: 502,
    description: 'Bad Gateway',
    references: [{ label: 'RFC 9110 section 15.6.3', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.3' }],
    status: 'registered',
  },
  {
    code: 503,
    description: 'Service Unavailable',
    references: [{ label: 'RFC 9110 section 15.6.4', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4' }],
    status: 'registered',
  },
  {
    code: 504,
    description: 'Gateway Timeout',
    references: [{ label: 'RFC 9110 section 15.6.5', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.5' }],
    status: 'registered',
  },
  {
    code: 505,
    description: 'HTTP Version Not Supported',
    references: [{ label: 'RFC 9110 section 15.6.6', url: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.6' }],
    status: 'registered',
  },
  {
    code: 506,
    description: 'Variant Also Negotiates',
    references: [{ label: 'RFC 2295', url: 'https://www.rfc-editor.org/rfc/rfc2295' }],
    status: 'registered',
  },
  {
    code: 507,
    description: 'Insufficient Storage',
    references: [{ label: 'RFC 4918', url: 'https://www.rfc-editor.org/rfc/rfc4918' }],
    status: 'registered',
  },
  {
    code: 508,
    description: 'Loop Detected',
    references: [{ label: 'RFC 5842', url: 'https://www.rfc-editor.org/rfc/rfc5842' }],
    status: 'registered',
  },
  {
    code: 510,
    description: 'Not Extended (OBSOLETED)',
    references: [{ label: 'RFC 2774', url: 'https://www.rfc-editor.org/rfc/rfc2774' }],
    status: 'registered',
  },
  {
    code: 511,
    description: 'Network Authentication Required',
    references: [{ label: 'RFC 6585', url: 'https://www.rfc-editor.org/rfc/rfc6585' }],
    status: 'registered',
  },
];

export const UNASSIGNED_RANGES: UnassignedRange[] = [
  { start: 105, end: 199 },
  { start: 209, end: 225 },
  { start: 227, end: 299 },
  { start: 309, end: 399 },
  { start: 419, end: 420 },
  { start: 427, end: 427 },
  { start: 430, end: 430 },
  { start: 432, end: 450 },
  { start: 452, end: 499 },
  { start: 509, end: 509 },
  { start: 512, end: 599 },
];

export interface RegistrySnapshot {
  sourceUrl: string;
  registryUpdated: string;
  fetched: string;
}

export const REGISTRY_SNAPSHOT: RegistrySnapshot = {
  sourceUrl: 'https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml',
  registryUpdated: '2025-09-15',
  fetched: '2026-09-24',
};
