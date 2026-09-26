# Upstream: SchemaStore/schemastore

- Repository: https://github.com/SchemaStore/schemastore
- Commit: 314154a4c71665df725986ad334f6f0846d486d3
- Fetch date: 2026-09-26
- Licence: Apache License, Version 2.0

`github-workflow.json` here is `src/schemas/json/github-workflow.json` at the commit above.
`test/github-workflow/*.yaml` here is `src/test/github-workflow/*.yaml` at the commit above (40
files SchemaStore itself asserts validate). `negative_test/github-workflow/*.yaml` here is
`src/negative_test/github-workflow/*.yaml` at the commit above (23 files SchemaStore itself
asserts are rejected).

## Files

- github-workflow.json: aee6350228d70404c08fdbc4574297c7bd37b9aa
- LICENSE: d645695673349e3947e8e5ae42332d0ac3164cd7
- negative_test/github-workflow/all-steps-must-contain-run-or-uses.yaml: 2febfb2acfb852534c01a0aa213f0fff8eddd715
- negative_test/github-workflow/bad_pull_request_event_declaration.yaml: 2ff5e8ea324574f5b396e6352ba6828f3e1a4127
- negative_test/github-workflow/cache-mode-invalid.yaml: f509336d918aaa6759449ec335dd3d38fc70ef04
- negative_test/github-workflow/container-command-is-invalid.yaml: f8b0c0ec72140e06a3fd3ec0b49de09afb5235a5
- negative_test/github-workflow/container-entrypoint-is-invalid.yaml: 1930caa846514a669561eaa6d9a540fe41e9654d
- negative_test/github-workflow/empty_json_must_always_fail.yaml: c5a1c5014abc8787ddd7fbded4253a8719cddb6d
- negative_test/github-workflow/env-must-be-object-or-has-from-json.yaml: 20a79db7faa91392896cef0b2fa4aa352634014d
- negative_test/github-workflow/issue-comment-invalid-type.yaml: 18eee103a32e13da8bb8aaf61cbaa43c42ea8f96
- negative_test/github-workflow/permissions-event-has-wrong-level.yaml: 91e073c739adbcface2a9a601af4b5933c8a2325
- negative_test/github-workflow/permissions-event-has-wrong-property-keys.yaml: 1fdb2dbe8f5388ba74bd2acd73daf19998afaae3
- negative_test/github-workflow/permissions-id-token-read.yaml: a16f0bcd8c32d454c97cd63496d46753b9c8108f
- negative_test/github-workflow/permissions-job-id-token-read.yaml: 6bcb6281cc6081d43ba067eecfc8401c1b1f9609
- negative_test/github-workflow/permissions-must-be-object-or-string.yaml: 8e67ed53fced5e1a4cf3d1c8bf82cc85263ff1df
- negative_test/github-workflow/permissions-string-is-not-from-enum.yaml: e183746e87cc65f96edf5d8cb5fa4d33c78843df
- negative_test/github-workflow/reusable-workflow-input-must-declare-type.yaml: e5ed9cd39a36f97b95eb0eba0b214bd8d5135898
- negative_test/github-workflow/reusable-workflow-uses-has-wrong-filetype.yaml: ac233bca15d0b673e29a70976d9dec0da3bd2603
- negative_test/github-workflow/reusable-workflow-uses-has-wrong-pattern.yaml: 3cb4b4982d5232c90884a2ff86e4a97e2ecfa1c7
- negative_test/github-workflow/runs-on.yaml: 71c4cb6bbbffdfc24c9708c37abf0c607591a9f9
- negative_test/github-workflow/steps-must-contain-run-or-uses.yaml: 251204211f2e689faddf7d4ae21a42ccb786ea60
- negative_test/github-workflow/with-must-be-object-or-has-from-json-copy.yaml: 43a94ee3bd0c4253168f5986c61a7ffdfc24699a
- negative_test/github-workflow/workflow_dispatch-inputs-bool-default-.yaml: f7c2a0d5ba1a12ea5b5975e2bad9284c3f293d4e
- negative_test/github-workflow/workflow_dispatch-inputs-choice-without-options.yaml: 6fc90791444f79f3806b0e82d74387fda59e710b
- negative_test/github-workflow/workflow_dispatch-inputs-string-default-bool.yaml: 9fa5d3e471bc8cdfb5d326fc9077dfb6361fe263
- test/github-workflow/1162.yaml: f97a3ad31144aa34341778fcbd53b3d47201bbd6
- test/github-workflow/1567.yaml: 36bf190a3a3867d02120da5dfb2e34daf53a48c7
- test/github-workflow/2579-1.yaml: 3869992de1bb65926c104c9f789b81dde5ff4b02
- test/github-workflow/2579-2.yaml: d58efecdf90d3d12d42cb1f11528f31b712dc409
- test/github-workflow/918.yaml: b5b9b031a9f45b473482e6d084d17bcdde66161b
- test/github-workflow/919.yaml: b251368bdfcd25bdefcf11a80b49b8eb847a8cca
- test/github-workflow/cache-mode.yaml: 29d6d6af726c1e128dd26525504f6bf664ec1a94
- test/github-workflow/call-reusable-workflow-inherit-secrets.yaml: f5cf8b24ee6a9e52845bb5afa05e6287f5f9ba30
- test/github-workflow/call-reusable-workflow-local-file.yaml: b32d7bbe6aee979c6b37e69e5ad022ef3ef4e306
- test/github-workflow/call-reusable-workflow.yaml: 59cd2f53802746bf70775d13139b3fc7f2af622d
- test/github-workflow/concurrency.yaml: 70d9bf35b109ff1d3c25359d5a09f35b1d91c8ca
- test/github-workflow/conditions.yaml: 41d66414ffd3dc40fb1eaa07a6f7e47fbe4cc4f3
- test/github-workflow/containers.yaml: 06780df2489d51e002559ff1a350edab31a07cd6
- test/github-workflow/continue-on-error.yaml: b917331ed52c0a43a8fbc32278c721dc4014b65a
- test/github-workflow/defaults.yaml: a9339b77ba15c9f8cfd25e59032e6bcb6e974743
- test/github-workflow/env-from-json.yaml: 3502e97b9f4382932f79919f57021e4f944dfaf6
- test/github-workflow/env-with-simple-expression.yaml: af684e7d1491525356d3ffd2b3a913a7551e8000
- test/github-workflow/environments.yaml: 56d8ed60674c54ccd17f8425a269f261ce6dc4d3
- test/github-workflow/event-trigger.yaml: abf56513658e04fce3e8b84f22e36e5aacb19240
- test/github-workflow/fail-fast.yaml: ec16cb0ea7c1b6948d0685ecea1dbf80882a088e
- test/github-workflow/issue_2463_file_1.yaml: 1e549ff2c18cb3282836f948d7420d2fb77cfec8
- test/github-workflow/issue_2463_file_2.yaml: 0a63441576bceee6a2ac7b28afed542af0259814
- test/github-workflow/issue-3208.yaml: 41548293ab8dcfac4d0c5c1f7a2ed0d7216d938a
- test/github-workflow/issues-activity-types.yaml: 894350d13cafb591cba9ffa974722a1efcc84f4c
- test/github-workflow/matrix_from_json.yaml: 75c17e82c50d81d184787354abe166b9c2a39604
- test/github-workflow/matrix_include_expression.yaml: 09f7616ae52ee0aa38b6948ab844fc502a28a586
- test/github-workflow/matrix_include.yaml: bdc1cc88c016492ac97393ad2f64da1ccb012d29
- test/github-workflow/npm-publish.yaml: 93e58d70f694f4866d4e81220ccef59e40187992
- test/github-workflow/on-event_name-null.yaml: 402a714b96afdb3eddcc53a536e302ccac7700f6
- test/github-workflow/parallel-steps.yaml: 1d3ef54953df29a8b20b5754a6300f7b88bf3d49
- test/github-workflow/permissions-id-token.yaml: a531015bd70ee1d0c1b4dec051fa9acd4513ff72
- test/github-workflow/permissions-none.yaml: 5a39864b1fdabf0ca4c7f77ad5d44ca6f5a8d07b
- test/github-workflow/permissions-object.yaml: 940ded12c21e9349cb8003fb80f73a2f57f5b301
- test/github-workflow/permissions-string.yaml: f7d6e0226d85d12f4b424b67d725fce41868ce34
- test/github-workflow/reusable-workflow.yaml: 44d483cb82988f1710da0eb7aa912b23b56b1e8e
- test/github-workflow/runs-on-interpolated.yaml: a7c183154228675aee67a31b63425f7db0ac1129
- test/github-workflow/runs-on.yaml: 4222529795a85d74622d32b04dd683ac888d2e4a
- test/github-workflow/with-from-json.yaml: d51f820d274ed1a67d83518347e25f2850554b8f
- test/github-workflow/workflow_call_input_issue_2501.yaml: 31d9c84136e109b8f059f0fdb5ea78fc54b0cafa
- test/github-workflow/workflow_dispatch-inputs.yaml: 22e49ddf86c112a7d23dfc8eda754311cde95ad5
