FROM node:24-bookworm

WORKDIR /workspace
RUN npm install -g netlify-cli

COPY .github/scripts/site_container_entrypoint.sh /usr/local/bin/site_container_entrypoint
RUN chmod +x /usr/local/bin/site_container_entrypoint

WORKDIR /workspace/site

CMD ["site_container_entrypoint"]
