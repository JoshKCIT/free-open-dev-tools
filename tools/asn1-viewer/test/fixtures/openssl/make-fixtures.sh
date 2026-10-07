#!/usr/bin/env bash
# Records the structures and the OpenSSL output that openssl.test.ts compares the reader with.
#
#   bash make-fixtures.sh [work-folder]
#
# Needs OpenSSL 3.5.x, xxd and Node on the path. It builds the structures in the work folder (a fresh temporary folder
# when none is given), runs `openssl asn1parse -inform DER -i` on each, and writes structures.ts, asn1parse.json and
# oid-names.json next to this script. The keys are generated on the spot and thrown away: the files hold their DER as
# Base64 and never an armoured private key. Run it in Git Bash on Windows with MSYS_NO_PATHCONV=1 already set (the script
# sets it), because OpenSSL's -subj value starts with a slash.
set -e
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
cd "$WORK"
rm -f ./*.der ./*.txt ./*.p12 ./*.pem

VERSION="$(openssl version | tr -d '\r')"
printf 'hello asn1 world\n' > data.txt

# Real structures made by OpenSSL: keys, certificates, a request, CMS with definite and with indefinite lengths, OCSP and
# time-stamp requests and a PKCS #12 file.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ec.pem 2>/dev/null
openssl genpkey -algorithm ED25519 -out ed.pem 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:1024 -out rsa.pem 2>/dev/null

openssl pkcs8 -topk8 -nocrypt -in ec.pem -outform DER -out ec-pkcs8.der
openssl pkcs8 -topk8 -nocrypt -in ed.pem -outform DER -out ed-pkcs8.der
openssl pkcs8 -topk8 -nocrypt -in rsa.pem -outform DER -out rsa-pkcs8.der
openssl pkey -in rsa.pem -pubout -outform DER -out rsa-spki.der
openssl pkey -in ec.pem -pubout -outform DER -out ec-spki.der
openssl pkcs8 -topk8 -v2 aes-128-cbc -v2prf hmacWithSHA256 -passout pass:fixture -in ec.pem -outform DER -out ec-encrypted-pkcs8.der

openssl req -x509 -new -key ec.pem -subj "/CN=Test Root/O=Example" -days 3650 -outform PEM -out root.pem
openssl x509 -in root.pem -outform DER -out root.der
openssl req -x509 -new -key ed.pem -subj "/CN=Ed Root" -days 3650 -outform DER -out ed-root.der
openssl req -x509 -new -key rsa.pem -subj "/CN=RSA Root" -days 3650 -outform DER -out rsa-root.der
openssl req -new -key ec.pem -subj "/CN=Test Request" -outform DER -out csr.der

# CMS signed data with definite lengths, then with indefinite lengths (-stream), and an S/MIME signature the same way.
openssl cms -sign -in data.txt -signer root.pem -inkey ec.pem -binary -outform DER -out cms-definite.der
openssl cms -sign -in data.txt -signer root.pem -inkey ec.pem -binary -stream -outform DER -out cms-stream.der
openssl smime -sign -in data.txt -signer root.pem -inkey ec.pem -binary -stream -outform DER -out smime-stream.der

openssl ocsp -issuer root.pem -cert root.pem -reqout ocsp-req.der
openssl ts -query -data data.txt -sha256 -no_nonce -out ts-query.der
openssl pkcs12 -export -inkey ec.pem -in root.pem -out ec.p12 -passout pass:fixture -macalg SHA256 2>/dev/null
cp ec.p12 ec-p12.der

# The worked examples of ITU-T X.690 (02/2021), as hex, written to files so OpenSSL reads the same bytes the tests use.
literal() { printf '%s' "$2" | xxd -r -p > "$1.der"; }
literal x690-8-1-3-4-length-38 "0426$(printf '00%.0s' $(seq 1 38))"
literal x690-8-1-3-5-length-201 "0481c9$(printf '00%.0s' $(seq 1 201))"
literal x690-8-1-3-6-indefinite 30800201050000
literal x690-8-2-boolean-true 0101ff
literal x690-8-6-4-2-bitstring-primitive 0307040a3b5f291cd0
literal x690-8-6-4-2-bitstring-constructed 23800303000a3b0305045f291cd00000
literal x690-8-8-null 0500
literal x690-8-9-sequence 300a1605536d6974680101ff
literal x690-8-14-type4 670743054a6f6e6573
literal x690-8-19-5-oid 0603883703
literal x690-8-20-5-relative-oid 0d04c27b0302
literal x690-8-23-5-4-primitive 1a054a6f6e6573
literal x690-8-23-5-4-definite 3a0904034a6f6e04026573
literal x690-8-23-5-4-indefinite 3a8004034a6f6e040265730000
literal x690-a-3-personnel 60818561101a044a6f686e1a01501a05536d697468a00a1a084469726563746f72420133a10a43083139373130393137a21261101a044d6172791a01541a05536d697468a342311f61111a0552616c70681a01541a05536d697468a00a43083139353731313131311f61111a05537573616e1a01421a054a6f6e6573a00a43083139353930373137
ls -1 ./*.der | sed 's|^\./||; s|\.der$||' | sort > order.txt

# Run asn1parse over every file; a file OpenSSL refuses in the middle keeps the lines it printed before the error.
while read -r name; do
  openssl asn1parse -inform DER -i -in "$name.der" 2>&1 | tr -d '\r' > "$name.txt" || true
done < order.txt

# The object identifiers of src/oids-extra.ts: OpenSSL is asked for the digits of each name.
EXTRA_NAMES="1.2.840.113549.1.7.1 pkcs7-data
1.2.840.113549.1.7.2 pkcs7-signedData
1.2.840.113549.1.7.3 pkcs7-envelopedData
1.2.840.113549.1.7.5 pkcs7-digestData
1.2.840.113549.1.7.6 pkcs7-encryptedData
1.2.840.113549.1.9.16.1.2 id-smime-ct-authData
1.2.840.113549.1.9.3 contentType
1.2.840.113549.1.9.4 messageDigest
1.2.840.113549.1.9.5 signingTime
1.2.840.113549.1.9.6 countersignature
1.2.840.113549.1.9.2 unstructuredName
1.2.840.113549.1.9.7 challengePassword
1.2.840.113549.1.9.8 unstructuredAddress
1.2.840.113549.1.9.14 Extension Request
1.2.840.113549.1.9.15 S/MIME Capabilities
1.2.840.113549.1.9.20 friendlyName
1.2.840.113549.1.9.21 localKeyID
1.2.840.113549.1.9.22.1 x509Certificate
1.2.840.113549.1.9.22.2 sdsiCertificate
1.2.840.113549.1.9.23.1 x509Crl
1.2.840.113549.1.5.3 pbeWithMD5AndDES-CBC
1.2.840.113549.1.5.10 pbeWithSHA1AndDES-CBC
1.2.840.113549.1.5.12 PBKDF2
1.2.840.113549.1.5.13 PBES2
1.2.840.113549.1.5.14 PBMAC1
1.2.840.113549.2.7 hmacWithSHA1
1.2.840.113549.2.8 hmacWithSHA224
1.2.840.113549.2.9 hmacWithSHA256
1.2.840.113549.2.10 hmacWithSHA384
1.2.840.113549.2.11 hmacWithSHA512
1.3.14.3.2.7 des-cbc
1.2.840.113549.3.7 des-ede3-cbc
1.2.840.113549.3.2 rc2-cbc
1.2.840.113549.1.12.10.1.1 keyBag
1.2.840.113549.1.12.10.1.2 pkcs8ShroudedKeyBag
1.2.840.113549.1.12.10.1.3 certBag
1.2.840.113549.1.12.10.1.4 crlBag
1.2.840.113549.1.12.10.1.5 secretBag
1.2.840.113549.1.12.10.1.6 safeContentsBag
1.2.840.113549.1.12.1.1 pbeWithSHA1And128BitRC4
1.2.840.113549.1.12.1.2 pbeWithSHA1And40BitRC4
1.2.840.113549.1.12.1.3 pbeWithSHA1And3-KeyTripleDES-CBC
1.2.840.113549.1.12.1.4 pbeWithSHA1And2-KeyTripleDES-CBC
1.2.840.113549.1.12.1.5 pbeWithSHA1And128BitRC2-CBC
1.2.840.113549.1.12.1.6 pbeWithSHA1And40BitRC2-CBC
1.3.6.1.5.5.7.48.1.1 Basic OCSP Response
1.3.6.1.5.5.7.48.1.2 OCSP Nonce
1.3.6.1.5.5.7.48.1.3 OCSP CRL ID
1.3.6.1.5.5.7.48.1.4 Acceptable OCSP Responses
1.3.6.1.5.5.7.48.1.5 OCSP No Check
1.3.6.1.5.5.7.48.1.6 OCSP Archive Cutoff
1.3.6.1.5.5.7.48.1.7 OCSP Service Locator
1.2.840.113549.1.9.16.1.4 id-smime-ct-TSTInfo
1.2.840.113549.1.9.16.2.12 id-smime-aa-signingCertificate
1.2.840.113549.1.9.16.2.14 id-smime-aa-timeStampToken
1.2.840.113549.1.9.16.2.47 id-smime-aa-signingCertificateV2
2.16.840.1.101.3.4.1.1 aes-128-ecb
2.16.840.1.101.3.4.1.2 aes-128-cbc
2.16.840.1.101.3.4.1.5 id-aes128-wrap
2.16.840.1.101.3.4.1.6 aes-128-gcm
2.16.840.1.101.3.4.1.21 aes-192-ecb
2.16.840.1.101.3.4.1.22 aes-192-cbc
2.16.840.1.101.3.4.1.25 id-aes192-wrap
2.16.840.1.101.3.4.1.26 aes-192-gcm
2.16.840.1.101.3.4.1.41 aes-256-ecb
2.16.840.1.101.3.4.1.42 aes-256-cbc
2.16.840.1.101.3.4.1.45 id-aes256-wrap
2.16.840.1.101.3.4.1.46 aes-256-gcm"
: > extra-names.txt
while read -r dotted name; do
  [ -z "$dotted" ] && continue
  if openssl asn1parse -genstr "OID:$name" -noout -out one.der 2>/dev/null; then
    printf '%s\t%s\t%s\n' "$dotted" "$name" "$(xxd -p one.der | tr -d '\n')" >> extra-names.txt
  else
    printf '%s\t%s\t\n' "$dotted" "$name" >> extra-names.txt
  fi
done <<< "$EXTRA_NAMES"

node -e '
const fs = require("fs");
const [work, here, version] = process.argv.slice(1);
const names = fs.readFileSync(work + "/order.txt", "utf8").split("\n").filter(Boolean);
const LINE = /^\s*(\d+):d=\s*(\d+)\s+hl=\s*(\d+)\s+l=\s*(inf|\d+)\s+(cons|prim):\s*(.*)$/;
const lines = {};
const kept = [];
for (const name of names) {
  const text = fs.readFileSync(work + "/" + name + ".txt", "utf8").split("\n");
  const list = [];
  for (const line of text) {
    const m = LINE.exec(line);
    if (!m) continue;
    list.push({ offset: +m[1], depth: +m[2], headerLength: +m[3], length: m[4] === "inf" ? "inf" : +m[4], constructed: m[5] === "cons", tag: m[6].split(/ {2,}|:/)[0].trim() });
  }
  lines[name] = list;
  kept.push(name);
}
const recordedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const out = ["{", "  \"openssl\": " + JSON.stringify(version) + ",", "  \"recordedAt\": \"" + recordedAt + "\",", "  \"command\": \"openssl asn1parse -inform DER -i\",", "  \"structures\": {"];
kept.forEach((name, i) => {
  out.push("    " + JSON.stringify(name) + ": [");
  lines[name].forEach((l, j) => out.push("      " + JSON.stringify(l) + (j < lines[name].length - 1 ? "," : "")));
  out.push("    ]" + (i < kept.length - 1 ? "," : ""));
});
out.push("  }", "}");
fs.writeFileSync(here + "/asn1parse.json", out.join("\n") + "\n");

const privateNames = new Set(["ec-pkcs8", "ed-pkcs8", "rsa-pkcs8", "ec-encrypted-pkcs8", "ec-p12"]);
const ts = ["// Recorded by make-fixtures.sh with " + version + " at " + recordedAt + ".", "// Each value is the Base64 of one DER file. The keys inside were generated for the recording and thrown away.", "// The files in test/fixtures/openssl/README.md say how to record them again. No armoured private key text is kept here.", "", "export const STRUCTURES: Record<string, string> = {"];
for (const name of kept) {
  const b64 = fs.readFileSync(work + "/" + name + ".der").toString("base64");
  ts.push("  " + JSON.stringify(name) + ": " + JSON.stringify(b64) + "," + (privateNames.has(name) ? " // gitleaks:allow" : ""));
}
ts.push("};", "");
fs.writeFileSync(here + "/structures.ts", ts.join("\n"));

const rows = fs.readFileSync(work + "/extra-names.txt", "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
const decode = (hex) => {
  if (!hex) return null;
  const bytes = Buffer.from(hex, "hex").subarray(2);
  const arcs = [];
  let v = 0n;
  for (const b of bytes) {
    v = (v << 7n) | BigInt(b & 127);
    if (!(b & 128)) {
      if (arcs.length === 0) { const f = v < 40n ? 0n : v < 80n ? 1n : 2n; arcs.push(f, v - f * 40n); } else arcs.push(v);
      v = 0n;
    }
  }
  return arcs.join(".");
};
const entries = rows.map(([dotted, name, hex]) => ({ dotted, name, resolved: decode(hex) }));
const json = ["{", "  \"openssl\": " + JSON.stringify(version) + ",", "  \"recordedAt\": \"" + recordedAt + "\",", "  \"command\": \"openssl asn1parse -genstr OID:<name>\",", "  \"entries\": ["];
entries.forEach((e, i) => json.push("    " + JSON.stringify(e) + (i < entries.length - 1 ? "," : "")));
json.push("  ]", "}");
fs.writeFileSync(here + "/oid-names.json", json.join("\n") + "\n");
console.log("recorded " + kept.length + " structures and " + entries.length + " names with " + version);
' "$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" "$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")" "$VERSION"
