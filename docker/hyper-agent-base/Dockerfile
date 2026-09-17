# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim
ARG HYPERCLI_REF=main
ARG TOOLCHAIN_IMAGE=hypercli-cli:local

# ts-cli/ts-sdk/skills artifact built by the hypercli-cli image; copied in,
# never rebuilt here.
FROM ${TOOLCHAIN_IMAGE} AS tools

FROM ${NODE_IMAGE}

ARG NODE_IMAGE
ARG HYPERCLI_REF

LABEL org.opencontainers.image.title="HyperCLI Agent Base"

ENV DEBIAN_FRONTEND=noninteractive

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    ffmpeg \
    poppler-utils \
    lsof \
    openssh-client \
    procps \
    ripgrep \
    build-essential \
    sudo \
    tini \
    vim \
    xxd \
    nano \
    zip \
    unzip \
    dbus-x11 \
    dconf-cli \
    feh \
    fonts-dejavu \
    fonts-firacode \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    novnc \
    plank \
    thunar \
    websockify \
    x11-xserver-utils \
    x11vnc \
    xauth \
    xdg-utils \
    xfce4-terminal \
    xfwm4 \
    xvfb \
    && curl -fsSL --http1.1 --retry 5 --retry-all-errors --retry-delay 5 -o /tmp/google-chrome-stable.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends /tmp/google-chrome-stable.deb \
    && rm -f /tmp/google-chrome-stable.deb \
    && if [ ! -s /var/lib/dbus/machine-id ]; then dbus-uuidgen >/var/lib/dbus/machine-id; fi \
    && ln -sf /var/lib/dbus/machine-id /etc/machine-id \
    && printf '%s\n' 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-node-nopasswd \
    && chmod 0440 /etc/sudoers.d/90-node-nopasswd \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/shared /home/node/Desktop /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown -R node:node /home/node

# Agent convenience package managers (npm builds use plain npm ci below).
RUN npm install --global pnpm@11.2.2 \
    && if [ "$(yarn --version 2>/dev/null || true)" != "1.22.22" ]; then npm install --global --force yarn@1.22.22; fi \
    && pnpm --version \
    && yarn --version

# HyperCLI SDK/CLI/skills, fetched from git by content: a branch/tag fragment
# is re-resolved against the remote on every build (a moved "main" can never
# be served from cache); a 40-hex fragment is immutable and cached by content.
# CLI artifacts from the hypercli-cli image (ts-cli + ts-sdk compiled, skills
# exported); nothing npm-related is rebuilt in this image.
# The dir copy preserves the tree-internal bin/hyper -> ../ts-cli/dist/index.js
# link; /usr/local/bin/hyper just points into it for PATH callers.
COPY --from=tools /opt/hypercli /opt/hypercli

RUN ln -sf /opt/hypercli/bin/hyper /usr/local/bin/hyper && \
    test "$(command -v hyper)" = "/usr/local/bin/hyper" && \
    hyper --help >/dev/null && \
    test -n "$(find /opt/hypercli/skills -type f -name SKILL.md -print -quit)"

# Everything HyperCLI-owned lives under /opt/hypercli (kept after the prune
# above by copying it in only now). Frozen external paths stay put: the noVNC
# webroot (websockify --web), the XDG applications dir, Chrome's managed-policy
# dir, and /usr/local/bin (npm-global + ENV contracts).
COPY --chmod=0644 desktop.sh patch-novnc.mjs /opt/hypercli/lib/
COPY --chmod=0644 hypercli-bg.png /opt/hypercli/share/hypercli-bg.png
COPY --chmod=0755 chrome-wrapper.sh /opt/hypercli/bin/hypercli-chrome
RUN mkdir -p /etc/opt/chrome/policies/managed \
    && ln -sf /opt/hypercli/bin/hypercli-chrome /usr/local/bin/hypercli-chrome \
    && node /opt/hypercli/lib/patch-novnc.mjs /usr/share/novnc
COPY --chmod=0644 google-chrome.desktop /usr/share/applications/google-chrome.desktop
COPY --chmod=0644 google-chrome.desktop /usr/share/applications/com.google.Chrome.desktop
# Managed Chrome policy: hypercli-chrome launches Chrome with --no-sandbox
# (agent pods are not guaranteed the kernel primitives Chrome's sandbox
# needs; the pod/namespace boundary is the security boundary). That flag
# would trigger the "You are using an unsupported command-line flag"
# infobar in every desktop session; this is the documented enterprise
# policy (chrome.*:76+, local-state pref
# browser.command_line_flag_security_warnings_enabled) that suppresses
# exactly that warning. --test-type would also suppress it but flips broad
# automated-test behavior across Chrome, so it stays out of the flag list.
COPY --chmod=0644 chrome-policies-managed.json /etc/opt/chrome/policies/managed/hypercli.json
COPY --chmod=0644 hyper-desktop.html /usr/share/novnc/hyper-desktop.html
RUN test -f /usr/share/novnc/core/rfb.js \
    && chmod -R a+rX /opt/hypercli

ENV HOME=/home/node \
    HYPER_AGENTS_API_BASE=https://api.agents.hypercli.com \
    HYPER_API_BASE=https://api.hypercli.com \
    HYPER_AGENTS_WEB_SEARCH_BASE=https://api.agents.hypercli.com/agents/brave \
    HYPER_WORKSPACES_DIR=/home/node/shared \
    HYPER_DESKTOP_ENABLED=0 \
    HYPER_DESKTOP_PORT=3000 \
    HYPER_DESKTOP_GEOMETRY=1280x800x24 \
    DISPLAY=:99 \
    CHROME_EXECUTABLE_PATH=/opt/hypercli/bin/hypercli-chrome \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/hypercli/bin/hypercli-chrome \
    PATH=/opt/hypercli/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /home/node
USER node
HEALTHCHECK NONE
