# Broken: a sensitive-looking name set via ENV (SecretsUsedInArgOrEnv, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
ENV API_TOKEN=abc123
USER app
