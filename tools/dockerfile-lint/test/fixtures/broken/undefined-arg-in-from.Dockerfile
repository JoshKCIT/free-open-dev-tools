# Broken: FROM uses a build argument with no declared default before the first FROM (UndefinedArgInFrom, docs.docker.com/reference/build-checks/)
ARG VERSION
FROM alpine:$VERSION
USER app
