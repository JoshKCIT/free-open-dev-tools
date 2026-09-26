# Broken: an instruction other than ARG before the first FROM (Dockerfile reference, "FROM may only be preceded by ARG")
RUN echo hi
FROM alpine:3.19
USER app
