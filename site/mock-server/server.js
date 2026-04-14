const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { faker } = require('@faker-js/faker');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// ============================================================================
// DATA GENERATORS - Realistic Mock Data
// ============================================================================

function generateUser() {
  return {
    id: uuidv4(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    created_at: faker.date.past().toISOString(),
  };
}

function generateAgent(overrides = {}) {
  const id = overrides.id || uuidv4();
  const states = ['STOPPED', 'PENDING', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR'];
  const state = overrides.state || faker.helpers.arrayElement(states);

  return {
    id,
    name: overrides.name || faker.commerce.productName(),
    state,
    hostname: state === 'RUNNING' ? `localhost:8000` : null,
    openclaw_url: state === 'RUNNING' ? `ws://localhost:8000/gateway/${id}` : null,
    type: faker.helpers.arrayElement(['nano', 'small', 'medium', 'large']),
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    budget: faker.number.float({ min: 10, max: 1000, precision: 0.01 }),
    spent: faker.number.float({ min: 0, max: 500, precision: 0.01 }),
    image: `ghcr.io/hypercli/agent:${faker.hacker.abbreviation()}`,
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    },
    ...overrides,
  };
}

function generateApiKey() {
  return {
    ref: uuidv4(),
    name: faker.commerce.productName() + ' Key',
    key: `sk_${faker.string.alphanumeric(32)}`,
    created_at: faker.date.past().toISOString(),
    last_used_at: faker.date.recent().toISOString(),
    disabled: faker.datatype.boolean(0.1),
  };
}

function generatePlan() {
  return {
    id: faker.string.numeric(1),
    name: faker.helpers.arrayElement(['Starter', 'Pro', 'Enterprise']),
    tier: faker.helpers.arrayElement(['free', 'pro', 'enterprise']),
    price: faker.number.float({ min: 0, max: 500, precision: 0.01 }),
    tokens_per_month: faker.number.int({ min: 100000, max: 10000000 }),
    requests_per_month: faker.number.int({ min: 1000, max: 1000000 }),
    features: [
      'API Access',
      'Agents',
      'File Management',
      'WebSocket Support',
    ],
  };
}

function generateUsageStats() {
  return {
    period_start: faker.date.past().toISOString(),
    period_end: faker.date.recent().toISOString(),
    total_tokens: faker.number.int({ min: 1000, max: 500000 }),
    total_requests: faker.number.int({ min: 100, max: 50000 }),
    total_cost: faker.number.float({ min: 0, max: 500, precision: 0.01 }),
  };
}

function generatePayment() {
  return {
    id: uuidv4(),
    plan_id: faker.string.numeric(1),
    amount: faker.number.float({ min: 10, max: 500, precision: 0.01 }),
    currency: 'USD',
    status: faker.helpers.arrayElement(['completed', 'pending', 'failed']),
    created_at: faker.date.past().toISOString(),
    method: faker.helpers.arrayElement(['stripe', 'x402', 'wire']),
  };
}

function generateSubscription() {
  return {
    id: uuidv4(),
    plan_id: faker.string.numeric(1),
    status: faker.helpers.arrayElement(['active', 'cancelled', 'suspended']),
    current_period_start: faker.date.past().toISOString(),
    current_period_end: faker.date.future().toISOString(),
    renewal_date: faker.date.future().toISOString(),
  };
}

function generateModel() {
  const providers = ['openai', 'anthropic', 'google', 'mistral', 'meta'];
  const provider = faker.helpers.arrayElement(providers);
  const models = {
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    google: ['gemini-pro', 'gemini-pro-vision'],
    mistral: ['mistral-large', 'mistral-medium'],
    meta: ['llama-2-70b', 'llama-2-13b'],
  };
  const modelName = faker.helpers.arrayElement(models[provider]);

  return {
    id: `${provider}/${modelName}`,
    name: modelName,
    provider,
    context_length: faker.number.int({ min: 4000, max: 200000 }),
    input_cost_per_1k_tokens: faker.number.float({ min: 0.0001, max: 0.1, precision: 0.00001 }),
    output_cost_per_1k_tokens: faker.number.float({ min: 0.0001, max: 0.3, precision: 0.00001 }),
    available: true,
  };
}

function generateFile(path = '') {
  return {
    path: path || `/workspace/${faker.system.fileName()}`,
    size: faker.number.int({ min: 1024, max: 10485760 }),
    modified_at: faker.date.recent().toISOString(),
    is_dir: false,
  };
}

function generateLog() {
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  return {
    timestamp: faker.date.recent().toISOString(),
    level: faker.helpers.arrayElement(levels),
    message: faker.hacker.phrase(),
    service: faker.helpers.arrayElement(['agent', 'gateway', 'worker']),
  };
}

// ============================================================================
// MOCK DATA STORAGE
// ============================================================================

const mockData = {
  users: new Map(),
  agents: new Map(),
  keys: new Map(),
  plans: new Map(),
  subscriptions: new Map(),
  payments: new Map(),
};

// Initialize with some fake data
function initializeData() {
  // Create a test user
  const testUser = generateUser();
  mockData.users.set(testUser.id, testUser);

  // Create some test agents - first one should be RUNNING
  for (let i = 0; i < 5; i++) {
    const agent = generateAgent({
      name: `Agent ${i + 1}`,
      state: i === 0 ? 'RUNNING' : faker.helpers.arrayElement(['STOPPED', 'RUNNING']),
    });
    mockData.agents.set(agent.id, agent);
  }

  // Create some API keys
  for (let i = 0; i < 3; i++) {
    const key = generateApiKey();
    mockData.keys.set(key.ref, key);
  }

  // Create plans
  for (let i = 0; i < 3; i++) {
    const plan = generatePlan();
    mockData.plans.set(plan.id, plan);
  }

  // Create subscriptions
  for (let i = 0; i < 2; i++) {
    const sub = generateSubscription();
    mockData.subscriptions.set(sub.id, sub);
  }

  // Create payments
  for (let i = 0; i < 5; i++) {
    const payment = generatePayment();
    mockData.payments.set(payment.id, payment);
  }
}

initializeData();

// ============================================================================
// MIDDLEWARE
// ============================================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token && req.path !== '/api/health' && !req.path.startsWith('/api/auth')) {
    // For testing, allow requests without token but in production you'd reject
    req.userId = 'test-user';
  } else {
    req.userId = 'authenticated-user';
  }

  next();
};

