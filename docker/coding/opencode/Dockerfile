# syntax=docker/dockerfile:1.7

ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG OPENCODE_VERSION=1.18.9
ARG HYPER_RUNTIME_HOME=/home/node/.config/opencode
ENV HYPER_RUNTIME_HOME=${HYPER_RUNTIME_HOME}

USER root
COPY --chown=node:node opencode/opencode.json /opt/hypercli/share/runtime/opencode.json
COPY --chmod=0755 opencode/entrypoint.sh /opt/hypercli/bin/opencode-entrypoint
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" && \
    opencode --version && \
    rm -rf /tmp/opencode && \
    printf '%s\n' opencode > /opt/hypercli/share/runtime/runtime

LABEL org.opencontainers.image.title="HyperCLI OpenCode Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="opencode" \
      org.hypercli.coding_runtime_version="${OPENCODE_VERSION}"

ENV HYPER_ACP_AGENT_COMMAND=/opt/hypercli/bin/opencode \
    HYPER_ACP_AGENT_ARGS=acp \
    BUZZ_MODEL_PREFIX=hypercli/

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/hypercli/bin/opencode-entrypoint"]
CMD ["/usr/local/bin/hyper-acp"]
