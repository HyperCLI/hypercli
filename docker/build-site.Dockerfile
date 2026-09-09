FROM node:24-bookworm

WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends rsync \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g netlify-cli

COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci

COPY site/package*.json /workspace/site/
COPY site/apps/main/package.json /workspace/site/apps/main/package.json
COPY site/apps/console/package.json /workspace/site/apps/console/package.json
COPY site/apps/claw/package.json /workspace/site/apps/claw/package.json
COPY site/packages/shared-ui/package.json /workspace/site/packages/shared-ui/package.json
COPY site/mock-server/package.json /workspace/site/mock-server/package.json
WORKDIR /workspace/site
RUN npm ci

WORKDIR /workspace/ts-sdk
RUN npm ci

COPY .github/scripts/site_container_entrypoint.sh /usr/local/bin/site_container_entrypoint
RUN chmod +x /usr/local/bin/site_container_entrypoint

WORKDIR /workspace/site

CMD ["site_container_entrypoint"]
