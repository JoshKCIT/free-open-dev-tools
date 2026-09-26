# Upstream: yannh/kubernetes-json-schema

- Repository: https://github.com/yannh/kubernetes-json-schema
- Commit: a6f9a32d2ccb64b6e4f5b41419b9c2e8ee0cce18
- Fetch date: 2026-09-26
- Licence: Apache License, Version 2.0 (see `LICENSE` in this folder)

The OpenAPI-derived JSON Schemas for Kubernetes v1.35.0, generated daily by this
repository's own GitHub Actions workflow from the Kubernetes OpenAPI specification
using a fork of `yannh/openapi2jsonschema` (see `test/build-schema-subset.ts` for
the transformations `src/k8s-schema-subset.ts` applies on top of these files).

`v1.35.0/` is the non-standalone variant: each per-kind file is small (2-3 KB) but
`$ref`s an absolute `https://raw.githubusercontent.com/...` URL into the shared
`_definitions.json`. `v1.35.0-standalone-strict/` is the self-contained,
`additionalProperties: false`-everywhere variant used here only as a differential
oracle for three kinds (Task 2); it is never bundled into the shipped subset.

## Files

- LICENSE: 1a8e111b8998ea9fb59429bded847757942b8708
- v1.35.0-standalone-strict/configmap-v1.json: fd830aaa1fc2abb89c7cffcb3aac1d56fe590758
- v1.35.0-standalone-strict/deployment-apps-v1.json: 111b9a094f67bf042fdd5c86f5455dfa4acf7ac3
- v1.35.0-standalone-strict/service-v1.json: 328480b7166fa46fd6801e92d9959eb318729ad0
- v1.35.0/_definitions.json: 4ca8bd0e2b7fd189d7894e3ba930eb0d8f1c38da
- v1.35.0/configmap-v1.json: 8a0ec1621a384f267dbbf4f8d67faafd2e0061e6
- v1.35.0/cronjob-batch-v1.json: 27375f89082b15a1f2595d5aab6ebe4d3764fa21
- v1.35.0/daemonset-apps-v1.json: 32f3b8be6f0bdaa39c63da583fa30db3b1582dac
- v1.35.0/deployment-apps-v1.json: a7cd81baf04522005b1e95506a0f20d885ea53f3
- v1.35.0/ingress-networking-v1.json: 16e92a2b9aa1eeab37ab12adc5419c54b02946b5
- v1.35.0/job-batch-v1.json: e95c1195fcb4eb53e4874d73fdcacd38f0cdd5f7
- v1.35.0/namespace-v1.json: dc5e47c36980eb6fa413827ca38eff9cb07032f0
- v1.35.0/persistentvolumeclaim-v1.json: 75a199ad773c1e51c8cd48ecd046b3aaf798dab2
- v1.35.0/pod-v1.json: 07efef825b4cb4af8320138e7173209c6a226a77
- v1.35.0/secret-v1.json: b3e58a22c71465405268954a2c8baf1d0c4d2a0a
- v1.35.0/service-v1.json: 1ba9998d0528d711de4fd56b5bc0e72547ff5e0c
- v1.35.0/statefulset-apps-v1.json: b5fc0756dafa84ce503b117af0753d7e841843e2
