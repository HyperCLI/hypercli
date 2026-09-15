# syntax=docker/dockerfile:1.7

# Builds the HyperCLI agent toolchain from THIS repo's checked-out tree:
#   ts-sdk, ts-cli (npm build+prune), plus the exported skills bundle.
# Final image is a scratch file-server image — agent-base copies /opt/hypercli
# wholesale (internal links inside the tree survive directory COPY --from):
#   /opt/hypercli/{ts-cli,ts-sdk,skills,bin/hyper}

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
    chmod 0755 /opt/hypercli/ts-cli/dist/index.js && \
    install -d /opt/hypercli/bin && \
    ln -sf ../ts-cli/dist/index.js /opt/hypercli/bin/hyper && \
    node /opt/hypercli/ts-cli/dist/index.js --help >/dev/null && \
    node /opt/hypercli/ts-cli/dist/index.js skills export /tmp/hypercli-skills >/dev/null && \
    rm -rf /opt/hypercli/skills && \
    mv /tmp/hypercli-skills /opt/hypercli/skills

# Ship runtime payload only: dist + production node_modules + package.json.
RUN mkdir -p /bundle/ts-cli /bundle/ts-sdk && \
    cp -a /opt/hypercli/ts-cli/package.json /opt/hypercli/ts-cli/dist /opt/hypercli/ts-cli/node_modules /bundle/ts-cli/ && \
    cp -a /opt/hypercli/ts-sdk/package.json /opt/hypercli/ts-sdk/dist /opt/hypercli/ts-sdk/node_modules /bundle/ts-sdk/ && \
    mv /opt/hypercli/skills /bundle/skills && \
    mkdir /bundle/bin && \
    ln -s ../ts-cli/dist/index.js /bundle/bin/hyper

FROM scratch
COPY --from=builder /bundle /opt/hypercli
