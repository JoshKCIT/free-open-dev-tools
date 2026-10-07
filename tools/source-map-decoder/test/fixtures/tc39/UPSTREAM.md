# tc39/source-map-tests, as vendored here

This folder holds the parts of the source map test suite that the decoder tests run, copied byte for byte.

- Repository: https://github.com/tc39/source-map-tests
- Commit: 9ea66b466fd37e8a4050033d23b3e1480973c3dc ("Update scopes proposal decoding tests (#42)", committed 2026-09-28T04:56:04Z)
- Fetched: 2026-10-06 (the tree listing was checked again on 2026-10-07 with `gh api repos/tc39/source-map-tests/git/trees/<commit>?recursive=1`)
- Licence: BSD 3-clause, Copyright (c) 2024 Ecma International; the text is in `LICENSE.md` next to this file
- Not vendored: everything under `resources/proposals/`, the `.js` generated files, the patches and the decoding goldens

The suite holds 99 test cases over 99 map files; 100 map files are vendored, which includes the intermediate map of the two-step transitive case.

## Files and their git blob sha

The blob sha is what `git hash-object <file>` prints for the file, which is also what the upstream tree lists at that commit.
A test recomputes each one, so no byte can drift.

| File | Blob sha | Bytes |
| ---- | -------- | ----- |
| source-map-spec-tests.json | 602ba8dbd7270a7b4980cff2ad46468e696af3b8 | 57480 |
| LICENSE.md | 39501a3b7c70dd44a41ef3eb86c9a5deca2aa4ef | 2228 |
| resources/basic-mapping-as-index-map.js.map | c0ad870ed2baec6f42e15873a07d9c4a7494468a | 352 |
| resources/basic-mapping.js.map | 12dc9679a4b1db94528673efe069fc0d0db019ea | 168 |
| resources/file-not-a-string-1.js.map | 85e973d881dfbf66c435eb553207e92742020b97 | 129 |
| resources/file-not-a-string-2.js.map | a5b6b1f9d94fc3bcc7fd9fbe92a7d93c24e84d26 | 133 |
| resources/ignore-list-empty.js.map | 7297863a9be8ef7e4ea71df282497d300a6d6922 | 135 |
| resources/ignore-list-out-of-bounds-1.js.map | fb2566bb419b984f29706145f7677ec39e80e5a6 | 136 |
| resources/ignore-list-out-of-bounds-2.js.map | 41371a76a896631a05e0839ad8fa7484b3c3f07b | 137 |
| resources/ignore-list-valid-1.js.map | 98eebdf7f65598bee672987f030070264a518d5d | 136 |
| resources/ignore-list-wrong-type-1.js.map | 688740aba843fc0bfb61370289a79f1d3532fe8e | 149 |
| resources/ignore-list-wrong-type-2.js.map | ca1d30de2d3626488dc50af2f5fa449ae233d433 | 138 |
| resources/ignore-list-wrong-type-3.js.map | 1ac167d56c4e74044929b11b316a57bf85051ac4 | 134 |
| resources/ignore-list-wrong-type-4.js.map | c1a27efe980dd436c77f1cf253e99bc73156b1c7 | 138 |
| resources/index-map-empty-sections.js.map | f3efabbe00c395327df65f6013589cb3af29ff34 | 37 |
| resources/index-map-file-wrong-type-1.js.map | dd39b5a2b13c19a1881cbe8eade9e34cfdbfd6ea | 323 |
| resources/index-map-file-wrong-type-2.js.map | 0ee0a406be8d604b25885a14a12da55d273bc696 | 331 |
| resources/index-map-invalid-base-mappings.js.map | 4ad1fefe65097b21f408413c4c58a386eda18b30 | 285 |
| resources/index-map-invalid-order.js.map | 74e0c1d052c4bcaf558bbaac40f456e5c1d1f81c | 491 |
| resources/index-map-invalid-overlap.js.map | 3c08cb7beb59d9e586a864b2f9f8c42ef0eb417f | 491 |
| resources/index-map-invalid-sub-map.js.map | 4020ae30c5765b0e9bb4407bb7db38262b82d72f | 207 |
| resources/index-map-missing-file.js.map | 8a6d4b5dc788006471639938e980e3cd384f887a | 309 |
| resources/index-map-missing-map.js.map | 3bce47e852cfec363763659799c0ca8173ab4493 | 95 |
| resources/index-map-missing-offset-column.js.map | ae27aa5e62c72d6fdbac4c654e21275f54ada1ca | 251 |
| resources/index-map-missing-offset-line.js.map | 7b128e96b0b7cb05b3498886d431d466a87e04a2 | 252 |
| resources/index-map-missing-offset.js.map | 7737595d848cd60cba573f4f71acb636669d86ce | 219 |
| resources/index-map-offset-column-wrong-type.js.map | 6ea11758c1e44861aa3ee53b7ca835bf8d3ac98e | 266 |
| resources/index-map-offset-line-wrong-type.js.map | d48b2f43f16b21779c6f6cf9b87bd254a754d85b | 266 |
| resources/index-map-two-concatenated-sources.js.map | f67f5de3c5d8c39a8f9dcf60745d89f372281769 | 592 |
| resources/index-map-wrong-type-map.js.map | 0963f623d761a9dc433a68582ae94110fd7baf25 | 121 |
| resources/index-map-wrong-type-offset.js.map | 645278c3b4755a69d952fc667ced1c3d6663ac9f | 252 |
| resources/index-map-wrong-type-sections.js.map | dbfb4ead3001fb8fc7d7f576e2c0f3b419fa0e85 | 56 |
| resources/invalid-mapping-bad-separator.js.map | 5f4f5b92330a6ba34ab060dc0b1e99edaf758858 | 122 |
| resources/invalid-mapping-not-a-string-1.js.map | 73d74bef42e20273748512ce6eba5956caab58ad | 160 |
| resources/invalid-mapping-not-a-string-2.js.map | 3143cbce170b9eb8b6ec0f0152d87798a563d454 | 171 |
| resources/invalid-mapping-segment-column-too-large.js.map | 96b3ce97dcb271d7936db4e3b63db3ef44e86a55 | 178 |
| resources/invalid-mapping-segment-name-index-out-of-bounds.js.map | 3efb8da9abbaa64010acc39af4492be78033008a | 189 |
| resources/invalid-mapping-segment-name-index-too-large.js.map | 1d44bb8300f7c0e4b9afdf1823f52154f8720e07 | 186 |
| resources/invalid-mapping-segment-negative-column.js.map | bb7e887dc05f4adce95a9c79e8f9e5749eda46e5 | 171 |
| resources/invalid-mapping-segment-negative-name-index.js.map | 5197ab23b1d2cd458501369fe9eafabf030a368e | 179 |
| resources/invalid-mapping-segment-negative-original-column.js.map | 4a76cb3e390636b244d977efcd067eb1b2904a14 | 183 |
| resources/invalid-mapping-segment-negative-original-line.js.map | 40170361b5ddf88c4c5441f0e671210c29ab1ec8 | 181 |
| resources/invalid-mapping-segment-negative-relative-column.js.map | 414884072b55a50b3111e79fc17e3030201f4219 | 182 |
| resources/invalid-mapping-segment-negative-relative-name-index.js.map | 1fbbcfcd323e5f8e8f5a9f7c01716490da6e31ea | 194 |
| resources/invalid-mapping-segment-negative-relative-original-column.js.map | 7e62895651fa306faa0b9b2b8a4b82524c74e0c1 | 197 |
| resources/invalid-mapping-segment-negative-relative-original-line.js.map | 86b0fb3a04cc3d4271995e05a43a8f905c0abf71 | 195 |
| resources/invalid-mapping-segment-negative-relative-source-index.js.map | 2efeb047db618eb305a9c02600a85675cb88f580 | 194 |
| resources/invalid-mapping-segment-negative-source-index.js.map | ed835d8007ca68be99c03662b5fdca322bc29bd0 | 180 |
| resources/invalid-mapping-segment-original-column-too-large.js.map | 8dee1df731c2412296f081c5dec610d0070fbeeb | 190 |
| resources/invalid-mapping-segment-original-line-too-large.js.map | 8ee6fea9c8350a81633a682ea3a32f10621a5852 | 188 |
| resources/invalid-mapping-segment-source-index-out-of-bounds.js.map | fec001a67329e8104a8baa99ed2ea8174b59efb2 | 185 |
| resources/invalid-mapping-segment-source-index-too-large.js.map | 555489fa65701fe7b3551ea4f4b8c25385f3454f | 187 |
| resources/invalid-mapping-segment-with-three-fields.js.map | c2af1165ad8f1f8c7e75de13a5f7fb57a8cdae3b | 110 |
| resources/invalid-mapping-segment-with-two-fields.js.map | 73cf00fa1c960672e3f33044a0cacfef44c80b70 | 109 |
| resources/invalid-mapping-segment-with-zero-fields.js.map | fb8e7cff64c3760c05a3a34561a36b2c585e449a | 175 |
| resources/invalid-vlq-missing-continuation.js.map | dd0e363ff473544152ee5bd1a3c5e0cb29189063 | 71 |
| resources/invalid-vlq-non-base64-char-padding.js.map | b439caabc881436e38abd5c929276791d2634d11 | 119 |
| resources/invalid-vlq-non-base64-char.js.map | 4fa1ac5768853edfe8f688cacbe073f8a93c65c9 | 75 |
| resources/mapping-semantics-column-reset.js.map | 97bc9b91a43d51213cfcc6ce2a50e7a21b68fe51 | 156 |
| resources/mapping-semantics-five-field-segment.js.map | d0504f511dad2d6552be177e2c3bf0312c10eb10 | 178 |
| resources/mapping-semantics-four-field-segment.js.map | 9e01ac4b6c58f8780cb74b1a74bee4df660d20d0 | 172 |
| resources/mapping-semantics-relative-1.js.map | 6570031f8983f42d35d6040826fe24d35567f294 | 167 |
| resources/mapping-semantics-relative-2.js.map | d6845233f9120700b8a7731b4d1d4e240b4db981 | 186 |
| resources/mapping-semantics-single-field-segment.js.map | 8260d63085d79b268c77cee4c512512f3ec04b2f | 156 |
| resources/mappings-missing.js.map | 7a60084729612d1bb60f20a878a6dd405b11e616 | 100 |
| resources/names-missing.js.map | 475f4e309b2641ebd022996a2a65abf04ac51154 | 101 |
| resources/names-not-a-list-1.js.map | fe1edaeb96ad90d8448c7e905a2010fc5875dedf | 96 |
| resources/names-not-a-list-2.js.map | 3388d2bb7109d008e015f45dd0ceb69c25a22aef | 96 |
| resources/names-not-string.js.map | c0feb0739aecff0a3a8659c8ade6221c9ca67f17 | 114 |
| resources/source-resolution-absolute-url.js.map | 195dc42ecea39994bad7dbd3cf61b7dba6818970 | 279 |
| resources/source-root-not-a-string-1.js.map | e297f5c03e509692bb7df6ba17314d200e648d48 | 135 |
| resources/source-root-not-a-string-2.js.map | d5705ebfb8e982bd3797a17a7ebc84421554eabc | 142 |
| resources/source-root-resolution.js.map | 52fc9a23793f7c23adfa2b82f4bc93b914737467 | 297 |
| resources/sources-and-sources-content-both-null.js.map | 09a7c1f3698ce61b6c03037afd41e983e9854e4b | 115 |
| resources/sources-content-missing.js.map | fa7922f5c783fe59893200958784ec6801bb5b6d | 102 |
| resources/sources-content-not-a-list-1.js.map | 3710f95111b75540aeac087bd3739b8c3bc6592d | 124 |
| resources/sources-content-not-a-list-2.js.map | ab9ae257c1f9e4f7f014b79c99bc10ec8ec4398c | 131 |
| resources/sources-content-not-string-or-null.js.map | 6e6c2517150b963aa6a71ef47fdc52b084686751 | 164 |
| resources/sources-missing.js.map | 92aff4fb0e74b187c9bbaf4be51badc49dbeaeb9 | 58 |
| resources/sources-non-null-sources-content-null.js.map | e573906b2d7144718633028302cf7daaf3999a6f | 138 |
| resources/sources-not-a-list-1.js.map | 26330517b9884f5cbfcbde580aca298f01f52ccb | 90 |
| resources/sources-not-a-list-2.js.map | 2ed85962fddf31c6782a07eaa803b4685766f82c | 96 |
| resources/sources-not-string-or-null.js.map | db25561966056dad1b942bd251319ec2748dab3c | 102 |
| resources/sources-null-sources-content-non-null.js.map | 43af03903f64f8d83b2cc545ef3ddde0779b8590 | 191 |
| resources/transitive-mapping-original.js.map | 65af25c1ebbe4cd767388fd6a702f97dff14ccf1 | 243 |
| resources/transitive-mapping-three-steps.js.map | 90459d90f6a0ea7dace9da38f7ad05cf394b031a | 198 |
| resources/transitive-mapping.js.map | d6a6fa6672d4832d201747a7caf7e4b04d6f6df0 | 152 |
| resources/unrecognized-property.js.map | 40bee558a4ff92d0327aeff58b08ff1792ace9b3 | 120 |
| resources/valid-mapping-boundary-values.js.map | 39943bc891655e5119847d5d7fa59308a991d770 | 188 |
| resources/valid-mapping-empty-groups.js.map | 643c9ae78481a9f4bc7c23f27d80193932aba9f3 | 217 |
| resources/valid-mapping-empty-string.js.map | a35268d8f5b88b3d02c1ede05da9f036f57444dc | 157 |
| resources/valid-mapping-large-vlq.js.map | 76e18704c4b1a2b1146a5f1f40dc5bfe5929e291 | 2084 |
| resources/version-missing.js.map | 49d8ce766edb9f54defcca5a8f2a218fc2f68cdf | 53 |
| resources/version-not-a-number.js.map | a584d6e6951171330e661038e35c0e907c118611 | 75 |
| resources/version-numeric-string.js.map | dbe52a7d0df69ab936116f343748ab5488758f2a | 72 |
| resources/version-too-high.js.map | ee23be32ff278fe43f470be8abb132e0683ee44e | 70 |
| resources/version-too-low.js.map | 64ca7a6e2e928242f3be960bc637790e9da2da5b | 70 |
| resources/version-valid.js.map | 1a163052d8fc86faaf0701bd2da4f8c717282e56 | 70 |
| resources/vlq-valid-continuation-bit-present-1.js.map | f4acb4b418375497b33ffa5db72d17c3d062431b | 157 |
| resources/vlq-valid-continuation-bit-present-2.js.map | a975cf8591ff6d1cf964f3fc106ff1b9a1504cda | 156 |
| resources/vlq-valid-negative-digit.js.map | 71dec0d65a1aa906516e4b47a0dabe35860ae3ab | 150 |
| resources/vlq-valid-single-digit.js.map | 9e35a7a0a6a591a45f836311003d8e741a0e560e | 136 |
