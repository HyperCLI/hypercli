# syntax=docker/dockerfile:1.7

# Builds the HyperCLI CLI image from this repo's checked-out tree and ships the
# same artifact agent images copy into /opt/hypercli:
#   /opt/hypercli/bin/hyper   — ts-cli bundled+minified into a single file
#                               (esbuild; ts-sdk inlined; skills exported
#                               before bundling)
#   /opt/hypercli/skills      — exported skills bundle

ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim

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

FROM ${NODE_IMAGE}
COPY --from=builder /bundle-hyper /opt/hypercli/bin/hyper
# cliVersion() reads ../package.json next to the bundled entrypoint.
COPY --from=builder /opt/hypercli/ts-cli/package.json /opt/hypercli/package.json
COPY --from=builder /bundle-skills /opt/hypercli/skills
RUN ln -sf /opt/hypercli/bin/hyper /usr/local/bin/hyper \
    && hyper --help >/dev/null \
    && test -n "$(find /opt/hypercli/skills -type f -name SKILL.md -print -quit)"
ENTRYPOINT ["/usr/local/bin/hyper"]
