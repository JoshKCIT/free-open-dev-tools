# Broken: COPY --from names no stage in this file (DF011)
FROM alpine:3.19 AS base
USER app
COPY --from=build /app /app