app.use(authenticateToken);

// ============================================================================
// ROUTES - Health & Auth
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

app.post('/api/auth/login', (req, res) => {
  const { token, email, password } = req.body;

  res.json({
    user_id: uuidv4(),
    team_id: uuidv4(),
    app_token: `app_${faker.string.alphanumeric(40)}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = Array.from(mockData.users.values())[0];
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    team_id: uuidv4(),
  });
});

// ============================================================================
// ROUTES - Agents
// ============================================================================

// Legacy endpoints (without /api prefix) - for SDK compatibility
app.get('/agents', (req, res) => {
  const agents = Array.from(mockData.agents.values());
  res.json(agents);
});

app.get('/agents/deployments', (req, res) => {
  const agents = Array.from(mockData.agents.values());
  res.json(agents);
});

app.get('/agents/deployments/budget', (req, res) => {
  const agents = Array.from(mockData.agents.values());
  const totalBudget = agents.reduce((sum, a) => sum + (a.budget || 0), 0);
  const totalSpent = agents.reduce((sum, a) => sum + (a.spent || 0), 0);

  res.json({
    total_budget: totalBudget,
    total_spent: totalSpent,
    remaining: totalBudget - totalSpent,
    agents_count: agents.length,
  });
});

app.get('/agents/deployments/:id/env', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json({
    env: agent.env || {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    },
  });
});

app.get('/agents/deployments/:id', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(agent);
});

app.get('/agents/deployments/:id/token', (req, res) => {
  res.json({
    token: `gw_${faker.string.alphanumeric(40)}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
});

app.post('/agents/deployments/:id/logs/token', (req, res) => {
  res.json({
    token: `log_${faker.string.alphanumeric(40)}`,
    ws_url: `ws://localhost:8000/ws/logs/${req.params.id}`,
  });
});

app.get('/agents/deployments/:id/logs/token', (req, res) => {
  res.json({
    token: `log_${faker.string.alphanumeric(40)}`,
    ws_url: `ws://localhost:8000/ws/logs/${req.params.id}`,
  });
});

app.post('/agents/deployments/:id/shell/token', (req, res) => {
  res.json({
    token: `shell_${faker.string.alphanumeric(40)}`,
    ws_url: `ws://localhost:8000/ws/shell/${req.params.id}`,
  });
});

app.get('/agents/deployments/:id/shell/token', (req, res) => {
  res.json({
    token: `shell_${faker.string.alphanumeric(40)}`,
    ws_url: `ws://localhost:8000/ws/shell/${req.params.id}`,
  });
});

app.post('/agents/deployments/:id/start', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  agent.state = 'STARTING';
  setTimeout(() => {
    agent.state = 'RUNNING';
    agent.hostname = `localhost:8000`;
    agent.openclaw_url = `ws://localhost:8000/gateway/${agent.id}`;
  }, 2000);
  res.json(agent);
});

app.post('/agents/deployments/:id/stop', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  agent.state = 'STOPPING';
  setTimeout(() => {
    agent.state = 'STOPPED';
    agent.hostname = null;
    agent.openclaw_url = null;
  }, 2000);
  res.json(agent);
});

