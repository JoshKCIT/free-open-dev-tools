# Broken: a here-document with no line containing only its terminator (Dockerfile reference, Here-Documents)
FROM alpine:3.19
USER app
RUN <<EOF
echo hi
