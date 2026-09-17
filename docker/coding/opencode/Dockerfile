# syntax=docker/dockerfile:1.7

ARG HYPER_ACP_BASE_IMAGE=hypercli-acp-base:local
FROM ${HYPER_ACP_BASE_IMAGE}

ARG OPENCODE_VERSION=1.18.9

USER root
COPY --chown=node:node opencode/opencode.json /opt/hypercli-coding/opencode.json
COPY --chmod=0755 opencode/entrypoint.sh /usr/local/bin/hypercli-coding-opencode-entrypoint
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" && \
    opencode --version && \
    printf '%s\n' opencode > /opt/hypercli-coding/runtime

LABEL org.opencontainers.image.title="HyperCLI OpenCode Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="opencode" \
      org.hypercli.coding_runtime_version="${OPENCODE_VERSION}"

ENV HYPER_ACP_AGENT_COMMAND=/usr/local/bin/opencode \
    HYPER_ACP_AGENT_ARGS=acp \
    BUZZ_MODEL_PREFIX=hypercli/

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hypercli-coding-opencode-entrypoint"]
CMD ["sleep", "infinity"]
