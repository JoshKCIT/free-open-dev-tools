# Broken: sudo inside RUN has no real privilege boundary to cross (DF010, in the spirit of hadolint's DL3004)
FROM alpine:3.19
RUN sudo whoami
USER app
