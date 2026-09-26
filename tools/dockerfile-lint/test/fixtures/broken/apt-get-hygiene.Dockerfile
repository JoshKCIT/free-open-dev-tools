# Broken: apt-get install with none of the -y, --no-install-recommends or list-cleanup hygiene (DF005/DF006/DF007, in the spirit of hadolint's DL3014/DL3015/DL3009)
FROM debian:12
RUN apt-get update && apt-get install curl
USER app
