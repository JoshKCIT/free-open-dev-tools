# Broken: two CMD instructions in one stage; only the last takes effect (MultipleInstructionsDisallowed, docs.docker.com/reference/build-checks/)
FROM alpine:3.19
USER app
CMD ["a"]
CMD ["b"]
