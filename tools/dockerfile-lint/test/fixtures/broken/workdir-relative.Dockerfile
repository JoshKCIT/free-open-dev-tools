# Broken: a relative WORKDIR with no earlier absolute one in this stage (WorkdirRelativePath, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
WORKDIR app
USER app
