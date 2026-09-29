ARG HYPERCLI_REF=main
ARG HYPERCLI_SHA
ARG HYPERCLI_REPO=https://github.com/HyperCLI/hypercli.git
ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
ARG OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw:2026.9.4

FROM ${OPENCLAW_BASE_IMAGE} AS upstream-openclaw

FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG HYPERCLI_AGENT_BASE_IMAGE
ARG OPENCLAW_BASE_IMAGE

USER root
# hyper-acp comes from hypercli-agent-base (/usr/local/bin/hyper-acp symlink).
COPY --from=upstream-openclaw /app /app
RUN hyper-acp --help >/dev/null
RUN mkdir -p /opt/hypercli-openclaw /home/node/.openclaw && \
    ln -sf /app/openclaw.mjs /usr/local/bin/openclaw && \
    chown -R node:node /home/node /opt/hypercli-openclaw /app

RUN set -eux; \
    openclaw_version="$(node -e 'console.log(require("/app/package.json").version)')"; \
    tmp_dir="$(mktemp -d)"; \
    cd "${tmp_dir}"; \
    npm init -y >/dev/null; \
    npm install --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps \
      "@openclaw/brave-plugin@${openclaw_version}" \
      "@openclaw/whatsapp@${openclaw_version}"; \
    rm -rf /app/dist/extensions/brave /app/dist/extensions/slack /app/dist/extensions/whatsapp; \
    mkdir -p /app/dist/extensions; \
    cp -a node_modules/@openclaw/brave-plugin /app/dist/extensions/brave; \
    cp -a node_modules/@openclaw/whatsapp /app/dist/extensions/whatsapp; \
    node -e 'const fs = require("fs"); const p = "/app/dist/extensions/whatsapp/package.json"; const j = JSON.parse(fs.readFileSync(p, "utf8")); if (j.openclaw?.channel?.persistedAuthState) delete j.openclaw.channel.persistedAuthState; fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");'; \
    chown -R node:node /app/dist/extensions/brave /app/dist/extensions/whatsapp; \
    rm -rf "${tmp_dir}"

COPY openclaw.json /opt/hypercli-openclaw/openclaw.json
COPY entrypoint.sh /opt/hypercli-openclaw/entrypoint.sh
COPY init.sh /opt/hypercli-openclaw/init.sh
COPY config.ts /opt/hypercli-openclaw/config.ts
COPY models.ts /opt/hypercli-openclaw/models.ts
RUN chmod +x /opt/hypercli-openclaw/entrypoint.sh /opt/hypercli-openclaw/init.sh && \
    chown -R node:node /opt/hypercli-openclaw && \
    openclaw --version

ARG HYPERCLI_REF
ARG HYPERCLI_SHA
ARG HYPERCLI_REPO
ENV HYPERCLI_REF=${HYPERCLI_REF}
ENV HYPERCLI_SHA=${HYPERCLI_SHA}

ENV OPENCLAW_PORT=18789
ENV OPENCLAW_GATEWAY_BIND=loopback
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw
ENV OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json
ENV OPENCLAW_CONFIG_TEMPLATE=/opt/hypercli-openclaw/openclaw.json
ENV OPENCLAW_BUNDLED_PLUGINS_DIR=/app/dist/extensions
ENV OPENCLAW_INSTALL_PLUGINS=
ENV HYPER_AGENTS_API_BASE=https://api.agents.hypercli.com
ENV HYPER_AGENTS_WEB_SEARCH_BASE=https://api.agents.hypercli.com/agents/brave
ENV HYPER_DESKTOP_ENABLED=0
ENV OPENCLAW_DESKTOP_PORT=3000
ENV HYPER_DESKTOP_PORT=3000
ENV HYPER_DESKTOP_GEOMETRY=1280x800x24
ENV OPENCLAW_CRON_ENABLED=
# Memory search: the pinned gateway only accepts memory.search.* config keys
# and no longer exposes sync cadence knobs, so only ENABLED remains a knob.
ENV OPENCLAW_MEMORY_SEARCH_ENABLED=
ENV DISPLAY=:99
# ACP leg as pod default: hyper-acp spawns `openclaw acp`; the entrypoint
# backgrounds `openclaw gateway run` first (the bridge dials it loopback-only
# with gateway auth mode "none"). `gateway run` override = native gateway.
ENV HYPER_ACP_AGENT_COMMAND=openclaw \
    HYPER_ACP_AGENT_ARGS=acp

WORKDIR /app
USER node

EXPOSE 18789 3000
ENTRYPOINT ["/opt/hypercli-openclaw/entrypoint.sh"]
CMD ["/usr/local/bin/hyper-acp"]
