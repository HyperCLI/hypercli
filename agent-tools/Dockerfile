# syntax=docker/dockerfile:1.7

# Builds the HyperCLI agent toolchain from THIS repo's checked-out tree:
#   ts-sdk, ts-cli (npm build+prune), plus the exported skills bundle.
# Final image is a scratch file-server image — agent-base copies:
#   /opt/hypercli/{ts-cli,ts-sdk,skills}, /usr/local/bin/hyper,
#   /usr/local/lib/node_modules/<the globally-installed ts-cli package>.

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
    npm --prefix ts-sdk prune --omit=dev

RUN --mount=type=cache,target=/root/.npm \
    npm --prefix ts-cli ci && \
    npm --prefix ts-cli run build && \
    npm --prefix ts-cli prune --omit=dev && \
    npm install --global ./ts-cli && \
    test "$(command -v hyper)" = "/usr/local/bin/hyper" && \
    test "$(readlink -f /usr/local/bin/hyper)" = "/opt/hypercli/ts-cli/dist/index.js" && \
    hyper --help >/dev/null && \
    hyper skills export /tmp/hypercli-skills >/dev/null && \
    rm -rf /opt/hypercli/skills && \
    mv /tmp/hypercli-skills /opt/hypercli/skills

FROM scratch
COPY --from=builder /opt/hypercli /opt/hypercli
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
