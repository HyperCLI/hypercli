# Switching Between Mock and Real APIs

This guide explains how to easily switch your claw frontend between using local mock servers and the real API endpoints.

## Quick Start

### Using npm scripts (Recommended)

**Switch to mock servers and start development:**
```bash
npm run dev:mock
```

**Switch to real API and start development:**
```bash
npm run dev:real
```

**Just switch without starting dev server:**
```bash
npm run switch:mock   # Switch to mock servers
npm run switch:real   # Switch to real API
```

### Using shell scripts (Unix/Linux/macOS)

**Make script executable (first time only):**
```bash
chmod +x switch-api.sh
```

**Switch to mock servers:**
```bash
./switch-api.sh mock
```

**Switch to real API:**
```bash
./switch-api.sh real
```

**Check current configuration:**
```bash
./switch-api.sh status
```

### Using batch scripts (Windows)

**Switch to mock servers:**
```bash
switch-api.bat mock
```

**Switch to real API:**
```bash
switch-api.bat real
```

**Check current configuration:**
```bash
switch-api.bat status
```

## Environment Files

### `.env.mock`
Points to local mock servers:
- **Agents API:** `http://localhost:8000`
- **Chat:** `http://localhost:4002`

### `.env.real`
Points to real development API:
- **Agents API:** `https://api.dev.hypercli.com`
- **Chat:** `https://chat.dev.hypercli.com`

## Workflow Example

### Development with Mock Servers

1. **Start mock servers** (in one terminal):
```bash
cd site
npm run mock-server:all
```

Output:
```
🚀 Mock Agents API running on http://localhost:8000
🚀 Mock Chat Server running on http://localhost:4002
```

2. **Start claw with mock config** (in another terminal):
```bash
cd site/apps/claw
npm run dev:mock
```

3. **Test your changes** against mock data with no network latency

4. **Switch to real API** when ready to test integration:
```bash
npm run switch:real
# Restart dev server manually (or the change will take effect on next reload)
```

5. **Verify against real API** before committing

## What's Different?

| Aspect | Mock Servers | Real API |
|--------|---------|----------|
| Speed | ⚡ Instant responses | 🌐 Network latency |
| Data | 🎭 Realistic faker data | 📊 Real user data |
| Consistency | ✅ Always responds | ⚠️ May be down/changing |
| Errors | 🎯 Predictable | 🔀 Real edge cases |
| State Changes | ⏱️ Simulated delays | 🔄 Real transitions |
| Chat | 🤖 Auto-responses | 💬 Real assistant |
| WebSocket | ✅ Supported | ✅ Supported |

## Troubleshooting

### Mock servers not responding
```bash
# Check if servers are running
curl http://localhost:8000/api/health
curl http://localhost:4002/health

# Restart mock servers
npm run mock-server:all
```

### Changes not taking effect
```bash
# When you switch APIs, restart the dev server:
# Press Ctrl+C to stop
# Then: npm run dev:mock  or  npm run dev:real
```

### Verify current configuration
```bash
npm run switch:mock status   # Shows which API is configured
```

### Port conflicts
If ports 8000 or 4002 are already in use:

```bash
# Check what's using port 8000
lsof -i :8000          # macOS/Linux
netstat -ano | grep 8000  # Windows

# Kill the process or use different port
PORT=8001 npm run mock-server  # Use different port
```

## Advanced: Custom Environments

You can create additional environment files for different scenarios:

```bash
# Create a production config
cp .env.mock .env.prod-test

# Edit it as needed
nano .env.prod-test

# Use it
npm run dev
# Then manually update .env.local with your custom file
```

## CI/CD Notes

When deploying or running tests, specify which API to use:

```bash
# Use mock servers for unit tests
npm run switch:mock && npm run build

# Use real API for integration tests
npm run switch:real && npm run build
```

## Environment Variables Reference

Key variables that differ between mock and real:

```bash
# Agents/Main API
NEXT_PUBLIC_API_BASE_URL

# Chat service
NEXT_PUBLIC_CHAT_URL

# Auth backend
NEXT_PUBLIC_AUTH_BACKEND

# WebSocket URLs
NEXT_PUBLIC_WS_URL
NEXT_PUBLIC_AGENTS_WS_URL

# Additional services
NEXT_PUBLIC_INSTANCES_API_URL
NEXT_PUBLIC_LLM_API_URL
NEXT_PUBLIC_BOT_API_URL
NEXT_PUBLIC_HYPER_AGENT_MODELS_URL
```

All these are pre-configured in `.env.mock` and `.env.real`.

## Tips

1. **Always use `dev:mock` or `dev:real`** — These handle both switching and starting the dev server

2. **Check status before committing** — Use `switch:mock status` to verify which API is configured

3. **Mock servers reset on restart** — In-memory data is lost, but regenerated with new fake data

4. **Real API requires auth** — If testing real API, ensure you have valid credentials in your browser

5. **WebSocket works with both** — Chat WebSocket works with both mock and real servers

## See Also

- [Mock Server README](../../mock-server/README.md) — Detailed mock server documentation
- [Claw App Guide](../../CLAUDE.md) — Full claw application architecture
