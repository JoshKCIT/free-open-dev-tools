/**
 * The OpenSSH public key blob and line: ssh-rsa (RFC 4253 section 6.6), ecdsa-sha2-nistp256, -nistp384 and -nistp521
 * (RFC 5656 section 3.1) and ssh-ed25519 (RFC 8709 section 4). A blob is a series of SSH strings (RFC 4251
 * section 5): a four byte big-endian length and then the bytes; an mpint is a string holding the number with no leading
 * zeros and one zero byte in front of a set top bit, and zero is the empty string.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { concat } from './der-write';
import { CURVES, KeyConverterError, type Curve, type KeyModel } from './model';
import { bytesToBase64 } from './pem';

function uint32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

/** An SSH string: a length and the bytes. */
export function sshString(bytes: Uint8Array): Uint8Array {
  return concat(uint32(bytes.length), bytes);
}

/** An SSH mpint of an unsigned magnitude. */
export function sshMpint(magnitude: Uint8Array): Uint8Array {
  let skip = 0;
  while (skip < magnitude.length && magnitude[skip] === 0) skip++;
  const trimmed = magnitude.subarray(skip);
  if (trimmed.length === 0) return uint32(0);
  return sshString((trimmed[0]! & 0x80) !== 0 ? concat(Uint8Array.of(0), trimmed) : trimmed);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (character) => character.charCodeAt(0)));
}

/** The name written at the start of the line and of the blob, for example ssh-rsa. */
export function sshKeyType(key: KeyModel): string {
  switch (key.type) {
    case 'rsa':
      return 'ssh-rsa';
    case 'ec':
      return `ecdsa-sha2-${sshCurveName(key.curve)}`;
    case 'ed25519':
      return 'ssh-ed25519';
  }
}

/** The curve identifier OpenSSH writes: nistp256, nistp384 or nistp521 (RFC 5656 section 6.1). */
function sshCurveName(curve: Curve): string {
  const info = CURVES.get(curve);
  if (info === undefined) throw new KeyConverterError('This elliptic curve is not supported.');
  return info.ssh;
}

/** The public key blob that follows the name on an OpenSSH public key line. */
export function sshPublicBlob(key: KeyModel): Uint8Array {
  const name = sshString(ascii(sshKeyType(key)));
  switch (key.type) {
    case 'rsa':
      return concat(name, sshMpint(key.e), sshMpint(key.n));
    case 'ec':
      return concat(name, sshString(ascii(sshCurveName(key.curve))), sshString(key.point));
    case 'ed25519':
      return concat(name, sshString(key.pub));
  }
}

/** The OpenSSH public key line: the name, the Base64 of the blob and, when given, the comment after one space. */
export function sshPublicLine(key: KeyModel, comment: string): string {
  const line = `${sshKeyType(key)} ${bytesToBase64(sshPublicBlob(key))}`;
  return comment === '' ? line : `${line} ${comment}`;
}
