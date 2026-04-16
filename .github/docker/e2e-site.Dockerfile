FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /workspace

COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci

COPY ts-sdk /workspace/ts-sdk/
RUN npm run build

WORKDIR /workspace
COPY .github /workspace/.github/
COPY site /workspace/site/

WORKDIR /workspace/site
RUN cp env.dev apps/main/.env.local \
  && cp env.dev apps/console/.env.local \
  && cp env.dev apps/claw/.env.local \
  && npm install \
  && npm run sdk:use-checkout

CMD ["bash"]
