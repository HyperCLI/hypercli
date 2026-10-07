# syntax=docker/dockerfile:1.7

ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG PI_VERSION=0.87.1
ARG PI_ACP_VERSION=0.0.33
ARG HYPER_RUNTIME_HOME=/home/node/.pi/agent
ENV HYPER_RUNTIME_HOME=${HYPER_RUNTIME_HOME}

USER root
COPY --chmod=0755 pi/entrypoint.sh /opt/hypercli/bin/pi-entrypoint
RUN export HOME=/root && \
    npm install --global --no-audit --no-fund \
      "@earendil-works/pi-coding-agent@${PI_VERSION}" \
      "pi-acp@${PI_ACP_VERSION}" && \
    pi --version && \
    printf '%s\n' pi > /opt/hypercli/share/runtime/runtime

LABEL org.opencontainers.image.title="HyperCLI Pi Agent" \
      org.hypercli.coding_workspace="/home/node" \
      org.hypercli.coding_runtime="pi" \
      org.hypercli.coding_runtime_version="${PI_VERSION}" \
      org.hypercli.acp_adapter_version="${PI_ACP_VERSION}"

ENV HYPER_ACP_AGENT_COMMAND=/opt/hypercli/bin/pi-acp \
    HYPER_ACP_AGENT_ARGS= \
    PI_ACP_PI_COMMAND=/opt/hypercli/bin/pi

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/hypercli/bin/pi-entrypoint"]
CMD ["/usr/local/bin/hyper-acp"]
