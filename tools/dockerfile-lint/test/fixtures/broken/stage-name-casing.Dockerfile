# Broken: a stage name that is not lowercase (StageNameCasing, docs.docker.com/reference/build-checks/)
FROM alpine:3.19 AS Base
USER app
