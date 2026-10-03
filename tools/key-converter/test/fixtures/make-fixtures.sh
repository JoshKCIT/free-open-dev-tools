#!/bin/sh
# The commands behind every literal in this folder. Run by hand, never by the tests (CI has other versions of both programs).
#
#   OpenSSL 3.5.5 27 Jan 2026 (Git for Windows, /mingw64/bin/openssl)
#   OpenSSH_10.2p1, OpenSSL 3.5.5 27 Jan 2026 (Git for Windows, /usr/bin/ssh-keygen)
#   Node 22.14.0 (only to read files and print them as Base64 or hex; it makes no key)
#
# Usage, from Git Bash, with a scratch folder as the first argument (never a folder of the repository) and, optionally,
# "public" (part 1 only), "private" (part 2 only) or "all" (the default) as the second:
#
#   MSYS2_ARG_CONV_EXCL="*" sh tools/key-converter/test/fixtures/make-fixtures.sh /path/to/scratch private
#
# Part 1 makes the public key literals (rsa2048-public.ts, ec-ed25519-public.ts). Part 2 makes the private key literals
# (keys.ts): every private key is made in the scratch folder, converted by OpenSSL and ssh-keygen, written into
# keys.generated.ts as Base64 bodies without PEM armour, and thrown away with the folder. Under Git Bash, set
# MSYS2_ARG_CONV_EXCL="*" so options are not rewritten. The throwaway phrase below protects the three encrypted samples and
# nothing else.
set -eu
work="${1:-.}"
part="${2:-all}"
cd "$work"
phrase=throwaway-phrase

# ---------------------------------------------------------------------------------------------------------------------
# Part 1: public key literals (plan 14-01)
# ---------------------------------------------------------------------------------------------------------------------
if [ "$part" = all ] || [ "$part" = public ]; then
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out rsa2048.pem
openssl pkey -in rsa2048.pem -pubout -out rsa2048-pub.pem
openssl pkey -in rsa2048.pem -pubout -outform DER | base64 -w0 > rsa2048-spki.b64
ssh-keygen -i -m PKCS8 -f rsa2048-pub.pem > rsa2048.pub
ssh-keygen -l -E sha256 -f rsa2048.pub
ssh-keygen -l -E md5 -f rsa2048.pub
rm -f rsa2048.pem

# The RFC 8032 section 7.1 TEST 1 public key as an OpenSSH line (RFC 8709), and the fingerprints ssh-keygen prints:
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea\n' > rfc8032-test1.pub
ssh-keygen -l -E sha256 -f rfc8032-test1.pub
ssh-keygen -l -E md5 -f rfc8032-test1.pub

# ECDSA public keys (the private keys are thrown away), their OpenSSH lines and fingerprints, for ec-ed25519-public.ts:
for pair in p256:prime256v1 p384:secp384r1 p521:secp521r1; do
  name="${pair%%:*}"
  curve="${pair##*:}"
  openssl genpkey -algorithm EC -pkeyopt "ec_paramgen_curve:$curve" -pkeyopt ec_param_enc:named_curve -out "$name.pem"
  openssl pkey -in "$name.pem" -pubout -out "$name-pub.pem"
  openssl pkey -in "$name.pem" -pubout -outform DER | base64 -w0 > "$name-spki.b64"
  ssh-keygen -i -m PKCS8 -f "$name-pub.pem" > "$name.pub"
  ssh-keygen -l -E sha256 -f "$name.pub" | cut -d' ' -f2 > "$name.sha256"
  ssh-keygen -l -E md5 -f "$name.pub" | cut -d' ' -f2 > "$name.md5"
  rm -f "$name.pem"
done

