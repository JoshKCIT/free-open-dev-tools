# Upstream: kubernetes/website

- Repository: https://github.com/kubernetes/website
- Commit: fcf148c070b140cbd13ec65d5809f0686e680a9c
- Fetch date: 2026-09-26
- Licence: Creative Commons Attribution 4.0 International (see `LICENSE` in this folder)

One documented example manifest per bundled kind, taken from
`content/en/examples/` on the Kubernetes documentation site. Three files were
extracted from a larger upstream file that documents more than one object:
`ConfigMap.yaml` (first of two ConfigMaps in `configmap/configmaps.yaml`),
`Secret.yaml` (the Secret document, not the companion Pod, in
`secret/dotfile-secret.yaml`), and `StatefulSet.yaml` (the StatefulSet
document, not the companion headless Service, in
`controllers/statefulset.yaml`) -- the same "vendor several real files,
flattened" transformation `docker-compose-validator` (07-01) already applies
to `awesome-compose`'s samples. Every other file here is unmodified.

Source paths at the pinned commit:

- Pod.yaml <- content/en/examples/pods/simple-pod.yaml
- Deployment.yaml <- content/en/examples/controllers/nginx-deployment.yaml
- StatefulSet.yaml <- content/en/examples/controllers/statefulset.yaml (second document)
- DaemonSet.yaml <- content/en/examples/controllers/daemonset.yaml
- Job.yaml <- content/en/examples/controllers/job.yaml
- CronJob.yaml <- content/en/examples/application/job/cronjob.yaml
- Service.yaml <- content/en/examples/service/simple-service.yaml
- Ingress.yaml <- content/en/examples/service/networking/minimal-ingress.yaml
- ConfigMap.yaml <- content/en/examples/configmap/configmaps.yaml (first document)
- Secret.yaml <- content/en/examples/secret/dotfile-secret.yaml (first document)
- PersistentVolumeClaim.yaml <- content/en/examples/pods/storage/pv-claim.yaml
- Namespace.yaml <- content/en/examples/admin/namespace-dev.yaml

## Files

- ConfigMap.yaml: 1f376bb800565165ae02a37a1bc788f9b5af6f4b
- CronJob.yaml: 78d0e2d314792d674bb9085ff67bbf231a3b82c3
- DaemonSet.yaml: d7e41ffea97a920e03b74742c0fb145f4c060a03
- Deployment.yaml: 685c17aa68e1d5f413f2f5b469511a28937e469b
- Ingress.yaml: 47c3b34e908bcb3303c7082e5109d8eefd07885a
- Job.yaml: 2755c1e2c70e9b6b43d4a6006af0f44760162f18
- LICENSE: da6ab6cc8f333d7e89a99812866df8f24374d47c
- Namespace.yaml: 5e753b693f03b053e07ddd9df6c8749a94e26aaa
- PersistentVolumeClaim.yaml: b33f6faa4cbbbcb937d1160e8936bc4d904e3e6a
- Pod.yaml: 0e79d8a3c61284b0fca87f963bedc166cd6e2c6b
- Secret.yaml: 85b9375323227e7346ab7805939b311a171437b9
- Service.yaml: afcf1178cc639ec54ac64502bf6dd67e2234ff7c
- StatefulSet.yaml: b1b5a8759cda5c4d8605e3e7b8a6e04fcddae442
