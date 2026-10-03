// Public material only: an RSA 2048 public key and what ssh-keygen printed for it. No private key is committed here.
// Made by make-fixtures.sh (OpenSSL 3.5.5, OpenSSH 10.2p1); see README.md in this folder.

/** SubjectPublicKeyInfo (RFC 5280) of an RSA 2048 key made by `openssl genpkey`, as Base64 of the DER. */
export const RSA2048_SPKI_DER_B64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAscfBS7e2eaOwPLbYFtob+jQ5v7qb/ol050eLn+x54XsFmkQlPKRdtnUyLHSAHRWBvYLOPeQOlHS4hHJrbYMiCgH+2y3Oz8Eun7gLExhFTr9O2wxHfv1prXr7fRm8M0l/xT3P123dosp4pQfuSEXWncL8kznbP+txrwYk6OunDsKTcVJvfpfF/kMAdaCSUBXfpXXtQd9RSyJxreMyExAB+oDAhjTjTfygysXdud/g0j4im7s0z+tviaqJfp4SIeVSBC6jhIyUPaVPykCVq9qJPar7TXo6Dgf/nsDvC3S5EAnRgtCd18yTGQHKUW0PvyIqHfi/Az5BG0XEGOKg7qIGKQIDAQAB';

/** `ssh-keygen -i -m PKCS8 -f <that key as PEM>`: the OpenSSH public line, with no comment. */
export const RSA2048_SSH_LINE =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCxx8FLt7Z5o7A8ttgW2hv6NDm/upv+iXTnR4uf7HnhewWaRCU8pF22dTIsdIAdFYG9gs495A6UdLiEcmttgyIKAf7bLc7PwS6fuAsTGEVOv07bDEd+/Wmtevt9GbwzSX/FPc/Xbd2iynilB+5IRdadwvyTOds/63GvBiTo66cOwpNxUm9+l8X+QwB1oJJQFd+lde1B31FLInGt4zITEAH6gMCGNONN/KDKxd253+DSPiKbuzTP62+Jqol+nhIh5VIELqOEjJQ9pU/KQJWr2ok9qvtNejoOB/+ewO8LdLkQCdGC0J3XzJMZAcpRbQ+/Iiod+L8DPkEbRcQY4qDuogYp';

/** `ssh-keygen -l -E sha256 -f <that line>`, the part after the size. */
export const RSA2048_SSH_SHA256 = 'SHA256:wD5aMJCjf9DOaFX7VSCA/r+vpNbudftVAcw/EMFzGfo';

/** `ssh-keygen -l -E md5 -f <that line>`, the part after the size. */
export const RSA2048_SSH_MD5 = 'MD5:f0:ec:8d:8d:c8:65:ca:00:1f:c4:7d:5d:18:98:bf:85';
