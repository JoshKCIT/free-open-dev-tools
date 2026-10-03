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
