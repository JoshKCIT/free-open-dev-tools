/**
 * The OpenSSH key formats. The public key blob and line: ssh-rsa (RFC 4253 section 6.6), ecdsa-sha2-nistp256, -nistp384
 * and -nistp521 (RFC 5656 section 3.1) and ssh-ed25519 (RFC 8709 section 4). A blob is a series of SSH strings (RFC 4251
 * section 5): a four byte big-endian length and then the bytes; an mpint is a string holding the number with no leading
 * zeros and one zero byte in front of a set top bit, and zero is the empty string. The private key file of PROTOCOL.key
 * and the RFC 4716 public key file are read here as well.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { concat } from './der-write';
import { browserRandom } from './generate';
import { CURVE_SENTENCE, DOES_NOT_BELONG, curveInfo, ecNormalizePoint, ecPublicFromPrivate, padTo } from './formats';
import { CURVES, KeyConverterError, bytesEqual, checkComment, isPrivate, type Curve, type KeyModel } from './model';
import { PemError, base64ToBytes, bytesToBase64, bytesToPem, pemBlocks } from './pem';
import { checkRsaModulus, checkRsaPublic, completeRsa, trimZeros } from './rsa-math';

const PASSPHRASE_SENTENCE =
  'This key is protected by a passphrase. This page does not decrypt keys. Remove the passphrase on your own machine first (for example openssl pkey -in key.pem -out plain.pem), then paste the unprotected key.';
const UNKNOWN_TYPE =
  'This OpenSSH key is of a type this page does not read. It reads ssh-rsa, ecdsa-sha2-nistp256, ecdsa-sha2-nistp384, ecdsa-sha2-nistp521 and ssh-ed25519 keys.';
const TOO_SHORT = 'The OpenSSH key data ends too soon.';

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

// ---------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------

const MAGIC_BYTES = Uint8Array.from(Array.from('openssh-key-v1\0', (character) => character.charCodeAt(0)));

/** The key type and the key numbers of a private key, in the order of draft-miller-ssh-agent section 3.2. */
function sshPrivateFields(key: KeyModel): Uint8Array {
  switch (key.type) {
    case 'rsa':
      if (!isPrivate(key)) break;
      // string "ssh-rsa", mpint n, mpint e, mpint d, mpint iqmp, mpint p, mpint q
      return concat(
        sshString(ascii('ssh-rsa')),
        sshMpint(key.n),
        sshMpint(key.e),
        sshMpint(key.d!),
        sshMpint(key.qi!),
        sshMpint(key.p!),
        sshMpint(key.q!),
      );
    case 'ec':
      if (key.d === undefined) break;
      // string key type, string curve identifier, string Q, mpint d
      return concat(
        sshString(ascii(sshKeyType(key))),
        sshString(ascii(sshCurveName(key.curve))),
        sshString(key.point),
        sshMpint(key.d),
      );
    case 'ed25519':
      if (key.seed === undefined) break;
      // string "ssh-ed25519", string public key, string (seed followed by the public key)
      return concat(sshString(ascii('ssh-ed25519')), sshString(key.pub), sshString(concat(key.seed, key.pub)));
  }
  throw new KeyConverterError('This key has no private part, so it cannot be written as a private key.');
}

/**
 * The OpenSSH private key file (PROTOCOL.key) of a private key, with cipher and KDF none and one key: the magic, the
 * public key, and a private part of the check value twice, the key, the comment and the padding 1, 2, 3 and so on up to a
 * multiple of 8. The body is wrapped at 70 columns as ssh-keygen wraps it. The check value is four bytes from `rand` (the
 * browser's generator by default) unless it is given.
 */
export function sshPrivate(
  key: KeyModel,
  comment: string,
  rand: (count: number) => Uint8Array = browserRandom,
  check?: Uint8Array,
): string {
  const fields = sshPrivateFields(key);
  checkComment(comment);
  const value = check ?? rand(4);
  if (value.length !== 4) throw new KeyConverterError('The check value of an OpenSSH private key is four bytes.');
  const unpadded = concat(value, value, fields, sshString(new TextEncoder().encode(comment)));
  const padding = Uint8Array.from({ length: (8 - (unpadded.length % 8)) % 8 }, (_, i) => i + 1);
  const section = concat(unpadded, padding);
  const blob = concat(
    MAGIC_BYTES,
    sshString(ascii('none')),
    sshString(ascii('none')),
    sshString(new Uint8Array(0)),
    uint32(1),
    sshString(sshPublicBlob(key)),
    sshString(section),
  );
  return bytesToPem('OPENSSH PRIVATE KEY', blob, 70);
}