app.delete('/agents/deployments/:id', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  mockData.agents.delete(req.params.id);
  res.json({ success: true });
});

// Standard /api prefix routes
app.get('/api/agents', (req, res) => {
  const agents = Array.from(mockData.agents.values());
  res.json({
    agents,
    total: agents.length,
  });
});

app.get('/api/agents/:id', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(agent);
});

app.get('/api/agents/:id/env', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json({
    env: agent.env || {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    },
  });
});

app.post('/api/agents', (req, res) => {
  const { name, type, budget } = req.body;
  const agent = generateAgent({ name, type, budget, state: 'STOPPED' });
  mockData.agents.set(agent.id, agent);
  res.status(201).json(agent);
});

app.post('/api/agents/:id/start', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  agent.state = 'STARTING';
  setTimeout(() => {
    agent.state = 'RUNNING';
    agent.hostname = `agent-${req.params.id.substring(0, 8)}.dev.hypercli.com`;
    agent.openclaw_url = `wss://openclaw-${req.params.id.substring(0, 8)}.dev.hypercli.com`;
  }, 2000);
  res.json(agent);
});

app.post('/api/agents/:id/stop', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  agent.state = 'STOPPING';
  setTimeout(() => {
    agent.state = 'STOPPED';
    agent.hostname = null;
    agent.openclaw_url = null;
  }, 2000);
  res.json(agent);
});

app.delete('/api/agents/:id', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  mockData.agents.delete(req.params.id);
  res.json({ success: true });
});

