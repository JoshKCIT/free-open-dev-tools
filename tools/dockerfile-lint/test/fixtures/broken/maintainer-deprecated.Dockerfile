# Broken: MAINTAINER is deprecated (MaintainerDeprecated, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
MAINTAINER Jane Doe <jane@example.invalid>
USER app
