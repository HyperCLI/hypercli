# Dev Server (Traefik Reverse Proxy)

Exposes all local Next.js dev servers at public HTTPS hostnames via Traefik + Let's Encrypt.

| App     | Port | Default Hostname            |
|---------|------|-----------------------------|
| main    | 4000 | main.dev.hypercli.com       |
| console | 4001 | console.dev.hypercli.com    |
| claw    | 4003 | claw.dev.hypercli.com       |

## Setup

1. Point DNS records to this machine for each hostname.
2. Copy `.env.example` to `.env` and set hostnames + email.
3. Create the ACME storage:

```bash
mkdir -p acme && touch acme/acme.json && chmod 600 acme/acme.json
```

4. Start the proxy:

```bash
docker compose up -d
```

## Notes

- Uses host networking — Traefik forwards to `127.0.0.1:<port>`.
- ACME state (`acme/`) is gitignored. Never commit it.
- Restart Traefik after `.env` changes: `docker compose down && docker compose up -d`
