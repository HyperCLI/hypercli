# syntax=docker/dockerfile:1.7-labs

# CLI CI image: ts-sdk + ts-cli dependencies, dists, and tests baked in at
# /opt/ts-sdk and /opt/cli. Build context is the public `hypercli/` submodule.
# The per-gate runner scripts (.github/scripts/cli/) are bind-mounted at
# /tests by the workflow, so each CI job is one
# `docker run -v .../scripts/cli:/tests:ro <image> /tests/<gate>.sh [args]`
# with no per-job `npm ci`. Tagged with the short commit SHA.
#
# `COPY --exclude` (1.7-labs) keeps a runner checkout's stale node_modules /
# dist out of the image so the in-image `npm ci` result is what gets tested.
FROM node:24-bookworm-slim

# Test-only process supervisor, also used by the mounted unit gate scripts.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY tools/run_unit_tests.py /opt/tools/run_unit_tests.py

# ts-sdk first (ts-cli depends on it via file:../ts-sdk).
COPY ts-sdk/package*.json /opt/ts-sdk/
WORKDIR /opt/ts-sdk
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY ts-cli/package*.json /opt/cli/
WORKDIR /opt/cli
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Sources, then build both dist trees.
COPY --exclude=node_modules --exclude=dist ts-sdk /opt/ts-sdk/
COPY --exclude=node_modules --exclude=dist ts-cli /opt/cli/
WORKDIR /opt/ts-sdk
RUN npm run build
WORKDIR /opt/cli
RUN npm run build && node dist/index.js --help >/dev/null

WORKDIR /opt