app.get('/api/agents/:id/token', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json({
    token: `gw_${faker.string.alphanumeric(40)}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
});

app.get('/api/agents/:id/logs/token', (req, res) => {
  res.json({
    token: `log_${faker.string.alphanumeric(40)}`,
    ws_url: 'wss://api.dev.hypercli.com/ws',
  });
});

app.get('/api/agents/:id/shell/token', (req, res) => {
  res.json({
    token: `shell_${faker.string.alphanumeric(40)}`,
    ws_url: 'wss://api.dev.hypercli.com/ws/shell',
  });
});

// ============================================================================
// ROUTES - Files
// ============================================================================

app.get('/api/agents/:id/files', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  const files = Array.from({ length: 5 }, (_, i) => generateFile(`/workspace/file${i}.txt`));
  res.json({ files });
});

app.get('/api/agents/:id/files/:filePath', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.send(faker.hacker.phrase());
});

app.put('/api/agents/:id/files/:filePath', (req, res) => {
  const agent = mockData.agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json({
    path: req.params.filePath,
    size: req.body ? Buffer.byteLength(JSON.stringify(req.body)) : 0,
    modified_at: new Date().toISOString(),
  });
});

// ============================================================================
// ROUTES - API Keys
// ============================================================================

app.get('/api/keys', (req, res) => {
  const keys = Array.from(mockData.keys.values());
  res.json({ keys });
});

app.post('/api/keys', (req, res) => {
  const { name } = req.body;
  const key = generateApiKey();
  key.name = name || key.name;
  mockData.keys.set(key.ref, key);
  res.status(201).json(key);
});

app.put('/api/keys/:ref', (req, res) => {
  const key = mockData.keys.get(req.params.ref);
  if (!key) {
    return res.status(404).json({ error: 'Key not found' });
  }
  if (req.body.name) key.name = req.body.name;
  res.json(key);
});

app.post('/api/keys/:ref/disable', (req, res) => {
  const key = mockData.keys.get(req.params.ref);
  if (!key) {
    return res.status(404).json({ error: 'Key not found' });
  }
  key.disabled = true;
  res.json(key);
});

// ============================================================================
// ROUTES - Plans & Billing
// ============================================================================

app.get('/api/plans', (req, res) => {
  const plans = Array.from(mockData.plans.values());
  res.json({ plans });
});

app.get('/api/plans/current', (req, res) => {
  const plans = Array.from(mockData.plans.values());
  const currentPlan = plans[0] || generatePlan();
  res.json(currentPlan);
});

app.get('/api/subscriptions', (req, res) => {
  const subscriptions = Array.from(mockData.subscriptions.values());
  res.json({ subscriptions });
});

app.get('/api/payments', (req, res) => {
  const payments = Array.from(mockData.payments.values());
  res.json({ payments });
});

app.post('/api/payments', (req, res) => {
  const { plan_id, amount } = req.body;
  const payment = generatePayment();
  payment.plan_id = plan_id;
  payment.amount = amount;
  mockData.payments.set(payment.id, payment);
  res.status(201).json(payment);
});

app.get('/api/billing/profile', (req, res) => {
  res.json({
    id: uuidv4(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    country: faker.location.country(),
    postal_code: faker.location.zipCode(),
  });
});

app.post('/api/billing/profile', (req, res) => {
  res.json({
    id: uuidv4(),
    ...req.body,
    updated_at: new Date().toISOString(),
  });
});

// ============================================================================
// ROUTES - Usage & Analytics
// ============================================================================

app.get('/api/usage', (req, res) => {
  res.json(generateUsageStats());
});

app.get('/api/usage/history', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const history = Array.from({ length: days }, () => generateUsageStats());
  res.json({ history });
});

app.get('/api/usage/keys', (req, res) => {
  const keys = Array.from(mockData.keys.values());
  const keyStats = keys.map(key => ({
    key_ref: key.ref,
    key_name: key.name,
    ...generateUsageStats(),
  }));
  res.json({ keys: keyStats });
});

// ============================================================================
// ROUTES - Models
// ============================================================================

app.get('/api/agents/models', (req, res) => {
  const models = Array.from({ length: 12 }, () => generateModel());
  res.json({ models });
});

// Agent types (both with and without /api prefix)
const agentTypes = {
  types: [
    {
      id: 'nano',
      name: 'Nano',
      description: 'Small agent for lightweight tasks',
      cpu: 0.25,
      memory: '256Mi',
    },
    {
      id: 'small',
      name: 'Small',
      description: 'Small agent for standard tasks',
      cpu: 0.5,
      memory: '512Mi',
    },
    {
      id: 'medium',
      name: 'Medium',
      description: 'Medium agent for moderate workloads',
      cpu: 1,
      memory: '1Gi',
    },
    {
      id: 'large',
      name: 'Large',
      description: 'Large agent for intensive workloads',
      cpu: 2,
      memory: '2Gi',
    },
  ],
};

app.get('/agents/types', (req, res) => {
  res.json(agentTypes);
});

app.get('/api/types', (req, res) => {
  res.json(agentTypes);
});

// ============================================================================
// ROUTES - Well-Known & Metadata
// ============================================================================

app.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: 'http://localhost:8000',
    authorization_endpoint: 'http://localhost:8000/auth',
    token_endpoint: 'http://localhost:8000/token',
    userinfo_endpoint: 'http://localhost:8000/userinfo',
  });
});

// ============================================================================
// ROUTES - Error Handling
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// WEBSOCKET GATEWAY PROTOCOL (OpenClaw Gateway v3)
// ============================================================================
// 1. Server → {type:"event", event:"connect.challenge", payload:{nonce}}
// 2. Client → {type:"req", id, method:"connect", params}
// 3. Server → {type:"res", id, ok:true, payload:{server, protocol, auth}}
// 4. Events: {type:"event", event, payload, seq}
// 5. RPC: {type:"req", id, method, params} ↔ {type:"res", id, ok, payload}

const gatewayConnections = new Map();
let gatewayEventSeq = 0;

function gwEvent(ws, event, payload) {
  gatewayEventSeq += 1;
  ws.send(JSON.stringify({ type: 'event', event, payload: payload || {}, seq: gatewayEventSeq }));
}

function gwResponse(ws, id, payload) {
  ws.send(JSON.stringify({ type: 'res', id, ok: true, payload: payload || {} }));
}

// ============================================================================
// CHAT TRIGGER SYSTEM
// ============================================================================
// Keyword-based triggers that produce different response types for testing.
// Match is case-insensitive and checks if the user message CONTAINS the keyword.
// ============================================================================

const CHAT_TRIGGERS = [
  {
    keyword: '/help',
    description: 'Show available triggers',
    handler: (ws) => {
      const helpText = `Available mock triggers:\n\n${CHAT_TRIGGERS.map(t => `• **${t.keyword}** — ${t.description}`).join('\n')}`;
      setTimeout(() => gwEvent(ws, 'chat.content', { text: helpText }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 300);
    },
  },

  {
    keyword: '/think',
    description: 'Thinking response. Optional duration: /think 5s, /think 2000ms, /think 10',
    handler: (ws, userContent) => {
      // Parse optional duration: /think 5s, /think 2000ms, /think 10 (seconds)
      const match = userContent.match(/\/think(?:\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?)?)?/i);
      let totalDurationMs = 2000; // default: 2 seconds
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        const unit = (match[2] || 's').toLowerCase();
        if (unit === 'ms') totalDurationMs = value;
        else if (unit.startsWith('m') && unit !== 'ms') totalDurationMs = value * 60_000;
        else totalDurationMs = value * 1000;
      }
      // Clamp between 100ms and 10 minutes
      totalDurationMs = Math.max(100, Math.min(totalDurationMs, 600_000));

      const thinkingChunks = [
        'Let me think carefully about this request...',
        '\n\nFirst, I need to understand what the user is asking for.',
        '\n\nStep 1: Analyze the input',
        '\n\nStep 2: Consider different approaches',
        '\n\nStep 3: Evaluate trade-offs',
        '\n\nStep 4: Formulate the best response',
        '\n\nAlmost done reasoning through this...',
      ];

      // Distribute thinking chunks evenly across the duration
      const chunkInterval = totalDurationMs / (thinkingChunks.length + 1);
      thinkingChunks.forEach((chunk, i) => {
        setTimeout(() => gwEvent(ws, 'chat.thinking', { text: chunk }), chunkInterval * (i + 1));
      });

      // Send the final content after thinking is done
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: `Here is my answer after thinking for ${(totalDurationMs / 1000).toFixed(1)}s.`,
      }), totalDurationMs + 100);

      setTimeout(() => gwEvent(ws, 'chat.done', {
        stop_reason: 'end_turn',
      }), totalDurationMs + 400);
    },
  },

  {
    keyword: '/tool',
    description: 'Simulate a tool call with result',
    handler: (ws) => {
      const toolCallId = `call_${faker.string.alphanumeric(16)}`;

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Let me search for that information.',
      }), 100);

      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId,
        name: 'web_search',
        args: { query: 'mock search query' },
      }), 400);

      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId,
        name: 'web_search',
        result: 'Mock search results:\n1. Example Result A\n2. Example Result B\n3. Example Result C',
      }), 1000);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: '\n\nBased on the search results, here is what I found...',
      }), 1400);

      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 1700);
    },
  },

  {
    keyword: '/tools',
    description: 'Multiple tool calls in sequence',
    handler: (ws) => {
      const tool1 = `call_${faker.string.alphanumeric(16)}`;
      const tool2 = `call_${faker.string.alphanumeric(16)}`;

      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: tool1, name: 'read_file', args: { path: '/etc/config' },
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: tool1, name: 'read_file', result: 'file contents here',
      }), 500);

      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: tool2, name: 'run_command', args: { cmd: 'ls -la' },
      }), 800);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: tool2, name: 'run_command', result: 'total 42\ndrwxr-xr-x ...',
      }), 1300);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'All tools executed successfully!',
      }), 1600);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 1900);
    },
  },

  {
    keyword: '/error',
    description: 'Simulate a chat error',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Starting to respond...',
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat.error', {
        code: 'MOCK_ERROR',
        message: 'Mock error: rate limit exceeded',
      }), 400);
    },
  },

  {
    keyword: '/long',
    description: 'Long streaming response',
    handler: (ws) => {
      const chunks = [
        'This is a long streaming response ',
        'that demonstrates how the mock gateway ',
        'can simulate realistic token-by-token streaming. ',
        'Each chunk is sent as a separate chat.content event ',
        'with a small delay between them, ',
        'making the response feel more natural. ',
        'This is useful for testing UI rendering ',
        'of streaming text, loading states, ',
        'and scroll-to-bottom behavior. ',
        'The response continues for several sentences ',
        'to give you a good sample to work with.',
      ];
      chunks.forEach((chunk, i) => {
        setTimeout(() => gwEvent(ws, 'chat.content', { text: chunk }), 100 + i * 150);
      });
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 100 + chunks.length * 150 + 200);
    },
  },

  {
    keyword: '/markdown',
    description: 'Response with markdown formatting',
    handler: (ws) => {
      const md = `# Markdown Test\n\n## Features\n\n- **Bold text**\n- *Italic text*\n- \`inline code\`\n\n\`\`\`javascript\nfunction hello() {\n  console.log("Hello, world!");\n}\n\`\`\`\n\n> This is a blockquote\n\n| Col 1 | Col 2 |\n|-------|-------|\n| A     | B     |\n| C     | D     |`;
      setTimeout(() => gwEvent(ws, 'chat.content', { text: md }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 400);
    },
  },

  {
    keyword: '/code',
    description: 'Response with code blocks',
    handler: (ws) => {
      const code = '```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))\n```';
      setTimeout(() => gwEvent(ws, 'chat.content', { text: 'Here is a Python example:\n\n' + code }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 400);
    },
  },

  {
    keyword: '/slow',
    description: 'Slow response (5 second delay)',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'This response took 5 seconds to generate.',
      }), 5000);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 5200);
    },
  },

  {
    keyword: '/image',
    description: 'Response with image URL',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Here is the image you requested:',
        mediaUrls: ['https://picsum.photos/400/300'],
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 400);
    },
  },

  {
    keyword: '/max_tokens',
    description: 'Stop reason: max_tokens',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'This response was cut off because it reached the maximum token limit...',
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'max_tokens' }), 400);
    },
  },

  {
    keyword: '/refuse',
    description: 'Stop reason: refusal',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'I cannot help with that request.',
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'refusal' }), 400);
    },
  },

  {
    keyword: '/snapshot',
    description: 'Snapshot mode: full message via "chat" event',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat', {
        message: {
          role: 'assistant',
          text: 'This is a snapshot-mode message sent as a complete payload rather than streaming.',
          thinking: '',
          toolCalls: [],
          mediaUrls: [],
          timestamp: Date.now(),
        },
        state: 'partial',
      }), 100);
      setTimeout(() => gwEvent(ws, 'chat', {
        message: {
          role: 'assistant',
          text: 'This is a snapshot-mode message sent as a complete payload rather than streaming.\n\nSnapshot mode delivers the entire message at once.',
          thinking: '',
          toolCalls: [],
          mediaUrls: [],
          timestamp: Date.now(),
        },
        state: 'final',
      }), 600);
    },
  },

  {
    keyword: '/agent_tool',
    description: 'Agent event with tool stream (HYP-27 format)',
    handler: (ws) => {
      const toolCallId = `call_${faker.string.alphanumeric(16)}`;

      setTimeout(() => gwEvent(ws, 'agent', {
        stream: 'tool',
        data: {
          phase: 'start',
          name: 'bash',
          toolCallId,
          args: { command: 'ls -la /tmp' },
        },
      }), 100);

      setTimeout(() => gwEvent(ws, 'agent', {
        stream: 'tool',
        data: {
          phase: 'result',
          name: 'bash',
          toolCallId,
          meta: 'total 24\ndrwxrwxrwt  8 root root  4096 Jan  1 00:00 .\ndrwxr-xr-x 20 root root  4096 Jan  1 00:00 ..',
          isError: false,
        },
      }), 800);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'The command executed successfully.',
      }), 1200);

      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 1500);
    },
  },

  {
    keyword: '/agent_tool_error',
    description: 'Agent tool stream with error',
    handler: (ws) => {
      const toolCallId = `call_${faker.string.alphanumeric(16)}`;

      setTimeout(() => gwEvent(ws, 'agent', {
        stream: 'tool',
        data: {
          phase: 'start',
          name: 'read_file',
          toolCallId,
          args: { path: '/missing' },
        },
      }), 100);

      setTimeout(() => gwEvent(ws, 'agent', {
        stream: 'tool',
        data: {
          phase: 'result',
          name: 'read_file',
          toolCallId,
          meta: 'ENOENT: no such file or directory',
          isError: true,
        },
      }), 600);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'The file could not be read. Let me try a different approach.',
      }), 1000);

      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 1300);
    },
  },
];

