# Broken: cd only changes directory for this one RUN, not later instructions (DF009, in the spirit of hadolint's DL3003)
FROM alpine:3.19
RUN cd /app && npm install
USER app
