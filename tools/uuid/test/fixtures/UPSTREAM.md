# Upstream files used to check the identifier formats

These files are copied byte for byte with `curl -fsSL` from the addresses below on 2026-10-04. They are test data only:
they are never shipped with the page and never edited. The tests check each one against the git blob SHA and SHA-256
recorded here, so a changed byte fails a test. Both repositories are licensed MIT; each folder holds its licence text.

## KSUID reference implementation (MIT, Copyright (c) 2017 Segment.io)

Repository `segmentio/ksuid`, commit `d33724947fcfba7949906c2b1821e96a1c8d06e7` (2023-10-04, the newest commit on its default
branch on the fetch date).

- `ksuid/README.md`: https://raw.githubusercontent.com/segmentio/ksuid/d33724947fcfba7949906c2b1821e96a1c8d06e7/README.md
  (10,422 bytes, blob `0f21345219d86d1e1f8435d0f86dd55bc22e21d5`, SHA-256
  `9a8d6bd72ff5d7b611b3e9469c28747485ea051c49bc37b0a09794b9b4e30103`). It holds the published examples the tests decode.
- `ksuid/ksuid.go`: https://raw.githubusercontent.com/segmentio/ksuid/d33724947fcfba7949906c2b1821e96a1c8d06e7/ksuid.go
  (8,975 bytes, blob `79bbe5629c1d3dba2e2c8dd53d54539e6ad7e1f9`, SHA-256
  `ccdd2f4f6f0e07f8f764cfd7ecda49132c0c2faab165771f3f0d4cdbfb48247d`). It holds the epoch 1400000000, the 27 character
  length and the largest accepted string `aWgEPTl1tmebfsQzFP4bxwgy80V`.
- `ksuid/LICENSE.txt`: https://raw.githubusercontent.com/segmentio/ksuid/d33724947fcfba7949906c2b1821e96a1c8d06e7/LICENSE.md
  (1,067 bytes, blob `aefb79318943a645a0aaa8909c97b616b7727ae8`, SHA-256
  `4b49998660abb6ea23d6e9d6353e56480e31710aa1e4bb3ea2664b3d58211d5b`).

## NanoID (MIT, Copyright 2017 Andrey Sitnik)

Repository `ai/nanoid`, commit `bb68abcd59ebb86a849d634320726add6be54d47` (2026-09-23, package version 6.0.1).

- `nanoid/README.md`: https://raw.githubusercontent.com/ai/nanoid/bb68abcd59ebb86a849d634320726add6be54d47/README.md
  (13,655 bytes, blob `9a91f0705ba49e8e299977ea267eb33aa3051d17`, SHA-256
  `7ed8e93357f1084880d0804b6e30ea398e00ddc116824c9953a42a8ffcef2636`). It states the default size 21 and the example id.
- `nanoid/url-alphabet.js`: https://raw.githubusercontent.com/ai/nanoid/bb68abcd59ebb86a849d634320726add6be54d47/url-alphabet/index.js
  (604 bytes, blob `423532e103a006a10ce41fcfc62ff2804aa88ab0`, SHA-256
  `679b6b3d0d01525d2e490362d0d071acf65b4e34213eb15566082d2b5af55d66`). It holds the 64 character URL alphabet.
- `nanoid/LICENSE.txt`: https://raw.githubusercontent.com/ai/nanoid/bb68abcd59ebb86a849d634320726add6be54d47/LICENSE
  (1,095 bytes, blob `b2e78ae87460b8ffaa39286084e2dddc9261ca21`, SHA-256
  `4383cb2c3608397ce7a4159502614ed66890f8999c2a9c056dd3b1024d6721f0`).

## Not vendored, quoted as literals in the tests with their address

- The ULID specification, https://github.com/ulid/spec (README at commit `d0c7170df4517939e70129b4d6462cc162f2d5bf`, blob
  `509c4eb139df858e055a7b79c97e276c8dc7e8e6`): that repository is licensed GPL-3.0, so its text is not copied into this
  repository. The tests quote only the published values (the example `01ARZ3NDEKTSV4RRFFQ69G5FAV`, the largest value
  `7ZZZZZZZZZZZZZZZZZZZZZZZZZ` and the monotonic example pair) and say where each came from.
- The MongoDB ObjectId reference page, https://www.mongodb.com/docs/manual/reference/method/ObjectId/ (layout: a 4-byte
  timestamp in seconds, a 5-byte random value, a 3-byte counter, big-endian; example `507f1f77bcf86cd799439011`).
- The Wikipedia article https://en.wikipedia.org/wiki/Snowflake_ID (layout: one zero bit, 41 bits of milliseconds since a
  chosen epoch, 10 machine bits, 12 sequence bits; one worked example with its epoch 1288834974657).
