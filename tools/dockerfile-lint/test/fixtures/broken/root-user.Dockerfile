# Broken: no USER instruction, so the image runs as root by default (DF003, in the spirit of hadolint's DL3002)
FROM alpine:3.19
RUN echo hi
