# Broken: EXPOSE protocol is not lowercase (ExposeProtoCasing, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
USER app
EXPOSE 8080/TCP
