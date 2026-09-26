# Broken: an EXPOSE port outside 1-65535 and an EXPOSE protocol that is neither tcp nor udp (ExposeInvalidFormat, Dockerfile reference)
FROM alpine:3.19
USER app
EXPOSE 70000
EXPOSE 8080/bogus
