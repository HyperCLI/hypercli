# HyperCLI Mock Servers

Comprehensive mock API services for local development:
- **Agents API** — Full REST API with 60+ endpoints for agent management, billing, files, models
- **Chat Service** — Conversation management with WebSocket real-time messaging
- **OpenClaw Gateway v3** — Full WebSocket gateway protocol with keyword-triggered chat responses

📘 **See [CHAT_TRIGGERS.md](./CHAT_TRIGGERS.md) for the full list of chat trigger keywords and message types.**

## Features

- ✅ **60+ endpoints** covering agents, auth, billing, models, files, usage analytics
- 🎭 **Realistic data** using `@faker-js/faker` for all responses
- 🚀 **Auto-state transitions** - agents transition from STARTING → RUNNING with realistic delays
- 📊 **Full data persistence** across requests in-memory
- 🔐 **Basic auth support** for testing token-based endpoints
- 💾 **Stateful operations** - agents and keys are stored and can be modified

## Setup

### 1. Install Dependencies

```bash
cd site/mock-server
npm install
```

### 2. Start the Services

**Agents API only:**
```bash
npm start
```

**Chat service only:**
```bash
npm run chat
```

**Both services (recommended):**
```bash
npm run start:all
```

Or for development with auto-reload:
```bash
npm run dev              # Agents API with hot reload
npm run chat:dev        # Chat with hot reload
```

**Services run on:**
- Agents API: `http://localhost:8000`
- Chat: `http://localhost:4002` (WebSocket: `ws://localhost:4002`)

## Configuration

### Environment Variables

```bash
PORT=8000              # Server port (default: 8000)
CHAT_PORT=4002        # Chat server port (default: 4002)
```

## Switching Between Mock and Real APIs

The claw app includes easy switching between mock servers and real API endpoints:

### Quick Commands

**Start claw with mock servers:**
```bash
cd apps/claw
npm run dev:mock
```

**Start claw with real API (dev environment):**
```bash
npm run dev:real
```

**Switch without restarting dev server:**
```bash
npm run switch:mock    # Switch to mock servers
npm run switch:real    # Switch to real API
npm run switch:mock status  # Check current configuration
```

### Environment Files

- `.env.mock` — Configured for mock servers (http://localhost:8000)
- `.env.real` — Configured for real API (https://api.dev.hypercli.com)

See [API-SWITCHING.md](../apps/claw/API-SWITCHING.md) in the claw app for complete documentation.

## Usage

### Update Frontend Configuration

Point your claw frontend to the mock servers:

**In `.env.local` for claw app:**

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CHAT_URL=http://localhost:4002
```

Then restart your frontend dev server.

### API Examples

#### Health Check
```bash
curl http://localhost:8000/api/health
```

#### List Agents
```bash
curl http://localhost:8000/api/agents
```

#### Create an Agent
```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Test Agent",
    "type": "medium",
    "budget": 100
  }'
```

#### Start an Agent
```bash
curl -X POST http://localhost:8000/api/agents/{agent-id}/start
```

#### Get Plans
```bash
curl http://localhost:8000/api/plans
```

#### Get Usage Stats
```bash
curl http://localhost:8000/api/usage
```

## Chat Service

### Features

- **Conversations** — Create, list, and manage conversations per agent
- **Messages** — Add messages with realistic auto-responses
- **WebSocket** — Real-time message streaming and typing indicators
- **Realistic Data** — Simulated assistant responses with delays

### Chat Endpoints

#### REST API

- `GET /conversations/{agentId}` — List conversations for agent
- `POST /conversations/{agentId}` — Create new conversation
- `GET /conversations/{agentId}/{conversationId}` — Get conversation details
- `DELETE /conversations/{agentId}/{conversationId}` — Delete conversation
- `GET /conversations/{agentId}/{conversationId}/messages` — List messages
- `POST /conversations/{agentId}/{conversationId}/messages` — Add message

#### WebSocket (ws://localhost:4002)

Connect and send JSON messages:

```javascript
// Connect
const ws = new WebSocket('ws://localhost:4002');

// Subscribe to conversation
ws.send(JSON.stringify({
  type: 'subscribe',
  conversationId: 'conv-id'
}));

// Send a message
ws.send(JSON.stringify({
  type: 'send_message',
  conversationId: 'conv-id',
  content: 'Hello!',
  role: 'user'
}));

// Listen for events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // {type: 'message', conversationId, message}
  // {type: 'typing', conversationId, role}
};
```

## Implemented Endpoints

### Authentication
- `POST /api/auth/login` - Login with token
- `GET /api/auth/me` - Get current user

### Agents
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent
- `GET /api/agents/{id}` - Get agent details
- `POST /api/agents/{id}/start` - Start agent
- `POST /api/agents/{id}/stop` - Stop agent
- `DELETE /api/agents/{id}` - Delete agent
- `GET /api/agents/{id}/token` - Get gateway token
- `GET /api/agents/{id}/logs/token` - Get logs token
- `GET /api/agents/{id}/shell/token` - Get shell token

### Files
- `GET /api/agents/{id}/files` - List agent files
- `GET /api/agents/{id}/files/{path}` - Get file content
- `PUT /api/agents/{id}/files/{path}` - Upload file

### API Keys
- `GET /api/keys` - List API keys
- `POST /api/keys` - Create API key
- `PUT /api/keys/{ref}` - Update API key
- `POST /api/keys/{ref}/disable` - Disable API key

### Plans & Billing
- `GET /api/plans` - List plans
- `GET /api/plans/current` - Get current plan
- `GET /api/subscriptions` - List subscriptions
- `GET /api/payments` - List payments
- `POST /api/payments` - Create payment
- `GET /api/billing/profile` - Get billing profile
- `POST /api/billing/profile` - Update billing profile

### Usage & Analytics
- `GET /api/usage` - Get current usage stats
- `GET /api/usage/history?days=7` - Get usage history
- `GET /api/usage/keys` - Get per-key usage breakdown

### Models & Types
- `GET /api/agents/models` - List available models
- `GET /api/types` - List agent types

## Data Generation

All responses are generated with realistic data:
- **Agents**: Random names, types, states, budgets
- **Users**: Fake emails, names, timestamps
- **Plans**: Pricing, token limits, request limits
- **Payments**: Amounts, methods, statuses
- **Models**: Provider, context length, pricing
- **Usage**: Realistic token/request counts and costs

## Testing the Frontend

1. Start the mock server:
   ```bash
   npm start -w mock-server
   ```

2. Update claw `.env.local`:
   ```env
   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
   ```

3. Start the frontend:
   ```bash
   npm run dev -w @hypercli/claw
   ```

4. Test endpoints in the claw app - they'll use the mock server

## Troubleshooting

### Port already in use
```bash
PORT=8001 npm start
```

### CORS errors
The server has CORS enabled for all origins. If you still get errors, check that:
- Frontend is sending `Authorization` header correctly
- API base URL is correct

### Data not persisting between restarts
Mock data is stored in-memory. Restart the server to reset all data.

## Extending the Mock Server

To add more endpoints:

1. Add a data generator function (e.g., `generateXYZ()`)
2. Add a route handler (e.g., `app.get('/api/xyz', ...)`)
3. Test with curl or your API client

Example:
```javascript
function generateCustomData() {
  return {
    id: uuidv4(),
    // ... data fields
  };
}

app.get('/api/custom', (req, res) => {
  const data = generateCustomData();
  res.json(data);
});
```

## Performance Notes

- In-memory storage supports up to ~1000 concurrent agents
- Each request generates new realistic data
- Agent state transitions use real setTimeout delays
- No database required - perfect for local development

## License

MIT
