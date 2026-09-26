# Broken: ADD used for a plain local directory, where COPY is the more predictable choice (DF004, in the spirit of hadolint's DL3020)
FROM alpine:3.19
ADD ./src /app
USER app
