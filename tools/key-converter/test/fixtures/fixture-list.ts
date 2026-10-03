import type { KeyModel } from '../../src/model';
import * as fx from './keys';

/** Shared by the test files of the key converter: the fixture keys as a list, and small helpers. */

export const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
export const bytesOf = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'));

/** PEM text with the armour assembled from pieces, so no whole armour line is ever written in this file. */
export function armour(label: string, body: string, width = 64, headers: string[] = []): string {
  const lines = body.match(new RegExp(`.{1,${width}}`, 'g')) ?? [];
  const head = headers.length > 0 ? headers.join('\n') + '\n\n' : '';
  return '-----' + 'BEGIN ' + label + '-----\n' + head + lines.join('\n') + '\n-----' + 'END ' + label + '-----\n';
}

export interface Fixture {
  name: string;
  kind: 'rsa' | 'ec' | 'ed25519';
  pkcs8: string;
  spki: string;
  pkcs1Private?: string;
  pkcs1Public?: string;
  sec1?: string;
  sec1NoPublic?: string;
  pkcs8NoPublic?: string;
  openssh: string;
  check: string;
  yLine: string;
  publicLine: string;
  rfc4716: string;
  sha256: string;
  md5: string;
}

export const FIXTURES: Fixture[] = [
  {
    name: 'RSA 2048',
    kind: 'rsa',
    pkcs8: fx.RSA2048_PKCS8_DER_B64,
    spki: fx.RSA2048_SPKI_DER_B64,
    pkcs1Private: fx.RSA2048_PKCS1_PRIVATE_DER_B64,
    pkcs1Public: fx.RSA2048_PKCS1_PUBLIC_DER_B64,
    openssh: fx.RSA2048_OPENSSH_FILE_B64,
    check: fx.RSA2048_OPENSSH_CHECK_HEX,
    yLine: fx.RSA2048_SSH_Y_LINE,
    publicLine: fx.RSA2048_SSH_PUBLIC_LINE,
    rfc4716: fx.RSA2048_RFC4716_TEXT,
    sha256: fx.RSA2048_SSH_SHA256,
    md5: fx.RSA2048_SSH_MD5,
  },
  {
    name: 'RSA 3072',
    kind: 'rsa',
    pkcs8: fx.RSA3072_PKCS8_DER_B64,
    spki: fx.RSA3072_SPKI_DER_B64,
    pkcs1Private: fx.RSA3072_PKCS1_PRIVATE_DER_B64,
    pkcs1Public: fx.RSA3072_PKCS1_PUBLIC_DER_B64,
    openssh: fx.RSA3072_OPENSSH_FILE_B64,
    check: fx.RSA3072_OPENSSH_CHECK_HEX,
    yLine: fx.RSA3072_SSH_Y_LINE,
    publicLine: fx.RSA3072_SSH_PUBLIC_LINE,
    rfc4716: fx.RSA3072_RFC4716_TEXT,
    sha256: fx.RSA3072_SSH_SHA256,
    md5: fx.RSA3072_SSH_MD5,
  },
  {
    name: 'P-256',
    kind: 'ec',
    pkcs8: fx.P256_PKCS8_DER_B64,
    spki: fx.P256_SPKI_DER_B64,
    sec1: fx.P256_SEC1_DER_B64,
    sec1NoPublic: fx.P256_SEC1_NO_PUBLIC_DER_B64,
    pkcs8NoPublic: fx.P256_PKCS8_NO_PUBLIC_DER_B64,
    openssh: fx.P256_OPENSSH_FILE_B64,
    check: fx.P256_OPENSSH_CHECK_HEX,
    yLine: fx.P256_SSH_Y_LINE,
    publicLine: fx.P256_SSH_PUBLIC_LINE,
    rfc4716: fx.P256_RFC4716_TEXT,
    sha256: fx.P256_SSH_SHA256,
    md5: fx.P256_SSH_MD5,
  },
  {
    name: 'P-384',
    kind: 'ec',
    pkcs8: fx.P384_PKCS8_DER_B64,
    spki: fx.P384_SPKI_DER_B64,
    sec1: fx.P384_SEC1_DER_B64,
    sec1NoPublic: fx.P384_SEC1_NO_PUBLIC_DER_B64,
    pkcs8NoPublic: fx.P384_PKCS8_NO_PUBLIC_DER_B64,
    openssh: fx.P384_OPENSSH_FILE_B64,
    check: fx.P384_OPENSSH_CHECK_HEX,
    yLine: fx.P384_SSH_Y_LINE,
    publicLine: fx.P384_SSH_PUBLIC_LINE,
    rfc4716: fx.P384_RFC4716_TEXT,
    sha256: fx.P384_SSH_SHA256,
    md5: fx.P384_SSH_MD5,
  },
  {
    name: 'P-521',
    kind: 'ec',
    pkcs8: fx.P521_PKCS8_DER_B64,
    spki: fx.P521_SPKI_DER_B64,
    sec1: fx.P521_SEC1_DER_B64,
    sec1NoPublic: fx.P521_SEC1_NO_PUBLIC_DER_B64,
    pkcs8NoPublic: fx.P521_PKCS8_NO_PUBLIC_DER_B64,
    openssh: fx.P521_OPENSSH_FILE_B64,
    check: fx.P521_OPENSSH_CHECK_HEX,
    yLine: fx.P521_SSH_Y_LINE,
    publicLine: fx.P521_SSH_PUBLIC_LINE,
    rfc4716: fx.P521_RFC4716_TEXT,
    sha256: fx.P521_SSH_SHA256,
    md5: fx.P521_SSH_MD5,
  },
  {
    name: 'Ed25519',
    kind: 'ed25519',
    pkcs8: fx.ED25519_PKCS8_DER_B64,
    spki: fx.ED25519_SPKI_DER_B64,
    openssh: fx.ED25519_OPENSSH_FILE_B64,
    check: fx.ED25519_OPENSSH_CHECK_HEX,
    yLine: fx.ED25519_SSH_Y_LINE,
    publicLine: fx.ED25519_SSH_PUBLIC_LINE,
    rfc4716: fx.ED25519_RFC4716_TEXT,
    sha256: fx.ED25519_SSH_SHA256,
    md5: fx.ED25519_SSH_MD5,
  },
];

/** Every number of a key as hex, so two models are compared by what they hold. */
export function shape(key: KeyModel): string[] {
  const entries: [string, Uint8Array | string | undefined][] =
    key.type === 'rsa'
      ? [
          ['type', 'rsa'],
          ['n', key.n],
          ['e', key.e],
          ['d', key.d],
          ['p', key.p],
          ['q', key.q],
          ['dp', key.dp],
          ['dq', key.dq],
          ['qi', key.qi],
        ]
      : key.type === 'ec'
        ? [
            ['type', 'ec'],
            ['curve', key.curve],
            ['point', key.point],
            ['d', key.d],
          ]
        : [
            ['type', 'ed25519'],
            ['pub', key.pub],
            ['seed', key.seed],
          ];
  return entries.map(
    ([name, value]) => `${name}=${value === undefined ? '-' : typeof value === 'string' ? value : hex(value)}`,
  );
}