# An Ed25519 key made by ssh-keygen itself (ssh-keygen -i cannot read an Ed25519 PKCS#8 public key). The
# SubjectPublicKeyInfo is the RFC 8410 section 4 prefix 302a300506032b6570032100 followed by the 32 byte key at the end of the blob.
ssh-keygen -q -t ed25519 -N "" -f edkey
cut -d' ' -f1,2 edkey.pub > ed.pub
node -e "
const fs = require('fs');
const blob = Buffer.from(fs.readFileSync('ed.pub', 'utf8').trim().split(' ')[1], 'base64');
const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), blob.subarray(blob.length - 32)]);
fs.writeFileSync('ed-spki.b64', spki.toString('base64'));
"
ssh-keygen -l -E sha256 -f ed.pub | cut -d' ' -f2 > ed.sha256
ssh-keygen -l -E md5 -f ed.pub | cut -d' ' -f2 > ed.md5
rm -f edkey edkey.pub
fi

if [ "$part" = all ] || [ "$part" = private ]; then

# ---------------------------------------------------------------------------------------------------------------------
# Part 2: private key literals (plan 14-02), for keys.ts
# ---------------------------------------------------------------------------------------------------------------------
mkdir -p fx
cd fx

# Five keys made by ssh-keygen (RSA 2048 and 3072, ECDSA 256, 384 and 521), all with an empty phrase and the comment
# "fixture". The OpenSSH file is the key as ssh-keygen wrote it. A copy is converted by ssh-keygen -p -m PEM into a PKCS#1
# (RSA) or SEC1 (ECDSA) PEM file, and everything else is written from that copy by OpenSSL.
for spec in rsa2048:rsa:2048 rsa3072:rsa:3072 p256:ecdsa:256 p384:ecdsa:384 p521:ecdsa:521; do
  name="${spec%%:*}"
  rest="${spec#*:}"
  type="${rest%%:*}"
  bits="${rest##*:}"
  ssh-keygen -q -t "$type" -b "$bits" -N "" -C fixture -f "$name"
  cp "$name" "$name.pem"
  ssh-keygen -q -p -N "" -m PEM -f "$name.pem" > /dev/null
done

# Ed25519: ssh-keygen -p cannot write an Ed25519 key as PKCS#8, so the key starts in OpenSSL and a copy is converted to
# the OpenSSH format by ssh-keygen -p, then given the comment "fixture".
openssl genpkey -algorithm ED25519 -out ed25519.pem
cp ed25519.pem ed25519
ssh-keygen -q -p -N "" -f ed25519 > /dev/null
ssh-keygen -q -c -C fixture -N "" -f ed25519 > /dev/null

for name in rsa2048 rsa3072 p256 p384 p521 ed25519; do
  openssl pkcs8 -topk8 -nocrypt -in "$name.pem" -outform DER -out "$name.p8.der"
  openssl pkey -in "$name.pem" -pubout -outform DER -out "$name.spki.der"
  ssh-keygen -y -f "$name" > "$name.y.txt"
  ssh-keygen -y -f "$name" | cut -d' ' -f1,2 > "$name.pub"
  ssh-keygen -e -f "$name.pub" > "$name.rfc4716.txt"
  ssh-keygen -l -E sha256 -f "$name.pub" | cut -d' ' -f2 > "$name.sha256"
  ssh-keygen -l -E md5 -f "$name.pub" | cut -d' ' -f2 > "$name.md5"
done
for name in rsa2048 rsa3072; do
  openssl rsa -in "$name.pem" -traditional -outform DER -out "$name.p1.der"
  openssl rsa -in "$name.pem" -RSAPublicKey_out -outform DER -out "$name.p1pub.der"
done
for name in p256 p384 p521; do
  openssl ec -in "$name.pem" -outform DER -out "$name.sec1.der"
  openssl ec -in "$name.pem" -no_public -out "$name.nopub.pem"
  openssl ec -in "$name.pem" -no_public -outform DER -out "$name.sec1nopub.der"
  openssl pkcs8 -topk8 -nocrypt -in "$name.nopub.pem" -outform DER -out "$name.p8nopub.der"
done

