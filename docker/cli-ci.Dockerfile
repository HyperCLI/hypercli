# CLI CI image: ts-sdk + cli dependencies pre-installed and pre-built.
# CI jobs run inside this image against the mounted checkout — no npm cache
# uploads, no per-job `npm ci`. Rebuild the image when package-lock.json or
# ts sources change (the workflow keys the tag off the relevant lockfiles).
FROM node:22-bookworm-slim

WORKDIR /workspace

# ts-sdk first (cli depends on it via file:../ts-sdk).
COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY cli/package*.json /workspace/cli/
WORKDIR /workspace/cli
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Sources, then build both dist trees. The mounted checkout shadows
# /workspace at runtime; entrypoint re-runs the build so tests always run
# against the checked-out commit, not the image's baked sources.
COPY ts-sdk /workspace/ts-sdk/
COPY cli /workspace/cli/
WORKDIR /workspace/ts-sdk
RUN npm run build
WORKDIR /workspace/cli
RUN npm run build

COPY .github/scripts/cli_container_entrypoint.sh /usr/local/bin/cli_container_entrypoint
RUN chmod +x /usr/local/bin/cli_container_entrypoint

WORKDIR /workspace

ENTRYPOINT ["cli_container_entrypoint"]
