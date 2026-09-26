# Upstream: actions/starter-workflows

- Repository: https://github.com/actions/starter-workflows
- Commit: e3c451d60f119b71caebf13c98ac45da6e15b4b7
- Fetch date: 2026-09-26
- Licence: MIT

Fourteen real-world workflow files vendored from three category folders, flattened into this
directory with the category folded into the file name (`ci/node.js.yml` becomes
`ci-node.js.yml`). Several of these files carry GitHub's own starter-workflow template
placeholders (`$default-branch`, `$protected-branches`, and codeql-specific ones); the test
substitutes `main` for `$default-branch` and `$protected-branches` before validating, and says so
in a comment, since a bare `$default-branch` is what "Set up this workflow" writes before GitHub's
own UI resolves it to the repository's real default branch.

## Files

- LICENSE: d4528d7eea310fb9fbb03479fd12b8e3917032a6
- ci-node.js.yml: d5ccc1494a2ffce6ef899211c3bcf19401fb8a13
- ci-python-app.yml: 5963096c330dadbbf5053f88567c13f6cacb105f
- ci-go.yml: 215474073318517ed321606f9638de0d7fa94f54
- ci-docker-image.yml: be757cca1e8d70a2f652c6f744d1702e64048de6
- ci-rust.yml: cda1f64a620637ae1d60ed129c2993c1be9531fc
- deployments-google.yml: 4be4dc47d2fa23d09bef3bb01317f75a5fdb9763
- deployments-aws.yml: 3a1caa94adb59888ae22a46c6c2a702d93a9e62e
- deployments-azure-webapps-node.yml: 408c99e5be17a50b4fdb2484e7a364e8881cf36c
- deployments-terraform.yml: 25d29630fdcf29d317ba3b62243f4aff544e87ee
- deployments-ibm.yml: eaec2750b8568cfe227b27951abcd4f6b95f2e95
- code-scanning-codeql.yml: 353f571707939cc1bbaee4d72fe997740e4cb94e
- code-scanning-bandit.yml: a3858a3250320ea01459aa51274ce97a750792eb
- code-scanning-dependency-review.yml: 14d335c5e84cc8e52a0e5fccc58caafb2c0860ec
- code-scanning-brakeman.yml: 38e572c8d01a8a95d739110c6d662719a5e3f887
