FROM node:22-bookworm

WORKDIR /workspace

COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci

COPY ts-sdk /workspace/ts-sdk/
RUN npm run build

WORKDIR /workspace
COPY site /workspace/site/

WORKDIR /workspace/site
RUN cp env.dev apps/main/.env.local \
  && cp env.dev apps/console/.env.local \
  && cp env.dev apps/claw/.env.local \
  && npm install \
  && npm run sdk:use-local

CMD ["npm", "run", "build"]
