ARG HYPERCLI_REF=main
ARG HYPERCLI_SHA
ARG HYPERCLI_REPO=https://github.com/HyperCLI/hypercli.git
ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local
ARG OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw:2026.9.4

FROM ${OPENCLAW_BASE_IMAGE} AS upstream-openclaw

FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG HYPERCLI_REF
ARG HYPERCLI_SHA
ARG HYPERCLI_REPO
ARG HYPERCLI_AGENT_BASE_IMAGE
ARG OPENCLAW_BASE_IMAGE

ENV HYPERCLI_REF=${HYPERCLI_REF}
ENV HYPERCLI_SHA=${HYPERCLI_SHA}

USER root
COPY --from=upstream-openclaw /app /app
RUN mkdir -p /opt/hypercli-openclaw /home/node/.openclaw && \
    ln -sf /app/openclaw.mjs /usr/local/bin/openclaw && \
    chown -R node:node /home/node /opt/hypercli-openclaw /app

COPY patch_slack_ws_wrapper.ts /opt/hypercli-openclaw/patch_slack_ws_wrapper.ts

RUN set -eux; \
    openclaw_version="$(node -e 'console.log(require("/app/package.json").version)')"; \
    tmp_dir="$(mktemp -d)"; \
    cd "${tmp_dir}"; \
    npm init -y >/dev/null; \
    npm install --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps \
      "@openclaw/brave-plugin@${openclaw_version}" \
      "@openclaw/slack@${openclaw_version}" \
      "@openclaw/whatsapp@${openclaw_version}"; \
    rm -rf /app/dist/extensions/brave /app/dist/extensions/slack /app/dist/extensions/whatsapp; \
    mkdir -p /app/dist/extensions; \
    cp -a node_modules/@openclaw/brave-plugin /app/dist/extensions/brave; \
    cp -a node_modules/@openclaw/slack /app/dist/extensions/slack; \
    cp -a node_modules/@openclaw/whatsapp /app/dist/extensions/whatsapp; \
    node /opt/hypercli-openclaw/patch_slack_ws_wrapper.ts; \
    node -e 'import("/app/dist/extensions/slack/node_modules/ws/wrapper.mjs").then(m => { if (typeof m.WebSocket !== "function" || typeof m.default !== "function") { console.error("ws wrapper patch invalid"); process.exit(1) } })'; \
    node -e 'const fs = require("fs"); const p = "/app/dist/extensions/whatsapp/package.json"; const j = JSON.parse(fs.readFileSync(p, "utf8")); if (j.openclaw?.channel?.persistedAuthState) delete j.openclaw.channel.persistedAuthState; fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");'; \
    chown -R node:node /app/dist/extensions/brave /app/dist/extensions/slack /app/dist/extensions/whatsapp; \
    rm -rf "${tmp_dir}"

COPY openclaw.json /opt/hypercli-openclaw/openclaw.json
COPY entrypoint.sh /opt/hypercli-openclaw/entrypoint.sh
COPY init.sh /opt/hypercli-openclaw/init.sh
COPY config.ts /opt/hypercli-openclaw/config.ts
COPY models.ts /opt/hypercli-openclaw/models.ts
COPY slack.ts /opt/hypercli-openclaw/slack.ts
RUN chmod +x /opt/hypercli-openclaw/entrypoint.sh /opt/hypercli-openclaw/init.sh && \
    chown -R node:node /opt/hypercli-openclaw && \
    openclaw --version

ENV OPENCLAW_PORT=18789
ENV OPENCLAW_GATEWAY_BIND=lan
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
ENV OPENCLAW_MEMORY_SEARCH_ENABLED=
ENV OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START=
ENV OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH=
ENV OPENCLAW_MEMORY_SEARCH_SYNC_WATCH=
ENV OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS=
ENV OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES=
ENV DISPLAY=:99

WORKDIR /app
USER node

EXPOSE 18789 3000
ENTRYPOINT ["/opt/hypercli-openclaw/entrypoint.sh"]
