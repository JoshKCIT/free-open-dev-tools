// The first 200 bytes of the output of the two NIST example files for the empty message, SHAKE128_Msg0.pdf and
// SHAKE256_Msg0.pdf, from
// https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/ (fetched 2026-10-03).
// Each file prints 512 bytes after the words Output val is; the text was extracted with pypdf 6.19.0 on Python 3.14.3
// and the hexadecimal bytes copied here in lower case, 40 bytes to a line.
export const NIST_SHAKE128_EMPTY_200 =
  '7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef263cb1eea988004b93' +
  '103cfb0aeefd2a686e01fa4a58e8a3639ca8a1e3f9ae57e235b8cc873c23dc62b8d260169afa2f75' +
  'ab916a58d974918835d25e6a435085b2badfd6dfaac359a5efbb7bcc4b59d538df9a04302e10c8bc' +
  '1cbf1a0b3a5120ea17cda7cfad765f5623474d368ccca8af0007cd9f5e4c849f167a580b14aabdef' +
  'aee7eef47cb0fca9767be1fda69419dfb927e9df07348b196691abaeb580b32def58538b8d23f877';
export const NIST_SHAKE256_EMPTY_200 =
  '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200' +
  'cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be141e96616fb13957692cc7edd0b45ae3' +
  'dc07223c8e92937bef84bc0eab862853349ec75546f58fb7c2775c38462c5010d846c185c15111e5' +
  '95522a6bcd16cf86f3d122109e3b1fdd943b6aec468a2d621a7c06c6a957c62b54dafc3be87567d6' +
  '77231395f6147293b68ceab7a9e0c58d864e8efde4e1b9a46cbe854713672f5caaae314ed9083dab';
