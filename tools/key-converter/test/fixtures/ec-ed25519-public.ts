// Public material only: ECDSA and Ed25519 public keys and what ssh-keygen printed for them. No private key is committed here.
// Made by make-fixtures.sh (OpenSSL 3.5.5, OpenSSH 10.2p1); see README.md in this folder. The Ed25519 key was made by
// ssh-keygen itself, and its SubjectPublicKeyInfo is the RFC 8410 section 4 prefix in front of its 32 byte key.

export interface PublicFixture {
  /** SubjectPublicKeyInfo (RFC 5280) as Base64 of the DER. */
  spkiB64: string;
  /** The OpenSSH public line with no comment, as ssh-keygen wrote it. */
  sshLine: string;
  /** What `ssh-keygen -l -E sha256` printed after the size. */
  sha256: string;
  /** What `ssh-keygen -l -E md5` printed after the size. */
  md5: string;
}

export const P256_PUBLIC: PublicFixture = {
  spkiB64: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7w3uLzWTmPVgrwsuCANYX1dNejH41qMnOCMVTpnnYktTluiSEdWgSC1E5veCgoS/a9r2Qh0uV+Gfc+W8qiaFlw==',
  sshLine: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBO8N7i81k5j1YK8LLggDWF9XTXox+NajJzgjFU6Z52JLU5bokhHVoEgtROb3goKEv2va9kIdLlfhn3PlvKomhZc=',
  sha256: 'SHA256:0VhYZkclFJ9Zsjn0N5e6AgOURuwvkG0FxWj62E399XY',
  md5: 'MD5:54:dd:3f:bc:96:00:c1:eb:28:40:fb:e9:d8:e5:5d:f2',
};

export const P384_PUBLIC: PublicFixture = {
  spkiB64: 'MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE+FuCDAygv1JbEpo/ncmIIU9YGX/If4DmTlGRBLSCd4+TV64pZiF4I3Znb8T8017JmNhYaTEDGGpfSWe4eSABJ6jPA3UlLhIRgKG7ezrySn07sy+qpbBCzhb6OL6hamqS',
  sshLine: 'ecdsa-sha2-nistp384 AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBPhbggwMoL9SWxKaP53JiCFPWBl/yH+A5k5RkQS0gnePk1euKWYheCN2Z2/E/NNeyZjYWGkxAxhqX0lnuHkgASeozwN1JS4SEYChu3s68kp9O7MvqqWwQs4W+ji+oWpqkg==',
  sha256: 'SHA256:zskKh2t1ElGiGJYyQGshVtTgSKyrrejpXUAw2iUEBk4',
  md5: 'MD5:62:04:71:d3:0f:78:02:9e:d7:07:70:e2:d4:ac:e0:c4',
};

export const P521_PUBLIC: PublicFixture = {
  spkiB64: 'MIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBZfTM9SlH92aXYVxFJ639lkOIvhWi2VTuMX0QbuCxZBBAVyXZmR6egw4fZs4vbqGVBph/3JjPRrIxkAOVDb0a4i0AKFds4Rq8qIKPuWIPGgKvuf67VMNgG8n0sCKliag69ecsXAWPQL4gmyCZELZKLBFU8DJIp2XPKEMuj97G8QtpAp8=',
  sshLine: 'ecdsa-sha2-nistp521 AAAAE2VjZHNhLXNoYTItbmlzdHA1MjEAAAAIbmlzdHA1MjEAAACFBAFl9Mz1KUf3ZpdhXEUnrf2WQ4i+FaLZVO4xfRBu4LFkEEBXJdmZHp6DDh9mzi9uoZUGmH/cmM9GsjGQA5UNvRriLQAoV2zhGryogo+5Yg8aAq+5/rtUw2AbyfSwIqWJqDr15yxcBY9AviCbIJkQtkosEVTwMkinZc8oQy6P3sbxC2kCnw==',
  sha256: 'SHA256:f6d7pAJl1P+U9xP3wWSeIpE7n1Y0IaUBpSYonyBLoLE',
  md5: 'MD5:39:19:5e:9b:41:6a:fb:36:ef:f6:ca:a3:10:0e:65:ab',
};

export const ED25519_PUBLIC: PublicFixture = {
  spkiB64: 'MCowBQYDK2VwAyEAn8tfiIZjqnV8rPFo6eVPyRQI0d5HK+8/vTexS+QyRt0=',
  sshLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ/LX4iGY6p1fKzxaOnlT8kUCNHeRyvvP703sUvkMkbd',
  sha256: 'SHA256:WPhOSa+Y9exM9OGbk5R7fm7eKNNnd5mnaPSic1E124Q',
  md5: 'MD5:29:cd:67:ca:d6:71:23:96:8f:73:2b:1e:9a:6c:74:04',
};