# Passphrase protected samples (all three must be refused): an encrypted PKCS#8, a legacy encrypted RSA PEM and an OpenSSH
# key made with a phrase.
openssl pkcs8 -topk8 -v2 aes-256-cbc -passout "pass:$phrase" -in p256.pem -outform DER -out enc.p8.der
openssl rsa -in rsa2048.pem -aes256 -traditional -passout "pass:$phrase" -out enc-rsa.pem
ssh-keygen -q -t ed25519 -N "$phrase" -C fixture -f enc-ed25519

# Keys this page refuses: an RSA-PSS key restricted to SHA-256 and a secp256k1 key.
openssl genpkey -algorithm RSA-PSS -pkeyopt rsa_keygen_bits:2048 -pkeyopt rsa_pss_keygen_md:sha256 -out pss.pem
openssl pkcs8 -topk8 -nocrypt -in pss.pem -outform DER -out pss.p8.der
openssl pkey -in pss.pem -pubout -outform DER -out pss.spki.der
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 -pkeyopt ec_param_enc:named_curve -out k1.pem
openssl pkcs8 -topk8 -nocrypt -in k1.pem -outform DER -out k1.p8.der
openssl pkey -in k1.pem -pubout -outform DER -out k1.spki.der

# What openssl ecparam -genkey writes: an EC PARAMETERS block and an EC PRIVATE KEY block in one file.
openssl ecparam -name prime256v1 -genkey -out ecparam.pem

# Print the outputs the tests compare with, and write keys.generated.ts.
for name in rsa2048 rsa3072 p256 p384 p521 ed25519; do
  echo "== $name"
  cat "$name.y.txt"
  cat "$name.rfc4716.txt"
  echo "$(cat "$name.sha256") $(cat "$name.md5")"
done

cat > assemble.cjs <<'NODE'
const fs = require('fs');
const b64 = (file) => fs.readFileSync(file).toString('base64');
const pemBody = (file) => {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('-----'));
  return lines;
};
const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r/g, '');
// ssh-keygen -e writes a Comment header with the user and host name of the machine (cut to 72 columns): it is not kept.
const withoutComment = (file) =>
  text(file)
    .split('\n')
    .filter((l) => !l.startsWith('Comment: '))
    .join('\n');
const KEYS = [
  ['RSA2048', 'rsa2048'],
  ['RSA3072', 'rsa3072'],
  ['P256', 'p256'],
  ['P384', 'p384'],
  ['P521', 'p521'],
  ['ED25519', 'ed25519'],
];
const lines = [];
const out = (s) => lines.push(s);
const lit = (v) => JSON.stringify(v);

// Reads the check value and the comment of an unencrypted OpenSSH private key file with the PROTOCOL.key layout. This
// is a second, independent reader (no code of the package) used only to record those two literals.
function opensshParts(file) {
  const raw = Buffer.from(pemBody(file).join(''), 'base64');
  let p = 15;
  const u32 = () => {
    const v = raw.readUInt32BE(p);
    p += 4;
    return v;
  };
  const str = () => {
    const n = u32();
    const s = raw.subarray(p, p + n);
    p += n;
    return s;
  };
  str();
  str();
  str();
  u32();
  str();
  const section = str();
  const check1 = section.readUInt32BE(0);
  const check2 = section.readUInt32BE(4);
  if (check1 !== check2) throw new Error('check values differ');
  return { check: section.subarray(0, 4).toString('hex') };
}

