FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci --no-audit --no-fund \
  && npm cache clean --force

COPY site/package*.json /workspace/site/
COPY site/apps/main/package.json /workspace/site/apps/main/package.json
COPY site/apps/console/package.json /workspace/site/apps/console/package.json
COPY site/apps/claw/package.json /workspace/site/apps/claw/package.json
COPY site/packages/shared-ui/package.json /workspace/site/packages/shared-ui/package.json
COPY site/mock-server/package.json /workspace/site/mock-server/package.json
WORKDIR /workspace/site
RUN npm ci --no-audit --no-fund \
  && npm cache clean --force

COPY ts-sdk /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm run build

WORKDIR /workspace
COPY .github /workspace/.github/
COPY notify /workspace/notify/
COPY site /workspace/site/
RUN cp site/env.dev site/apps/main/.env.local \
  && cp site/env.dev site/apps/console/.env.local \
  && cp site/env.dev site/apps/claw/.env.local

CMD ["bash"]
