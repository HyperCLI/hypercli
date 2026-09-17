# syntax=docker/dockerfile:1.7

ARG HYPER_ACP_BASE_IMAGE=hypercli-acp-base:local
FROM ${HYPER_ACP_BASE_IMAGE}

ARG CLAUDE_CODE_VERSION=2.1.207
ARG CLAUDE_ACP_VERSION=0.59.0

USER root
COPY --chmod=0755 claude/entrypoint.sh /usr/local/bin/hypercli-coding-claude-entrypoint
COPY --chmod=0755 claude/runtime-auth.sh /usr/local/bin/hypercli-claude-auth
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@agentclientprotocol/claude-agent-acp@${CLAUDE_ACP_VERSION}" && \
    ln -s hypercli-claude-auth /usr/local/bin/hypercli-runtime-auth && \
    claude --version && \
    claude-agent-acp --version && \
    printf '%s\n' claude-code > /opt/hypercli-coding/runtime

LABEL org.opencontainers.image.title="HyperCLI Claude Code Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="claude-code" \
      org.hypercli.coding_runtime_version="${CLAUDE_CODE_VERSION}" \
      org.hypercli.acp_adapter_version="${CLAUDE_ACP_VERSION}"

ENV HYPER_ACP_AGENT_COMMAND=/usr/local/bin/claude-agent-acp \
    HYPER_ACP_AGENT_ARGS=

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hypercli-coding-claude-entrypoint"]
CMD ["sleep", "infinity"]
