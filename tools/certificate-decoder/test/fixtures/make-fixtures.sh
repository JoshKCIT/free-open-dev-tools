#!/bin/sh
# Makes every certificate and request the certificate decoder's tests read, with OpenSSL, and prints what OpenSSL says
# about each one. Nothing here is committed except its output: the private keys stay in the scratch folder and are
# deleted afterwards.
#
#   MSYS2_ARG_CONV_EXCL="*" sh tools/certificate-decoder/test/fixtures/make-fixtures.sh <scratch folder> > printed.txt
#
# MSYS2_ARG_CONV_EXCL stops Git Bash from rewriting -subj "/C=..." as a path. Run with OpenSSL 3.5.5 (Git for Windows,
# /mingw64/bin/openssl); the version is in README.md. The program prints "== name" before each certificate.
set -e
OUT="$1"
if [ -z "$OUT" ]; then
  echo "usage: make-fixtures.sh <scratch folder>" >&2
  exit 1
fi
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
cd "$OUT"
cp "$HERE/ca.cnf" "$HERE/leaf.cnf" .
export MSYS2_ARG_CONV_EXCL="*"

# A 3072-bit RSA root (SHA-384), a P-384 intermediate with CRL, AIA, name constraints and policies, and a 2048-bit RSA leaf
# with the UTF-8 organisation, nine kinds of alternative name and serial 0x0abcdef0123456789.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out root.key 2>/dev/null
openssl req -new -x509 -key root.key -sha384 -days 3650 -config ca.cnf -extensions v3_root -out root.pem -set_serial 0x01
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-384 -out int.key
openssl req -new -key int.key -config ca.cnf -subj "/C=GB/O=Example Root Ltd/CN=Example Intermediate CA" -out int.csr
openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -sha384 -days 1825 -extfile ca.cnf -extensions v3_int -out int.pem -set_serial 0x1001 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out leaf.key 2>/dev/null
openssl req -new -key leaf.key -config leaf.cnf -out leaf.csr
openssl x509 -req -in leaf.csr -CA int.pem -CAkey int.key -sha256 -days 90 -extfile ca.cnf -extensions v3_leaf -out leaf.pem -set_serial 0x0abcdef0123456789 2>/dev/null

# Self-signed certificates: P-256 (valid for 3,650 days, so the page does not open on an expired example), Ed25519,
# P-521 and RSA-PSS.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ec256.key
openssl req -new -x509 -key ec256.key -sha256 -days 3650 -config ca.cnf -subj "/CN=ec256.example.com" \
  -addext "subjectAltName=DNS:ec256.example.com" -addext "subjectKeyIdentifier=hash" -addext "basicConstraints=critical,CA:TRUE" -out ec256.pem
openssl genpkey -algorithm ED25519 -out ed25519.key
openssl req -new -x509 -key ed25519.key -days 30 -config ca.cnf -subj "/CN=ed25519.example.com" \
  -addext "subjectAltName=DNS:ed25519.example.com" -out ed25519.pem
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-521 -out ec521.key
openssl req -new -x509 -key ec521.key -sha512 -days 30 -config ca.cnf -subj "/CN=ec521.example.com" -out ec521.pem
openssl genpkey -algorithm RSA-PSS -pkeyopt rsa_keygen_bits:2048 -pkeyopt rsa_pss_keygen_md:sha256 -pkeyopt rsa_pss_keygen_saltlen:32 -out pss.key 2>/dev/null
openssl req -new -x509 -key pss.key -days 30 -config ca.cnf -subj "/CN=pss.example.com" -out pss.pem

# One weak certificate: a 1024-bit RSA key signed with SHA-1, valid for 10,000 days so its end date is written as a
# GeneralizedTime, with a critical extension OpenSSL does not know whose value is 300 bytes (0x00 to 0xff, then 0x00 to 0x2b).
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:1024 -out weak.key 2>/dev/null
LONGHEX=$(seq 0 299 | awk '{printf "%02x", $1 % 256}')
openssl req -new -x509 -key weak.key -sha1 -days 10000 -config ca.cnf -subj "/CN=weak.example.com" -set_serial 0x7b \
  -addext "1.3.6.1.4.1.99999.3=critical,DER:$LONGHEX" -out weak.pem

# The certificate that names a local address everywhere an address can be named, for the test that nothing is requested.
openssl req -new -x509 -key ec256.key -sha256 -days 3650 -config ca.cnf -extensions v3_canary -subj "/CN=FODT-SECURITY-CANARY" -out canary.pem

# Three requests: RSA with the extension request, P-256 and Ed25519.
openssl req -new -key leaf.key -subj "/C=US/O=CSR Org/CN=csr.example.com" -config ca.cnf -reqexts req_san -out rsa.csr
openssl req -new -key ec256.key -subj "/CN=ec-csr.example.com" -out ec.csr
openssl req -new -key ed25519.key -subj "/CN=ed-csr.example.com" -out ed.csr

for f in root int leaf ec256 ed25519 ec521 pss weak canary; do openssl x509 -in $f.pem -outform DER -out $f.der; done
for f in rsa ec ed; do openssl req -in $f.csr -outform DER -out $f.csr.der; done

for f in root int leaf ec256 ed25519 ec521 pss weak canary; do
  echo "== $f"
  cat $f.pem
  echo "-- fingerprint sha256"; openssl x509 -in $f.pem -noout -fingerprint -sha256
  echo "-- fingerprint sha1"; openssl x509 -in $f.pem -noout -fingerprint -sha1
  echo "-- fingerprint md5"; openssl x509 -in $f.pem -noout -fingerprint -md5
  echo "-- serial"; openssl x509 -in $f.pem -noout -serial
  echo "-- subject rfc2253"; openssl x509 -in $f.pem -noout -subject -nameopt RFC2253,-esc_msb
  echo "-- issuer rfc2253"; openssl x509 -in $f.pem -noout -issuer -nameopt RFC2253,-esc_msb
  echo "-- subject oneline"; openssl x509 -in $f.pem -noout -subject -nameopt oneline,-esc_msb,-space_eq
  echo "-- issuer oneline"; openssl x509 -in $f.pem -noout -issuer -nameopt oneline,-esc_msb,-space_eq
  echo "-- dates"; openssl x509 -in $f.pem -noout -dates
  echo "-- spki sha256"; openssl x509 -in $f.pem -noout -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256
  echo "-- text"; openssl x509 -in $f.pem -noout -text
done
for f in rsa ec ed; do
  echo "== $f.csr"
  cat $f.csr
  echo "-- subject rfc2253"; openssl req -in $f.csr -noout -subject -nameopt RFC2253,-esc_msb
  echo "-- request der sha256"; openssl req -in $f.csr -outform DER | openssl dgst -sha256
  echo "-- text"; openssl req -in $f.csr -noout -text
done
