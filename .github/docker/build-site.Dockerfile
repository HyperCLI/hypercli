FROM node:24-bookworm

WORKDIR /workspace
RUN npm install -g netlify-cli

COPY ts-sdk/package*.json /workspace/ts-sdk/
WORKDIR /workspace/ts-sdk
RUN npm ci

COPY ts-sdk /workspace/ts-sdk/
RUN npm run build

WORKDIR /workspace
COPY site /workspace/site/
COPY .github/scripts/site_container_entrypoint.sh /usr/local/bin/site_container_entrypoint
RUN chmod +x /usr/local/bin/site_container_entrypoint

WORKDIR /workspace/site
RUN npm ci

CMD ["site_container_entrypoint"]
