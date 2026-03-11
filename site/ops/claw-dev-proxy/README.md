# Claw Dev Proxy

This stack exposes the local Claw dev server running on `localhost:4003` at a public HTTPS hostname with Traefik and Let's Encrypt.

## Prerequisites

- DNS for the chosen hostname points to this machine
- Ports `80` and `443` are reachable from the internet
- The Claw app is running locally on port `4003`

## Setup

1. Copy `.env.example` to `.env` and set `DOMAIN` plus `LETSENCRYPT_EMAIL`.
2. Create the ACME storage file:

```bash
cd /home/ubuntu/dev/hypercli/site/ops/claw-dev-proxy
mkdir -p .acme
touch .acme/acme.json
chmod 600 .acme/acme.json
```

3. Start the proxy:

```bash
docker compose up -d
```

## Notes

- Traefik terminates TLS and forwards requests to `http://host.docker.internal:4003`.
- The container uses host networking, so upstream traffic goes directly to `http://127.0.0.1:4003`.
- If you restart the local Next.js dev server, Traefik will keep routing to it without further changes.
