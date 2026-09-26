# Broken: the legacy ENV "key value" form with no equals sign (LegacyKeyValueFormat, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
ENV FOO bar
USER app
