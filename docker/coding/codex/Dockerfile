# syntax=docker/dockerfile:1.7

ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG CODEX_VERSION=0.146.0
ARG CODEX_ACP_VERSION=1.1.7
ARG HYPER_RUNTIME_HOME=/home/node/.codex
ENV HYPER_RUNTIME_HOME=${HYPER_RUNTIME_HOME}

USER root
COPY --chmod=0755 codex/entrypoint.sh /opt/hypercli/bin/codex-entrypoint
COPY --chmod=0755 codex/runtime-auth.sh /usr/local/bin/hypercli-codex-auth
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund \
      "@openai/codex@${CODEX_VERSION}" \
      "@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}" && \
    ln -s hypercli-codex-auth /usr/local/bin/hypercli-runtime-auth && \
    codex --version && \
    codex-acp --version && \
    printf '%s\n' codex > /opt/hypercli/share/runtime/runtime

LABEL org.opencontainers.image.title="HyperCLI Codex Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="codex" \
      org.hypercli.coding_runtime_version="${CODEX_VERSION}" \
      org.hypercli.acp_adapter_version="${CODEX_ACP_VERSION}"

ENV NO_BROWSER=1 \
    HYPER_ACP_AGENT_COMMAND=/opt/hypercli/bin/codex-acp \
    HYPER_ACP_AGENT_ARGS=

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/hypercli/bin/codex-entrypoint"]
CMD ["/usr/local/bin/hyper-acp"]
