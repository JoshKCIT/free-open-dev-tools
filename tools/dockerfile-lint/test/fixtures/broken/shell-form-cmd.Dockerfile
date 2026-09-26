# Broken: shell-form CMD runs through an intermediate shell instead of the program directly (JSONArgsRecommended, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
USER app
CMD echo hi
