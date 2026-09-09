# CLI CI image: ts-sdk + cli dependencies, dists, and tests baked in at
# /opt/ts-sdk and /opt/cli. CI jobs run named gates inside the image via
# .github/scripts/cli_container_entrypoint.sh — no npm cache uploads, no
# per-job `npm ci`. The image is tagged with the short commit SHA.
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

COPY .github/scripts/cli_container_entrypoint.sh /usr/local/bin/cli_container_entrypoint
RUN chmod +x /usr/local/bin/cli_container_entrypoint

WORKDIR /opt

ENTRYPOINT ["cli_container_entrypoint"]
