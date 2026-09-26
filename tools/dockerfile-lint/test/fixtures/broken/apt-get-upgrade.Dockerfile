# Broken: apt-get upgrade inside a build, which depends on the mirror's current versions (DF008, in the spirit of hadolint's DL3005)
FROM debian:12
RUN apt-get update && apt-get upgrade -y
USER app
