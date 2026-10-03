#!/bin/sh
# Makes the literals in rsa2048-public.ts. Run by hand, never by the tests (CI has other versions of both programs).
#
#   OpenSSL 3.5.5 27 Jan 2026 (Git for Windows, /mingw64/bin/openssl)
#   OpenSSH_10.2p1, OpenSSL 3.5.5 27 Jan 2026 (Git for Windows, /usr/bin/ssh-keygen)
#
# The private key is made in a scratch folder and thrown away; only the public key and what ssh-keygen printed for it
# are copied into the test fixture. Under Git Bash, set MSYS2_ARG_CONV_EXCL="*" so options are not rewritten.
set -eu
work="${1:-.}"
cd "$work"
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