/** A comment as the inside of an RFC 4716 quoted string: a backslash is put in front of a backslash and a quote. */
function escapeComment(comment: string): string {
  let out = '';
  for (const character of comment) out += character === '\\' || character === '"' ? '\\' + character : character;
  return out;
}

/**
 * The RFC 4716 public key file: the BEGIN line, a Comment header when there is a comment (quoted, with backslash and
 * quote escaped), the Base64 of the public key blob in 70 column lines, and the END line.
 */
export function rfc4716(key: KeyModel, comment: string): string {
  checkComment(comment);
  const body = bytesToBase64(sshPublicBlob(key));
  const lines: string[] = [RFC4716_BEGIN];
  if (comment !== '') lines.push(`Comment: "${escapeComment(comment)}"`);
  for (let i = 0; i < body.length; i += 70) lines.push(body.slice(i, i + 70));
  lines.push(RFC4716_END);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

/** A cursor over SSH data (RFC 4251 section 5). Every length is checked against what is left before it is used. */
class SshReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  uint32(): number {
    if (this.remaining < 4) throw new KeyConverterError(TOO_SHORT);
    const b = this.bytes;
    const p = this.position;
    this.position += 4;
    return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0;
  }

  string(): Uint8Array {
    const length = this.uint32();
    if (length > this.remaining) throw new KeyConverterError(TOO_SHORT);
    const out = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return out;
  }

  /** An mpint as an unsigned magnitude. A negative number is not a key number. */
  mpint(): Uint8Array {
    const raw = this.string();
    if (raw.length > 0 && (raw[0]! & 0x80) !== 0) {
      throw new KeyConverterError('A key number inside this OpenSSH key is negative.');
    }
    return raw.length === 0 ? Uint8Array.of(0) : Uint8Array.from(trimZeros(raw));
  }

  rest(): Uint8Array {
    const out = this.bytes.subarray(this.position);
    this.position = this.bytes.length;
    return out;
  }
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

const SSH_CURVES = new Map<string, Curve>(Array.from(CURVES, ([name, info]) => [info.ssh, name]));

const SSH_TYPES = new Map<string, 'rsa' | 'ed25519' | Curve>([
  ['ssh-rsa', 'rsa'],
  ['ssh-ed25519', 'ed25519'],
  ['ecdsa-sha2-nistp256', 'P-256'],
  ['ecdsa-sha2-nistp384', 'P-384'],
  ['ecdsa-sha2-nistp521', 'P-521'],
]);

/** The curve an identifier names, checked to be the identifier of the key type it sits in. */
function ecFromIdentifier(typeCurve: Curve, identifier: string): Curve {
  const named = SSH_CURVES.get(identifier);
  if (named === undefined) throw new KeyConverterError(CURVE_SENTENCE);
  if (named !== typeCurve) {
    throw new KeyConverterError('The curve inside this OpenSSH key is not the curve of its key type.');
  }
  return named;
}

function ed25519Public(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32) throw new KeyConverterError('An Ed25519 public key is 32 bytes.');
  try {
    ed25519.Point.fromBytes(bytes);
  } catch {
    throw new KeyConverterError('The public key is not a valid Ed25519 point.');
  }
  return Uint8Array.from(bytes);
}

/** Reads a public key blob (the part of a line after the type) into the key model. Nothing may follow the key. */
export function readSshPublicBlob(blob: Uint8Array): KeyModel {
  const reader = new SshReader(blob);
  const kind = SSH_TYPES.get(latin1(reader.string()));
  if (kind === undefined) throw new KeyConverterError(UNKNOWN_TYPE);
  let key: KeyModel;
  if (kind === 'rsa') {
    const e = reader.mpint();
    const n = reader.mpint();
    checkRsaPublic(n, e);
    key = { type: 'rsa', n, e };
  } else if (kind === 'ed25519') {
    key = { type: 'ed25519', pub: ed25519Public(reader.string()) };
  } else {
    const curve = ecFromIdentifier(kind, latin1(reader.string()));
    key = { type: 'ec', curve, point: ecNormalizePoint(curve, reader.string()) };
  }
  if (reader.remaining !== 0) throw new KeyConverterError('There is extra data after the key inside this OpenSSH key.');
  return key;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9;
}

