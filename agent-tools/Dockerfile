# syntax=docker/dockerfile:1.7

# Builds the HyperCLI agent toolchain from THIS repo's checked-out tree and
# ships only what agent images need at runtime:
#   /opt/hypercli/bin/hyper   — ts-cli bundled+minified into a single file
#                               (esbuild; ts-sdk inlined; skills exported
#                               before bundling)
#   /opt/hypercli/skills      — exported skills bundle

ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS builder

WORKDIR /opt/hypercli
COPY ts-sdk ./ts-sdk
COPY ts-cli ./ts-cli
COPY skills ./skills

RUN --mount=type=cache,target=/root/.npm \
    test -n "$(find /opt/hypercli/skills -type f -name SKILL.md -print -quit)" && \
    npm --prefix ts-sdk ci && \
    npm --prefix ts-sdk run build && \
    npm --prefix ts-cli ci && \
    npm --prefix ts-cli run build && \
    node /opt/hypercli/ts-cli/dist/index.js --help >/dev/null && \
    node /opt/hypercli/ts-cli/dist/index.js skills export /bundle-skills >/dev/null

# Bundle to a single minified entrypoint. The banner supplies `require` for
# bundled CJS deps (ws) in the ESM output.
RUN --mount=type=cache,target=/root/.npm \
    npx -y esbuild /opt/hypercli/ts-cli/dist/index.js \
      --bundle --minify --platform=node --target=node24 --format=esm \
      '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
      --outfile=/bundle-hyper && \
    chmod 0755 /bundle-hyper && \
    node /bundle-hyper --help >/dev/null

FROM scratch
COPY --from=builder /bundle-hyper /opt/hypercli/bin/hyper
COPY --from=builder /bundle-skills /opt/hypercli/skills
