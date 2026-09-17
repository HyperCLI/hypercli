ARG HERMES_BASE_IMAGE=nousresearch/hermes-agent:v2026.8.3
ARG HYPERCLI_REF=main
ARG HYPERCLI_SHA
ARG HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local

FROM ${HERMES_BASE_IMAGE} AS upstream-hermes

FROM ${HYPERCLI_AGENT_BASE_IMAGE}

ARG HERMES_BASE_IMAGE
ARG HYPERCLI_REF
ARG HYPERCLI_SHA
ARG HYPERCLI_AGENT_BASE_IMAGE

ENV HYPERCLI_REF=${HYPERCLI_REF}
ENV HYPERCLI_SHA=${HYPERCLI_SHA}

USER root

COPY --from=upstream-hermes /opt/hermes /opt/hermes
COPY --from=upstream-hermes /init /init
COPY --from=upstream-hermes /command /command
COPY --from=upstream-hermes /package /package
COPY --from=upstream-hermes /etc/s6-overlay /etc/s6-overlay
COPY --from=upstream-hermes /etc/cont-init.d /etc/cont-init.d
COPY --from=upstream-hermes /usr/local/bin/uv /usr/local/bin/uv
COPY --from=upstream-hermes /usr/local/bin/uvx /usr/local/bin/uvx

RUN groupadd -g 10000 hermes \
    && useradd -u 10000 -g 10000 -d /home/hermes -s /bin/sh hermes \
    && printf '%s\n' 'hermes ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-hermes-nopasswd \
    && chmod 0440 /etc/sudoers.d/90-hermes-nopasswd \
    && cd /opt/hermes \
    && rm -rf .venv \
    && UV_NO_CONFIG=1 uv sync --frozen --no-install-project --extra all --extra messaging --extra otlp --extra anthropic --extra bedrock --extra azure-identity --extra hindsight \
    && UV_NO_CONFIG=1 uv pip install --no-cache-dir --no-deps -e . \
    && UV_NO_CONFIG=1 uv pip install --python /opt/hermes/.venv/bin/python "mem0ai>=2.0.10,<3" qdrant-client \
    && test -n "$(find /opt/hypercli/skills -type f -name SKILL.md -print -quit)" \
    && hyper --help >/dev/null

COPY --chmod=0644 config.yaml /opt/hypercli-hermes/config.yaml
COPY --chmod=0644 mem0.json /opt/hypercli-hermes/mem0.json
COPY --chmod=0755 entrypoint.sh /opt/hypercli-hermes/entrypoint.sh
COPY --chmod=0755 init.sh /opt/hypercli-hermes/init.sh
COPY --chmod=0755 skills.sh /opt/hypercli-hermes/skills.sh
COPY --chmod=0755 configure_mem0.py /opt/hypercli-hermes/configure_mem0.py
COPY --chmod=0755 config.py /opt/hypercli-hermes/config.py
COPY --chmod=0755 env.py /opt/hypercli-hermes/env.py
COPY --chmod=0755 models.py /opt/hypercli-hermes/models.py
COPY --chmod=0755 patch_hermes_mem0_custom_instructions.py /opt/hypercli-hermes/patch_hermes_mem0_custom_instructions.py

RUN /opt/hypercli-hermes/patch_hermes_mem0_custom_instructions.py

RUN usermod -d /home/hermes hermes \
    && mkdir -p /home/hermes/.hermes /home/hermes/shared \
    && sed -i \
      -e 's#export HOME=/opt/data#export HOME=/home/hermes#g' \
      -e 's#cd /opt/data#cd /home/hermes#g' \
      /opt/hermes/docker/main-wrapper.sh \
      /opt/hermes/docker/hermes-exec-shim.sh \
      /opt/hermes/docker/s6-rc.d/dashboard/run \
      /opt/hermes/hermes_cli/service_manager.py \
    && sed -i \
      -e 's#export HOME=/opt/data#export HOME=/home/hermes#g' \
      /opt/hermes/bin/hermes \
    && chown -R hermes:hermes /home/hermes

ENV HOME=/home/hermes
ENV HERMES_HOME=/home/hermes/.hermes
ENV HERMES_WRITE_SAFE_ROOT=/home/hermes
ENV HYPER_WORKSPACES_DIR=/home/hermes/shared
ENV HYPER_AGENTS_API_BASE=https://api.agents.hypercli.com
ENV HYPER_API_BASE=https://api.hypercli.com
ENV HYPER_AGENTS_WEB_SEARCH_BASE=https://api.agents.hypercli.com/agents/brave
ENV NO_PROXY=localhost,127.0.0.1,host.docker.internal
ENV no_proxy=localhost,127.0.0.1,host.docker.internal
ENV HYPER_DESKTOP_ENABLED=0
ENV HYPER_DESKTOP_PORT=3000
ENV HYPER_DESKTOP_GEOMETRY=1280x800x24
ENV DISPLAY=:99
ENV API_SERVER_ENABLED=true
ENV API_SERVER_HOST=0.0.0.0
ENV API_SERVER_PORT=8642
ENV HERMES_CRON_ENABLED=
ENV PATH=/opt/hermes/bin:/opt/hermes/.venv/bin:/home/hermes/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/hermes

EXPOSE 8642 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD curl -fsS http://127.0.0.1:8642/health >/dev/null || exit 1

# Keep the wrapper as PID 1 only long enough to seed missing default config,
# then exec the upstream dispatcher so s6-overlay retains its native lifecycle.
ENTRYPOINT ["/opt/hypercli-hermes/entrypoint.sh"]
CMD ["gateway", "run"]
