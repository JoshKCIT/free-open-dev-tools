# Broken: two stages sharing one name (DuplicateStageName, docs.docker.com/reference/build-checks/)
FROM alpine:3.19 AS base
USER app
FROM alpine:3.19 AS base
USER app
