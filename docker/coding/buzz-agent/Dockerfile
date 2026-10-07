# syntax=docker/dockerfile:1.7

ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
FROM ${HYPERCLI_AGENT_BASE_IMAGE}

USER root
RUN ln -s /usr/local/lib/acp/buzz/sprig /usr/local/bin/buzz-agent && \
    ln -s /usr/local/lib/acp/buzz/sprig /usr/local/bin/buzz-dev-mcp && \
    test "$(readlink /usr/local/bin/buzz-agent)" = /usr/local/lib/acp/buzz/sprig && \
    test "$(readlink /usr/local/bin/buzz-dev-mcp)" = /usr/local/lib/acp/buzz/sprig && \
    printf '%s\n' buzz-agent > /opt/hypercli/share/runtime/runtime

LABEL org.opencontainers.image.title="HyperCLI Buzz Native Agent" \
      org.hypercli.buzz_runtime="true" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="buzz-agent"

ENV HYPER_ACP_AGENT_COMMAND=/usr/local/bin/buzz-agent \
    HYPER_ACP_AGENT_ARGS= \
    BUZZ_AGENT_PROVIDER=openai \
    BUZZ_AGENT_MODEL=coding-anthropic \
    OPENAI_COMPAT_API=chat \
    BUZZ_ACP_AGENT_COMMAND=/usr/local/bin/buzz-agent \
    BUZZ_ACP_AGENT_ARGS=

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/hypercli/bin/entrypoint"]
CMD ["/usr/local/bin/hyper-acp"]