/**
 * Reads one OpenSSH public key line: the type, the Base64 of the blob and an optional comment, which may hold spaces.
 * The type on the line must be the type inside the blob.
 */
export function readSshPublicLine(line: string): { key: KeyModel; comment: string } {
  const text = line.trim();
  let at = 0;
  const token = (): string => {
    while (at < text.length && isSpace(text.charCodeAt(at))) at++;
    const from = at;
    while (at < text.length && !isSpace(text.charCodeAt(at))) at++;
    return text.slice(from, at);
  };
  const type = token();
  const data = token();
  const comment = text.slice(at).trim();
  if (!SSH_TYPES.has(type)) throw new KeyConverterError(UNKNOWN_TYPE);
  if (data === '') throw new KeyConverterError('This OpenSSH public key line has a type but no key data.');
  let blob: Uint8Array;
  try {
    blob = base64ToBytes(data);
  } catch (err) {
    throw new KeyConverterError(
      'The key data on this OpenSSH line is not valid Base64.',
      err instanceof PemError ? err.position : undefined,
    );
  }
  const key = readSshPublicBlob(blob);
  if (sshKeyType(key) !== type) {
    throw new KeyConverterError('The key type at the start of this line is not the type of the key inside it.');
  }
  return { key, comment };
}

const MAGIC = 'openssh-key-v1\0';

/**
 * Reads the bytes inside an OPENSSH PRIVATE KEY block (PROTOCOL.key). Only a key with cipher and KDF none and exactly one
 * key is read; the two check values must agree, the padding must be 1, 2, 3 and so on, and the public key in front of the
 * private part must be the public key of the private part.
 */
