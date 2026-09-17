# syntax=docker/dockerfile:1.7

ARG HYPER_ACP_BASE_IMAGE=hypercli-acp-base:local
FROM ${HYPER_ACP_BASE_IMAGE}

ARG KIMI_CODE_VERSION=0.31.0

USER root
COPY --chown=node:node kimi-code/tui.toml /opt/hypercli-coding/kimi-tui.toml
COPY --chmod=0755 kimi-code/entrypoint.sh /usr/local/bin/hypercli-coding-kimi-entrypoint
COPY --chmod=0755 kimi-code/runtime-auth.sh /usr/local/bin/hypercli-kimi-auth
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund \
      "@moonshot-ai/kimi-code@${KIMI_CODE_VERSION}" && \
    ln -s hypercli-kimi-auth /usr/local/bin/hypercli-runtime-auth && \
    kimi --version && \
    kimi acp --help >/dev/null && \
    printf '%s\n' kimi-code > /opt/hypercli-coding/runtime

LABEL org.opencontainers.image.title="HyperCLI Kimi Code Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="kimi-code" \
      org.hypercli.coding_runtime_version="${KIMI_CODE_VERSION}"

ENV KIMI_CODE_HOME=/home/node/.kimi-code \
    KIMI_DISABLE_TELEMETRY=1 \
    HYPER_ACP_AGENT_COMMAND=/usr/local/bin/kimi \
    HYPER_ACP_AGENT_ARGS=acp

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hypercli-coding-kimi-entrypoint"]
CMD ["sleep", "infinity"]