out('/**');
out(' * Private and public key literals for the key converter tests. GENERATED by make-fixtures.sh from keys that were made');
out(' * in a scratch folder and thrown away: nothing here is a key anyone uses. Every private key is a Base64 body without PEM');
out(' * armour (the tests put the armour round it from pieces, so no scanner reads a file of this repository as a live key).');
out(' * Versions: OpenSSL 3.5.5 27 Jan 2026 and OpenSSH_10.2p1 (see README.md for the date and the commands).');
out(' */');
out('');
for (const [C, f] of KEYS) {
  out(`export const ${C}_PKCS8_DER_B64 = ${lit(b64(`${f}.p8.der`))};`);
  out(`export const ${C}_SPKI_DER_B64 = ${lit(b64(`${f}.spki.der`))};`);
  if (C.startsWith('RSA')) {
    out(`export const ${C}_PKCS1_PRIVATE_DER_B64 = ${lit(b64(`${f}.p1.der`))};`);
    out(`export const ${C}_PKCS1_PUBLIC_DER_B64 = ${lit(b64(`${f}.p1pub.der`))};`);
  }
  if (C.startsWith('P')) {
    out(`export const ${C}_SEC1_DER_B64 = ${lit(b64(`${f}.sec1.der`))};`);
    out(`export const ${C}_SEC1_NO_PUBLIC_DER_B64 = ${lit(b64(`${f}.sec1nopub.der`))};`);
    out(`export const ${C}_PKCS8_NO_PUBLIC_DER_B64 = ${lit(b64(`${f}.p8nopub.der`))};`);
  }
  out(`export const ${C}_OPENSSH_FILE_B64 = ${lit(pemBody(f).join(''))};`);
  out(`export const ${C}_OPENSSH_CHECK_HEX = ${lit(opensshParts(f).check)};`);
  out(`export const ${C}_SSH_Y_LINE = ${lit(text(`${f}.y.txt`).trim())};`);
  out(`export const ${C}_SSH_PUBLIC_LINE = ${lit(text(`${f}.pub`).trim())};`);
  out(`export const ${C}_RFC4716_TEXT = ${lit(withoutComment(`${f}.rfc4716.txt`))};`);
  out(`export const ${C}_SSH_SHA256 = ${lit(text(`${f}.sha256`).trim())};`);
  out(`export const ${C}_SSH_MD5 = ${lit(text(`${f}.md5`).trim())};`);
  out('');
}
out('/** The comment every ssh-keygen fixture key carries. */');
out(`export const FIXTURE_COMMENT = 'fixture';`);
out('');
out('// Protected and refused keys. Base64 of the DER body (PKCS#8) or of the OpenSSH file body; the legacy PEM keeps its header lines.');
out(`export const ENCRYPTED_PKCS8_DER_B64 = ${lit(b64('enc.p8.der'))};`);
const enc = fs.readFileSync('enc-rsa.pem', 'utf8').replace(/\r/g, '').split('\n').filter((l) => l !== '' && !l.startsWith('-----'));
const headerLines = enc.filter((l) => l.includes(':'));
const bodyLines = enc.filter((l) => !l.includes(':'));
out(`export const ENCRYPTED_RSA_PEM_HEADER_LINES = ${lit(headerLines)};`);
out(`export const ENCRYPTED_RSA_PEM_BODY_B64 = ${lit(bodyLines.join(''))};`);
out(`export const ENCRYPTED_OPENSSH_FILE_B64 = ${lit(pemBody('enc-ed25519').join(''))};`);
out(`export const RSA_PSS_RESTRICTED_PKCS8_DER_B64 = ${lit(b64('pss.p8.der'))};`);
out(`export const RSA_PSS_RESTRICTED_SPKI_DER_B64 = ${lit(b64('pss.spki.der'))};`);
out(`export const SECP256K1_PKCS8_DER_B64 = ${lit(b64('k1.p8.der'))};`);
out(`export const SECP256K1_SPKI_DER_B64 = ${lit(b64('k1.spki.der'))};`);
const ep = fs.readFileSync('ecparam.pem', 'utf8').replace(/\r/g, '');
const blocks = [];
for (const m of ep.split('-----BEGIN ').slice(1)) {
  const label = m.slice(0, m.indexOf('-----'));
  const body = m.slice(m.indexOf('-----') + 5, m.indexOf('-----END')).split('\n').join('');
  blocks.push([label, body]);
}
out(`export const ECPARAM_OUTPUT_BLOCKS = ${lit(blocks)};`);
process.stdout.write(lines.join('\n') + '\n');
NODE
node assemble.cjs > keys.generated.ts
echo "keys.generated.ts written in $(pwd)"
fi
