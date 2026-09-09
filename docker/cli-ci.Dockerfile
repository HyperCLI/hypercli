# CLI CI image: ts-sdk + cli dependencies, dists, and tests baked in at
# /opt/ts-sdk and /opt/cli. Per-gate runner scripts live at /tests. Each CI
# job runs one `docker run <image> <script> [args]` — no npm cache uploads,
# no per-job `npm ci`. Tagged with the short commit SHA.
FROM node:24-bookworm-slim

# ts-sdk first (cli depends on it via file:../ts-sdk).
COPY ts-sdk/package*.json /opt/ts-sdk/
WORKDIR /opt/ts-sdk
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY cli/package*.json /opt/cli/
WORKDIR /opt/cli
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Sources, then build both dist trees.
COPY ts-sdk /opt/ts-sdk/
COPY cli /opt/cli/
WORKDIR /opt/ts-sdk
RUN npm run build
WORKDIR /opt/cli
RUN npm run build

# Per-gate runner scripts.
COPY .github/scripts/cli-ci/ /tests/
RUN chmod +x /tests/*.sh

WORKDIR /opt
