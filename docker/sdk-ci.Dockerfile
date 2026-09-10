# SDK CI image: Python SDK + py-cli venv and ts-sdk + cli deps/dists baked
# in, plus per-gate runner scripts at /tests. One image serves every leg of
# sdk-integration-tests.yml; each leg is a single `docker run <image>
# /tests/<gate>.sh` — no host setup-node/setup-python steps, no multi-GB
# npm cache downloads.
FROM python:3.12-slim-bookworm

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

ARG NODE_VERSION=24.21.0
ARG TARGETARCH=x64
RUN \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates xz-utils git; \
    rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH}" in amd64) NODE_ARCH=x64 ;; arm64) NODE_ARCH=arm64 ;; *) NODE_ARCH="${TARGETARCH}" ;; esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm /tmp/node.tar.xz; \
    node --version; \
    npm --version

# Node dependencies first (layer-cached until the lockfiles move).
COPY ts-sdk/package*.json /opt/ts-sdk/
WORKDIR /opt/ts-sdk
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY cli/package*.json /opt/cli/
WORKDIR /opt/cli
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Python SDK + py-cli as editable installs in a shared venv.
COPY sdk /opt/sdk/
COPY py-cli /opt/py-cli/
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade "pip>=24.3.1,<26" \
    && /opt/venv/bin/pip install --no-cache-dir -e "/opt/sdk[dev]" -e /opt/py-cli \
       requests "PyYAML>=6,<7"
ENV PATH="/opt/venv/bin:${PATH}"

# Sources, then build both dist trees.
COPY ts-sdk /opt/ts-sdk/
COPY cli /opt/cli/
WORKDIR /opt/ts-sdk
RUN npm run build
WORKDIR /opt/cli
RUN npm run build

# Per-gate runner scripts; Python tests import repo scripts by path.
COPY .github/scripts /opt/.github/scripts/
COPY .github/scripts/sdk-ci/ /tests/
RUN mkdir -p /opt/bin \
    && chmod +x /tests/*.sh \
    && ln -sf /opt/.github/scripts/bootstrap_dev_test_keys.py /opt/bin/bootstrap_dev_test_keys.py

# ts-sdk tests reference repo-root fixtures via ../../tests/ relative URLs.
COPY tests/fixtures /opt/tests/fixtures/

# Python integrity tests compare against the canonical OpenAPI doc.
COPY docs/agents-openapi.json /opt/docs/agents-openapi.json

WORKDIR /opt