function simulateChatResponse(ws, userContent) {
  const lower = userContent.toLowerCase().trim();

  // Check for keyword triggers
  for (const trigger of CHAT_TRIGGERS) {
    if (lower.includes(trigger.keyword.toLowerCase())) {
      trigger.handler(ws, userContent);
      return;
    }
  }

  // Default: echo response
  setTimeout(() => gwEvent(ws, 'chat.content', {
    text: `Echo from mock: ${userContent}`,
  }), 200);
  setTimeout(() => gwEvent(ws, 'chat.content', {
    text: '\n\nType `/help` to see available test triggers.',
  }), 500);
  setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 800);
}

wss.on('connection', (ws, req) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  if (pathParts[0] !== 'gateway') {
    ws.close(1002, 'unknown endpoint');
    return;
  }

  const agentId = pathParts[1] || 'mock-agent';
  console.log(`[Gateway] Client connected for agent: ${agentId}`);
  gatewayConnections.set(agentId, ws);

  // Step 1: Send connect.challenge with a nonce
  const nonce = uuidv4();
  setTimeout(() => gwEvent(ws, 'connect.challenge', { nonce }), 50);

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type !== 'req') return;
    const { id, method, params } = message;
    console.log(`[Gateway] ${agentId} → ${method}`);

    // Step 3: Handle connect handshake
    if (method === 'connect') {
      gwResponse(ws, id, {
        server: { version: '3.0.0-mock', name: 'mock-gateway' },
        protocol: 3,
        auth: {
          role: 'operator',
          scopes: ['chat', 'files', 'config'],
          deviceToken: `mock_device_${faker.string.alphanumeric(32)}`,
        },
      });
      return;
    }

    switch (method) {
      // ---- Chat ----
      case 'chat.history':
        gwResponse(ws, id, {
          messages: [
            {
              role: 'assistant',
              text: 'Hello! I am a mocked agent. Send me a message and I will echo it back!',
              thinking: '',
              toolCalls: [],
              mediaUrls: [],
              timestamp: Date.now(),
            },
          ],
        });
        break;

      case 'chat.send': {
        const userContent =
          params?.text ||
          params?.content ||
          params?.message ||
          (Array.isArray(params?.messages) ? params.messages[params.messages.length - 1]?.text : '') ||
          '';
        gwResponse(ws, id, { ok: true });

        simulateChatResponse(ws, userContent);
        break;
      }

      case 'chat.abort':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Config ----
      case 'config.get':
        gwResponse(ws, id, {
          config: {
            name: 'mock-agent',
            version: '1.0.0',
            model: 'claude-sonnet-4-6',
            system_prompt: 'You are a helpful mock assistant.',
          },
          hash: 'mock-hash-1',
          baseHash: 'mock-hash-0',
        });
        break;

      case 'config.patch':
      case 'config.apply':
      case 'config.set':
        gwResponse(ws, id, {
          ok: true,
          hash: 'mock-hash-2',
          baseHash: 'mock-hash-1',
        });
        break;

      case 'config.schema':
        gwResponse(ws, id, {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Agent Name' },
              model: { type: 'string', title: 'Model' },
              system_prompt: { type: 'string', title: 'System Prompt' },
            },
          },
        });
        break;

      // ---- Sessions ----
      case 'sessions.list':
        gwResponse(ws, id, { sessions: [] });
        break;

      case 'sessions.preview':
        gwResponse(ws, id, { previews: {} });
        break;

      case 'sessions.patch':
      case 'sessions.reset':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Files ----
      case 'agents.files.list':
        gwResponse(ws, id, {
          files: [
            { name: 'README.md', size: 1024, missing: false },
            { name: 'config.json', size: 512, missing: false },
          ],
        });
        break;

      case 'agents.files.get':
        gwResponse(ws, id, {
          content: `# Mock file: ${params?.name || 'unknown'}\n\nThis is mocked file content.`,
        });
        break;

      case 'agents.files.set':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Agents ----
      case 'agents.list':
        gwResponse(ws, id, {
          agents: [
            { id: 'main', name: 'Main Agent', state: 'RUNNING' },
          ],
        });
        break;

      case 'agents.get':
        gwResponse(ws, id, {
          agent: {
            id: params?.agentId || 'main',
            name: 'Main Agent',
            state: 'RUNNING',
          },
        });
        break;

      // ---- Models ----
      case 'models.list':
        gwResponse(ws, id, {
          models: [
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
          ],
        });
        break;

      // ---- Channels ----
      case 'channels.status':
        gwResponse(ws, id, { connected: false, channel: params?.channel || 'unknown' });
        break;

      case 'channels.logout':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Web Auth ----
      case 'web.login.start':
        gwResponse(ws, id, {
          url: 'https://example.com/mock-login',
          requestId: uuidv4(),
        });
        break;

      case 'web.login.wait':
        gwResponse(ws, id, { success: true });
        break;

      // ---- Cron ----
      case 'cron.list':
        gwResponse(ws, id, { crons: [], jobs: [] });
        break;

      case 'cron.add':
        gwResponse(ws, id, { jobId: uuidv4() });
        break;

      case 'cron.remove':
      case 'cron.run':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Execution ----
      case 'exec.approve':
      case 'exec.deny':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Status ----
      case 'status':
        gwResponse(ws, id, {
          status: 'ok',
          uptime: Math.floor(Date.now() / 1000),
        });
        break;

      default:
        console.warn(`[Gateway] Unknown method: ${method}`);
        gwResponse(ws, id, { ok: true });
    }
  });

  ws.on('close', () => {
    gatewayConnections.delete(agentId);
    console.log(`[Gateway] Client disconnected: ${agentId}`);
  });

  ws.on('error', (error) => {
    console.error(`[Gateway] Error for ${agentId}:`, error.message);
  });
});

// ============================================================================
// START SERVER
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Mock Agents API running on http://localhost:${PORT}`);
  console.log(`📡 Health check: GET http://localhost:${PORT}/api/health\n`);
  console.log('📚 Key endpoints:');
  console.log('   GET    /api/agents');
  console.log('   POST   /api/agents');
  console.log('   GET    /api/agents/{id}');
  console.log('   POST   /api/agents/{id}/start');
  console.log('   POST   /api/agents/{id}/stop');
  console.log('   GET    /api/plans');
  console.log('   GET    /api/keys');
  console.log('   GET    /api/usage\n');
});