export function readSshPrivateBody(body: Uint8Array): { key: KeyModel; comment: string; check: Uint8Array } {
  if (body.length < MAGIC.length || latin1(body.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new KeyConverterError('This is not an OpenSSH private key file: it does not start with openssh-key-v1.');
  }
  const reader = new SshReader(body.subarray(MAGIC.length));
  const cipher = latin1(reader.string());
  const kdf = latin1(reader.string());
  reader.string(); // KDF options
  if (cipher !== 'none') throw new KeyConverterError(PASSPHRASE_SENTENCE);
  if (kdf !== 'none') throw new KeyConverterError('This OpenSSH key uses a key derivation this page does not read.');
  const count = reader.uint32();
  if (count !== 1) {
    throw new KeyConverterError('This OpenSSH file does not hold exactly one key. Paste one key at a time.');
  }
  const publicBlob = reader.string();
  const section = reader.string();
  if (reader.remaining !== 0) throw new KeyConverterError('There is extra data after the key in this OpenSSH file.');
  if (section.length % 8 !== 0) {
    throw new KeyConverterError('The private part of this OpenSSH file is not a whole number of 8 byte blocks.');
  }

  const priv = new SshReader(section);
  const check = Uint8Array.from(section.subarray(0, 4));
  const first = priv.uint32();
  const second = priv.uint32();
  if (first !== second) {
    throw new KeyConverterError(
      'The two check values at the start of the private part differ, so this OpenSSH file is damaged.',
    );
  }
  const kind = SSH_TYPES.get(latin1(priv.string()));
  if (kind === undefined) throw new KeyConverterError(UNKNOWN_TYPE);
  let key: KeyModel;
  if (kind === 'rsa') {
    const n = priv.mpint();
    const e = priv.mpint();
    const d = priv.mpint();
    const qi = priv.mpint();
    const p = priv.mpint();
    const q = priv.mpint();
    checkRsaModulus(n);
    key = completeRsa({ type: 'rsa', n, e, d, p, q, qi });
  } else if (kind === 'ed25519') {
    const pub = ed25519Public(priv.string());
    const secret = priv.string();
    if (secret.length !== 64) throw new KeyConverterError('An Ed25519 private key in this file is not 64 bytes.');
    const seed = Uint8Array.from(secret.subarray(0, 32));
    const derived = Uint8Array.from(ed25519.getPublicKey(seed));
    if (!bytesEqual(derived, pub) || !bytesEqual(derived, secret.subarray(32))) {
      throw new KeyConverterError(DOES_NOT_BELONG);
    }
    key = { type: 'ed25519', pub: derived, seed };
  } else {
    const curve = ecFromIdentifier(kind, latin1(priv.string()));
    const point = ecNormalizePoint(curve, priv.string());
    const d = padTo(priv.mpint(), curveInfo(curve).size);
    if (!bytesEqual(ecPublicFromPrivate(curve, d), point)) throw new KeyConverterError(DOES_NOT_BELONG);
    key = { type: 'ec', curve, point, d };
  }
  const comment = new TextDecoder().decode(priv.string());
  const padding = priv.rest();
  if (padding.length >= 8) throw new KeyConverterError('The padding at the end of this OpenSSH file is too long.');
  for (let i = 0; i < padding.length; i++) {
    if (padding[i] !== i + 1) {
      throw new KeyConverterError(
        'The padding at the end of this OpenSSH file is not 1, 2, 3 and so on, so the file is damaged.',
      );
    }
  }
  // The public key written in front of the private part must be the one the private part gives.
  const outer = readSshPublicBlob(publicBlob);
  if (!bytesEqual(sshPublicBlob(outer), sshPublicBlob(key))) throw new KeyConverterError(DOES_NOT_BELONG);
  return { key, comment, check };
}

/** Reads an OpenSSH private key file: the text with its OPENSSH PRIVATE KEY armour, in any line width. */
export function readSshPrivate(text: string): { key: KeyModel; comment: string; check: Uint8Array } {
  const blocks = pemBlocks(text, 4).filter((block) => block.label === 'OPENSSH PRIVATE KEY');
  if (blocks.length !== 1) throw new KeyConverterError('This is not one OpenSSH private key file.');
  return readSshPrivateBody(blocks[0]!.body);
}

const RFC4716_BEGIN = '---- BEGIN SSH2 PUBLIC KEY ----';
const RFC4716_END = '---- END SSH2 PUBLIC KEY ----';

/** Undoes the backslash escapes of a quoted RFC 4716 comment: a backslash makes the next character itself. */
function unescapeComment(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const character = value.charAt(i);
    if (character === '\\' && i + 1 < value.length) {
      i++;
      out += value.charAt(i);
    } else {
      out += character;
    }
  }
  return out;
}

/**
 * Reads an RFC 4716 public key file: the BEGIN line, header lines (a header ending in a backslash continues on the next
 * line), the Base64 of the blob, and the END line. The Comment header gives the comment, with its quotes removed and its
 * backslash escapes undone; any other header is ignored.
 */
export function readRfc4716(text: string): { key: KeyModel; comment: string } {
  const lines = text.split('\n').map((line) => line.trim());
  let at = 0;
  while (at < lines.length && lines[at] === '') at++;
  if (lines[at] !== RFC4716_BEGIN) {
    throw new KeyConverterError('This is not an RFC 4716 public key file: it does not start with its BEGIN line.');
  }
  at++;
  let comment = '';
  while (at < lines.length && lines[at]!.includes(':')) {
    let header = lines[at]!;
    at++;
    while (header.endsWith('\\') && at < lines.length) {
      header = header.slice(0, -1) + lines[at]!;
      at++;
    }
    const colon = header.indexOf(':');
    if (header.slice(0, colon).trim().toLowerCase() === 'comment') {
      let value = header.slice(colon + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      comment = unescapeComment(value);
    }
  }
  const body: string[] = [];
  while (at < lines.length && lines[at] !== RFC4716_END) {
    body.push(lines[at]!);
    at++;
  }
  if (at >= lines.length) throw new KeyConverterError('This RFC 4716 file has no END line.');
  let blob: Uint8Array;
  try {
    blob = base64ToBytes(body.join(''));
  } catch {
    throw new KeyConverterError('The key data of this RFC 4716 file is not valid Base64.');
  }
  return { key: readSshPublicBlob(blob), comment };
}
