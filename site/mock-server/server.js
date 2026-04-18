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
  const tier = overrides.type || faker.helpers.arrayElement(['small', 'medium', 'large']);
  const tierPresets = { small: { cpu: 1, memory: 1 }, medium: { cpu: 2, memory: 2 }, large: { cpu: 4, memory: 4 } };
  const preset = tierPresets[tier] || tierPresets.small;
  const startedAt = state === 'RUNNING' ? faker.date.recent({ days: 2 }).toISOString() : null;

  return {
    id,
    name: overrides.name || faker.commerce.productName(),
    user_id: 'mock-user',
    pod_id: state === 'RUNNING' ? `pod-${id.slice(0, 8)}` : null,
    pod_name: state === 'RUNNING' ? `agent-${id.slice(0, 8)}` : null,
    state,
    cpu: preset.cpu,
    memory: preset.memory,
    cpu_millicores: preset.cpu * 1000,
    memory_mib: preset.memory * 1024,
    hostname: state === 'RUNNING' ? `localhost:8000` : null,
    openclaw_url: state === 'RUNNING' ? `ws://localhost:8000/gateway/${id}` : null,
    started_at: startedAt,
    stopped_at: state === 'STOPPED' ? faker.date.recent({ days: 1 }).toISOString() : null,
    last_error: null,
    type: tier,
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    budget: faker.number.float({ min: 10, max: 1000, precision: 0.01 }),
    spent: faker.number.float({ min: 0, max: 500, precision: 0.01 }),
    image: `ghcr.io/hypercli/agent:${faker.hacker.abbreviation()}`,
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    },
    meta: null,
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

  // Create some test agents - first one should be RUNNING with a stable ID
  const presetAgents = [
    { id: 'mock-agent-1', name: 'Mock Agent', state: 'RUNNING', type: 'medium' },
    { id: 'mock-agent-2', name: 'Telegram Bot', state: 'RUNNING', type: 'small' },
    { id: 'mock-agent-3', name: 'Research Assistant', state: 'STOPPED', type: 'large' },
    { id: 'mock-agent-4', name: 'Cron Runner', state: 'STOPPED', type: 'small' },
  ];
  presetAgents.forEach((preset) => {
    const agent = generateAgent(preset);
    mockData.agents.set(agent.id, agent);
  });

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
  // Count used slots per tier from running/transitioning agents
  const tierUsage = { small: 0, medium: 0, large: 0 };
  agents.forEach((a) => {
    if (['RUNNING', 'STARTING', 'PENDING', 'STOPPING'].includes(a.state)) {
      const tier = a.type || 'small';
      if (tierUsage[tier] !== undefined) tierUsage[tier] += 1;
    }
  });

  res.json({
    slots: {
      small:  { granted: 5, used: tierUsage.small,  available: Math.max(0, 5 - tierUsage.small) },
      medium: { granted: 3, used: tierUsage.medium, available: Math.max(0, 3 - tierUsage.medium) },
      large:  { granted: 1, used: tierUsage.large,  available: Math.max(0, 1 - tierUsage.large) },
    },
    pooled_tpd: 5_000_000,
    size_presets: {
      small:  { cpu: 1, memory: 1 },
      medium: { cpu: 2, memory: 2 },
      large:  { cpu: 4, memory: 4 },
    },
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

// Same endpoint without /api prefix (used by landing page ModelsSection via NEXT_PUBLIC_HYPER_AGENT_MODELS_URL)
app.get('/agents/models', (req, res) => {
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

// ---- Mutable sessions state (shared across the gateway connection lifetime) ----
// Sessions get their `lastMessageAt` bumped whenever the client sends a chat
// message, and an updated list is broadcast via a `sessions.updated` event so
// the Sessions module reflects activity in real time.
const mockSessions = [
  {
    key: 'main',
    clientMode: 'browser',
    clientDisplayName: 'Chrome on macOS',
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
    lastMessageAt: Date.now() - 1000 * 60 * 5,
  },
  {
    key: 'cli-local',
    clientMode: 'cli',
    clientDisplayName: 'hyperclaw CLI v0.4',
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    lastMessageAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  {
    key: 'tg-bot',
    clientMode: 'telegram',
    clientDisplayName: '@my_mock_bot',
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
    lastMessageAt: Date.now() - 1000 * 60 * 30,
  },
];

function bumpSession(key) {
  const sess = mockSessions.find((s) => s.key === key);
  if (sess) sess.lastMessageAt = Date.now();
}

function broadcastSessionsUpdate(ws) {
  gwEvent(ws, 'sessions.updated', { sessions: mockSessions });
}

// ---- Activity log pipeline ----
// The frontend's activity feed listens for `activity.log` events. The mock
// pushes entries on user messages, tool invocations, cron ticks, connection
// pings, etc. so the Activity tab reflects realistic agent traffic even when
// the user isn't actively chatting.
let activitySeq = 0;
function emitActivity(ws, type, action, detail = '') {
  activitySeq += 1;
  gwEvent(ws, 'activity.log', {
    id: `act_${Date.now()}_${activitySeq}`,
    type,
    action,
    detail,
    timestamp: Date.now(),
  });
}

const BACKGROUND_ACTIVITIES = [
  { type: 'connection', action: 'Gmail polled', detail: 'Fetched 3 new messages' },
  { type: 'connection', action: 'Telegram ping', detail: 'Channel heartbeat ok' },
  { type: 'cron',       action: 'Cron tick', detail: 'Morning briefing scheduled in 42m' },
  { type: 'skill',      action: 'Skill loaded', detail: 'web_search ready' },
  { type: 'system',     action: 'Config hash', detail: 'baseHash=mock-hash-1' },
  { type: 'connection', action: 'Calendar sync', detail: '2 upcoming events synced' },
  { type: 'tool',       action: 'file_read', detail: '/workspace/README.md' },
  { type: 'system',     action: 'Heartbeat', detail: 'Agent healthy · cpu 12%' },
];

function startBackgroundActivity(ws) {
  let stopped = false;
  const tick = () => {
    if (stopped || ws.readyState !== ws.OPEN) return;
    const pick = BACKGROUND_ACTIVITIES[Math.floor(Math.random() * BACKGROUND_ACTIVITIES.length)];
    emitActivity(ws, pick.type, pick.action, pick.detail);
    // 8–18s between events — slow enough to read, frequent enough to feel alive
    const next = 8000 + Math.floor(Math.random() * 10000);
    setTimeout(tick, next);
  };
  setTimeout(tick, 3500);
  return () => { stopped = true; };
}

function gwResponse(ws, id, payload) {
  ws.send(JSON.stringify({ type: 'res', id, ok: true, payload: payload || {} }));
}

/**
 * Stream `text` to the client as many small `chat.content` chunks, mimicking
 * real LLM token-by-token streaming. Returns the timestamp at which the last
 * chunk was scheduled, so callers can chain `chat.done` after it.
 *
 * Strategy: split into ~3-char pieces with small jittered delays. Whitespace is
 * preserved (split happens on every Nth character regardless of word bounds).
 * The result is a smooth typewriter effect.
 */
function streamText(ws, text, startMs = 0, opts = {}) {
  // Slower than reality but each chunk has time to render separately on the client
  const baseDelay = opts.baseDelay ?? 40;
  const jitter = opts.jitter ?? 25;
  const charsPerChunk = opts.charsPerChunk ?? 4;
  let cursor = 0;
  let scheduled = startMs;
  while (cursor < text.length) {
    const end = Math.min(cursor + charsPerChunk, text.length);
    const chunk = text.slice(cursor, end);
    const delay = scheduled;
    setTimeout(() => gwEvent(ws, 'chat.content', { text: chunk }), delay);
    cursor = end;
    scheduled += baseDelay + Math.floor(Math.random() * jitter);
  }
  return scheduled;
}

/** Same as streamText but emits chat.thinking events. */
function streamThinking(ws, text, startMs = 0, opts = {}) {
  const baseDelay = opts.baseDelay ?? 35;
  const jitter = opts.jitter ?? 20;
  const charsPerChunk = opts.charsPerChunk ?? 5;
  let cursor = 0;
  let scheduled = startMs;
  while (cursor < text.length) {
    const end = Math.min(cursor + charsPerChunk, text.length);
    const chunk = text.slice(cursor, end);
    const delay = scheduled;
    setTimeout(() => gwEvent(ws, 'chat.thinking', { text: chunk }), delay);
    cursor = end;
    scheduled += baseDelay + Math.floor(Math.random() * jitter);
  }
  return scheduled;
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
      const text =
        'This is a long streaming response that demonstrates how the mock gateway ' +
        'can simulate realistic token-by-token streaming. Each chunk is sent as a ' +
        'separate chat.content event with a small delay between them, making the ' +
        'response feel more natural. This is useful for testing UI rendering of ' +
        'streaming text, loading states, and scroll-to-bottom behavior. The response ' +
        'continues for several sentences to give you a good sample to work with.';
      const endMs = streamText(ws, text, 100);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), endMs + 200);
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

  // ── Compound triggers — mimic full agent conversation flows ──

  {
    keyword: '/research',
    description: 'Compound: thinking → web_search (multiple) → analysis → markdown summary',
    handler: (ws) => {
      const thinkEnd = streamThinking(ws,
        'Let me break this question down. First I should search the web for current information, ' +
        'then cross-reference with documentation, and finally synthesize a clear answer.',
        100);

      const introEnd = streamText(ws, 'I\'ll research this for you. ', thinkEnd + 100);

      // First search
      const search1 = `call_${faker.string.alphanumeric(12)}`;
      const tool1Start = introEnd + 150;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: search1, name: 'web_search', args: { query: 'latest documentation overview' },
      }), tool1Start);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: search1, name: 'web_search',
        result: 'Found 12 results. Top: docs.example.com — "Getting Started" guide updated 3 days ago.',
      }), tool1Start + 600);

      const c1End = streamText(ws,
        'Found a recent docs update. Let me also check the changelog.',
        tool1Start + 800);

      // Second search
      const search2 = `call_${faker.string.alphanumeric(12)}`;
      const tool2Start = c1End + 200;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: search2, name: 'fetch_url', args: { url: 'https://docs.example.com/changelog' },
      }), tool2Start);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: search2, name: 'fetch_url',
        result: 'v4.2 (2026-04-10): new auth flow, deprecated `legacyToken`. v4.1: streaming events stable.',
      }), tool2Start + 700);

      const summary =
        '\n\n## Summary\n\n' +
        'Based on the latest sources:\n\n' +
        '- **Auth:** the new flow shipped in v4.2 (this week). `legacyToken` is now deprecated.\n' +
        '- **Streaming:** event-based streaming is stable since v4.1.\n' +
        '- **Migration:** straightforward — see the [migration guide](https://docs.example.com/migrate).\n';
      const endMs = streamText(ws, summary, tool2Start + 900);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), endMs + 200);
    },
  },

  {
    keyword: '/debug',
    description: 'Compound: thinking → read_file → grep → edit → verify → conclusion',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.thinking', {
        text: 'I need to find what\'s causing this. Let me start by reading the file the user mentioned.',
      }), 100);

      // Read the suspect file
      const read1 = `call_${faker.string.alphanumeric(12)}`;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: read1, name: 'read_file', args: { path: 'src/handler.ts', offset: 1, limit: 60 },
      }), 600);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: read1, name: 'read_file',
        result: '...\n42:  if (input == null) {\n43:    return undefined;\n44:  }\n...',
      }), 1100);

      setTimeout(() => gwEvent(ws, 'chat.thinking', {
        text: '\n\nLooks like loose equality. Let me check whether other call sites depend on this behavior.',
      }), 1300);

      // Grep for usages
      const grep1 = `call_${faker.string.alphanumeric(12)}`;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: grep1, name: 'grep', args: { pattern: 'handler\\(' },
      }), 1600);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: grep1, name: 'grep',
        result: 'src/main.ts:14: handler(req)\nsrc/api.ts:88: handler(payload)\ntests/handler.test.ts:6: handler(null)',
      }), 2100);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Found the issue. Three call sites — and the test passes `null` explicitly, which the loose `==` was masking. Patching now.',
      }), 2400);

      // Apply edit
      const edit1 = `call_${faker.string.alphanumeric(12)}`;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: edit1, name: 'edit',
        args: { file_path: 'src/handler.ts', old: 'input == null', new: 'input === null || input === undefined' },
      }), 2700);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: edit1, name: 'edit', result: 'Edited src/handler.ts (1 replacement)',
      }), 3000);

      // Verify with tests
      const test1 = `call_${faker.string.alphanumeric(12)}`;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: test1, name: 'bash', args: { command: 'npm test -- handler' },
      }), 3300);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: test1, name: 'bash', result: 'PASS  tests/handler.test.ts (4 tests)\n\nTests: 4 passed, 4 total',
      }), 4000);

      const conclusion = [
        '\n\n**Fixed.** Replaced `==` with explicit `=== null || === undefined` in `src/handler.ts:42`.',
        '\n\nAll 4 handler tests pass. The behavior change is safe — the loose equality was matching `null` and `undefined` (and nothing else), so the new code is equivalent for all real call sites.',
      ];
      conclusion.forEach((c, i) => setTimeout(() => gwEvent(ws, 'chat.content', { text: c }), 4200 + i * 70));
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 4200 + conclusion.length * 250 + 200);
    },
  },

  {
    keyword: '/code_review',
    description: 'Compound: read multiple files → analyze → markdown findings + suggestions',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.thinking', {
        text: 'I\'ll skim the changed files first, then look for common issues: error handling, types, naming, edge cases.',
      }), 100);

      const files = ['src/api/route.ts', 'src/api/validators.ts', 'src/db/queries.ts'];
      files.forEach((path, i) => {
        const id = `call_${faker.string.alphanumeric(12)}`;
        setTimeout(() => gwEvent(ws, 'chat.tool_call', {
          toolCallId: id, name: 'read_file', args: { path },
        }), 500 + i * 600);
        setTimeout(() => gwEvent(ws, 'chat.tool_result', {
          toolCallId: id, name: 'read_file', result: `// ${path}\n// ${faker.number.int({ min: 30, max: 180 })} lines, modified ${faker.date.recent({ days: 1 }).toLocaleString()}`,
        }), 800 + i * 600);
      });

      const review = [
        '\n\n## Code Review\n\n',
        '### ✅ Looks good\n',
        '- Validators are pure functions with clear inputs/outputs\n',
        '- DB queries use parameterised statements (no SQL injection)\n\n',
        '### ⚠️ Suggestions\n',
        '1. **`route.ts:42`** — the `try` block swallows DB errors. Consider re-throwing as `AppError` with the original cause attached, so the error reporter gets context.\n',
        '2. **`validators.ts:88`** — `validateEmail` regex doesn\'t cover the `+` alias case. Use the [whatwg URL parser](https://url.spec.whatwg.org/) or RFC 5322 simplified pattern.\n',
        '3. **`queries.ts:150`** — `getUsersBy` returns `Promise<User[]>` but the call sites use it as `Promise<User | null>`. Either tighten the type or fix the callers.\n\n',
        '### 💭 Stylistic\n',
        '- Consider extracting the inline mapping at `route.ts:67` into a small helper — it appears twice with subtle differences.\n',
      ];
      const startMs = 500 + files.length * 600 + 400;
      review.forEach((c, i) => setTimeout(() => gwEvent(ws, 'chat.content', { text: c }), startMs + i * 60));
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), startMs + review.length * 200 + 200);
    },
  },

  {
    keyword: '/conversation',
    description: 'Compound: brief thinking → content → tool → result → more content → image attachment',
    handler: (ws) => {
      setTimeout(() => gwEvent(ws, 'chat.thinking', {
        text: 'Quick request. Let me grab the data and a visualisation.',
      }), 100);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Sure — here\'s the breakdown. ',
      }), 500);

      const id = `call_${faker.string.alphanumeric(12)}`;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: id, name: 'query_metrics', args: { metric: 'requests_per_second', range: '24h' },
      }), 800);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: id, name: 'query_metrics',
        result: 'avg=42 req/s · p50=38 · p95=120 · p99=340 · errors=0.4%',
      }), 1300);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: 'Traffic was steady at ~42 req/s with healthy tail latency.',
      }), 1500);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: '\n\nHere\'s a chart of the last 24 hours:',
        mediaUrls: ['https://picsum.photos/seed/metrics/640/360'],
      }), 1900);

      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: '\n\nWant me to drill into the p99 spike around 14:00?',
      }), 2300);

      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 2700);
    },
  },

  {
    keyword: '/multistep',
    description: 'Compound: long thinking → 4 tool calls in sequence with intermediate content',
    handler: (ws) => {
      // Long thinking with realistic pauses
      const thoughts = [
        'OK, this is a multi-part task.',
        '\n\nStep 1: validate input.',
        '\n\nStep 2: load relevant context.',
        '\n\nStep 3: perform the operation.',
        '\n\nStep 4: confirm and report.',
      ];
      thoughts.forEach((t, i) => setTimeout(() => gwEvent(ws, 'chat.thinking', { text: t }), 100 + i * 300));

      const baseMs = 100 + thoughts.length * 300 + 300;
      const steps = [
        { name: 'validate', args: { schema: 'request' }, result: 'ok' },
        { name: 'load_context', args: { id: 'ctx_42' }, result: '8 items loaded' },
        { name: 'process', args: { mode: 'incremental' }, result: 'processed 8/8' },
        { name: 'commit', args: { dryRun: false }, result: 'committed (rev abc1234)' },
      ];
      steps.forEach((step, i) => {
        const id = `call_${faker.string.alphanumeric(12)}`;
        const startMs = baseMs + i * 700;
        setTimeout(() => gwEvent(ws, 'chat.tool_call', { toolCallId: id, name: step.name, args: step.args }), startMs);
        setTimeout(() => gwEvent(ws, 'chat.tool_result', { toolCallId: id, name: step.name, result: step.result }), startMs + 400);
        setTimeout(() => gwEvent(ws, 'chat.content', { text: i === 0 ? `Step ${i + 1}: ${step.name} → ${step.result}.` : ` Step ${i + 1}: ${step.name} → ${step.result}.` }), startMs + 550);
      });

      const finalMs = baseMs + steps.length * 700 + 200;
      setTimeout(() => gwEvent(ws, 'chat.content', {
        text: '\n\nAll steps completed. Revision `abc1234` is now live.',
      }), finalMs);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), finalMs + 300);
    },
  },

  {
    // NOTE: must come BEFORE /realistic since the matcher uses substring includes()
    keyword: '/realistic_long',
    description: 'Compound: very long markdown response (50+ lines) — full architectural deep-dive',
    handler: (ws) => {
      // Brief thinking before the deep dive
      const t1End = streamThinking(ws,
        'This is a comprehensive question. Let me organize my response into sections: ' +
        'overview, architecture, key concepts, implementation details, common pitfalls, ' +
        'and recommendations. I\'ll include code examples where useful.',
        100);

      // Tiny intro tool call to feel grounded
      const lookup = `call_${faker.string.alphanumeric(12)}`;
      const toolStart = t1End + 200;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: lookup, name: 'search_docs', args: { query: 'event-driven architecture overview' },
      }), toolStart);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: lookup, name: 'search_docs',
        result: 'Found 47 results across 12 sections. Synthesizing relevant excerpts.',
      }), toolStart + 600);

      const longText = `# Event-Driven Architecture: A Practical Guide

Event-driven architecture (EDA) is a software design pattern in which decoupled components communicate by producing and consuming **events** rather than calling each other directly. It's foundational to modern distributed systems and is the backbone of platforms like AWS Lambda, Kafka, and the agent runtime you're working with right now.

## Why It Matters

Traditional request/response architectures couple services tightly: A calls B, waits for B, then continues. This works at small scale but breaks down quickly:

- **Cascading failures** — if B is slow, A is slow
- **Tight coupling** — A must know B's API surface
- **Poor scalability** — every call adds latency and a failure point
- **Hard to extend** — adding C means modifying A

EDA flips this: A *publishes* an event, and any number of consumers (B, C, D...) react independently. A doesn't know — or care — who's listening.

## Core Concepts

### 1. Events

An event is an immutable record that something happened. Crucially, it's in **past tense**:

\`\`\`json
{
  "type": "user.signed_up",
  "userId": "u_abc123",
  "email": "alice@example.com",
  "timestamp": "2026-04-15T10:24:31Z",
  "version": 1
}
\`\`\`

Note the past tense (\`signed_up\`, not \`sign_up\`). Events describe facts, not commands.

### 2. Producers

A producer publishes events without knowing who consumes them. The contract is the event schema, nothing else.

### 3. Consumers

Consumers subscribe to event types they care about. Multiple consumers can subscribe to the same event — this is **fan-out**, and it's where EDA shines for extensibility.

### 4. Event Bus / Broker

The middleman that routes events. Common choices: **Kafka** (high throughput, durable log), **NATS** (low latency, simple), **RabbitMQ** (flexible routing), **AWS EventBridge** (managed, integrates with AWS services).

## Implementation Patterns

### Outbox Pattern

Don't publish events from inside your DB transaction — instead, write the event to an \`outbox\` table in the same transaction, then have a worker poll the outbox and publish. This guarantees you never publish an event for a transaction that rolled back.

\`\`\`sql
BEGIN;
  INSERT INTO users (...) VALUES (...);
  INSERT INTO outbox (event_type, payload) VALUES ('user.signed_up', '{...}');
COMMIT;
\`\`\`

### Idempotency

Consumers should be idempotent: processing the same event twice should produce the same result as processing it once. Stamp events with a unique \`eventId\` and have consumers track which IDs they've already processed.

### Event Sourcing

A more radical pattern: don't store *state*, store the *sequence of events* that led to it. Current state is computed by replaying events. Powerful, but adds significant complexity — only adopt it if you have clear audit/replay requirements.

### CQRS (Command Query Responsibility Segregation)

Often paired with event sourcing. Writes go through a "command" path that emits events; reads come from separate denormalized "query" projections built by event handlers. Lets you scale reads and writes independently.

## Common Pitfalls

1. **Treating events as commands** — if an event triggers exactly one consumer that does exactly one thing, you've reinvented RPC with extra steps. Events are for fan-out.

2. **Schemas that change without versioning** — events live forever. Version them from day one (\`v1\`, \`v2\`...) and never break consumers silently.

3. **Hidden ordering dependencies** — events arrive out of order across partitions. If your logic depends on order, you need a single-partition strategy or causality tracking (vector clocks, happens-before).

4. **Skipping the outbox** — in-process publishing after a DB write is a recipe for ghost events when the publish succeeds but a downstream commit retries.

5. **No backpressure** — slow consumers can fall arbitrarily far behind. Monitor lag and degrade gracefully.

## When NOT to Use EDA

EDA isn't free. It adds operational complexity (monitoring, dead-letter queues, schema registries), makes debugging harder (no stack trace across event boundaries), and shifts consistency from synchronous to eventual.

Skip EDA if:
- You have a small monolith and don't need extensibility
- You need strong consistency on every write
- Your team doesn't have ops capacity for a broker

## Recommended Reading

- *Designing Data-Intensive Applications* by Martin Kleppmann (chapter 11)
- The original EDA paper by **Brenda Michelson** (2006)
- **Event Sourcing** by Greg Young (talk + blog series)

---

That should give you a working mental model. Want me to dive deeper into any specific pattern — outbox, event sourcing, or how to choose a broker?`;

      const endMs = streamText(ws, longText, toolStart + 800);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), endMs + 200);
    },
  },

  {
    keyword: '/realistic',
    description: 'Compound: brief thought → tool → reasoning → another tool → conclusion (most natural feel)',
    handler: (ws, userContent) => {
      const userQuestion = userContent.replace(/\/realistic/i, '').trim() || 'your question';

      const t1End = streamThinking(ws,
        `The user is asking about: "${userQuestion}". Let me check the relevant source files first.`,
        100);

      const read1 = `call_${faker.string.alphanumeric(12)}`;
      const tool1Start = t1End + 100;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: read1, name: 'grep', args: { pattern: userQuestion.split(' ')[0] || 'TODO' },
      }), tool1Start);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: read1, name: 'grep',
        result: '3 files match: src/index.ts, lib/util.ts, README.md',
      }), tool1Start + 500);

      const c1End = streamText(ws,
        'I found three relevant files. The most relevant one is `lib/util.ts` — let me read it.',
        tool1Start + 700);

      const read2 = `call_${faker.string.alphanumeric(12)}`;
      const tool2Start = c1End + 200;
      setTimeout(() => gwEvent(ws, 'chat.tool_call', {
        toolCallId: read2, name: 'read_file', args: { path: 'lib/util.ts' },
      }), tool2Start);
      setTimeout(() => gwEvent(ws, 'chat.tool_result', {
        toolCallId: read2, name: 'read_file',
        result: 'export function format(value) { /* ... */ }\nexport function parse(text) { /* ... */ }',
      }), tool2Start + 500);

      const t2End = streamThinking(ws,
        '\n\nThat clarifies it. The function the user is asking about is `format` in `lib/util.ts`.',
        tool2Start + 700);

      const answer =
        '\n\nHere\'s what I found:\n\n' +
        '- **`format(value)`** in `lib/util.ts` — this is what you\'re looking for.\n' +
        '- It\'s used in 3 places (`src/index.ts`, `lib/util.ts` itself, and the README docs).\n\n' +
        'Let me know if you want me to dig into any specific call site.';
      const endMs = streamText(ws, answer, t2End + 200);
      setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), endMs + 200);
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

  // Default: realistic-feeling echo (brief thought, then streamed response)
  setTimeout(() => gwEvent(ws, 'chat.thinking', {
    text: 'Mock agent is processing your message…',
  }), 150);

  const echoChunks = [
    `You said: "${userContent.length > 80 ? userContent.slice(0, 80) + '…' : userContent}".\n\n`,
    'I\'m a mocked agent so I can\'t actually run tools or fetch data. ',
    'But I can simulate realistic conversation flows — try one of these triggers:\n\n',
    '• `/realistic` — natural multi-step response\n',
    '• `/research` — multi-source web search + synthesis\n',
    '• `/debug` — read → analyze → edit → verify\n',
    '• `/code_review` — markdown findings across files\n',
    '• `/multistep` — long thinking + 4 sequential tools\n',
    '• `/conversation` — quick Q&A with chart\n\n',
    'Or `/help` for the full list.',
  ];
  echoChunks.forEach((c, i) => setTimeout(() => gwEvent(ws, 'chat.content', { text: c }), 600 + i * 50));
  setTimeout(() => gwEvent(ws, 'chat.done', { stop_reason: 'end_turn' }), 600 + echoChunks.length * 120 + 200);
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

  // Background activity stream so the Activity tab has content even when the
  // user is idle. Cleaned up on disconnect.
  const stopBackgroundActivity = startBackgroundActivity(ws);

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
              text: 'Hello! I am a mocked agent. Try typing `/help` to see available test triggers like `/think`, `/tool`, `/tools`, and `/error`.',
              thinking: '',
              toolCalls: [],
              mediaUrls: [],
              timestamp: Date.now() - 1000 * 60 * 60,
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

        // Real chat activity → bump the active browser session and notify
        // listeners. Other sessions occasionally tick to simulate multi-client
        // traffic so the Sessions module feels alive.
        bumpSession('main');
        if (Math.random() < 0.35) {
          const others = mockSessions.filter((s) => s.key !== 'main');
          const pick = others[Math.floor(Math.random() * others.length)];
          if (pick) bumpSession(pick.key);
        }
        broadcastSessionsUpdate(ws);

        // Note: user-message activity is logged client-side in useGatewayChat.ts
        // to avoid double-logging when running against the mock.

        simulateChatResponse(ws, userContent);
        break;
      }

      case 'chat.abort':
        gwResponse(ws, id, { ok: true });
        break;

      // ---- Config ----
      case 'config.get':
        gwResponse(ws, id, {
          llm: {
            model: 'claude-sonnet-4-6',
            system: 'You are a helpful mock assistant for local development.',
            temperature: 0.7,
            maxTokens: 4096,
          },
          identity: {
            name: 'Mock Agent',
            description: 'A mocked agent for local UI testing',
          },
          tools: {
            web_search:    { enabled: true,  apiKey: '' },
            browser:       { enabled: true },
            code_execution:{ enabled: false },
            memory:        { enabled: true,  store: 'sqlite' },
            file_io:       { enabled: true },
          },
          integrations: {
            telegram: { enabled: false, token: '' },
            slack:    { enabled: false, token: '' },
            discord:  { enabled: false, token: '' },
          },
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
          version: '1.0.0',
          schema: {
            type: 'object',
            properties: {
              llm: {
                type: 'object',
                title: 'Language Model',
                description: 'Model selection and inference settings',
                properties: {
                  model: { type: 'string', title: 'Model', enum: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'] },
                  system: { type: 'string', title: 'System Prompt' },
                  temperature: { type: 'number', title: 'Temperature', minimum: 0, maximum: 2 },
                  maxTokens: { type: 'integer', title: 'Max Tokens', minimum: 1 },
                },
              },
              identity: {
                type: 'object',
                title: 'Identity',
                properties: {
                  name: { type: 'string', title: 'Name' },
                  description: { type: 'string', title: 'Description' },
                },
              },
              tools: {
                type: 'object',
                title: 'Tools',
                description: 'Capabilities the agent can invoke',
                properties: {
                  web_search:     { type: 'object', title: 'Web Search',     properties: { enabled: { type: 'boolean' }, apiKey: { type: 'string' } } },
                  browser:        { type: 'object', title: 'Browser',        properties: { enabled: { type: 'boolean' } } },
                  code_execution: { type: 'object', title: 'Code Execution', properties: { enabled: { type: 'boolean' } } },
                  memory:         { type: 'object', title: 'Memory',         properties: { enabled: { type: 'boolean' }, store: { type: 'string' } } },
                  file_io:        { type: 'object', title: 'File I/O',       properties: { enabled: { type: 'boolean' } } },
                },
              },
              integrations: {
                type: 'object',
                title: 'Integrations',
                description: 'External channels the agent connects to',
                properties: {
                  telegram: { type: 'object', title: 'Telegram', properties: { enabled: { type: 'boolean' }, token: { type: 'string' } } },
                  slack:    { type: 'object', title: 'Slack',    properties: { enabled: { type: 'boolean' }, token: { type: 'string' } } },
                  discord:  { type: 'object', title: 'Discord',  properties: { enabled: { type: 'boolean' }, token: { type: 'string' } } },
                },
              },
            },
          },
          uiHints: {
            'integrations.telegram.token': { sensitive: true, label: 'Bot Token' },
            'integrations.slack.token':    { sensitive: true, label: 'Bot Token' },
            'integrations.discord.token':  { sensitive: true, label: 'Bot Token' },
            'tools.web_search.apiKey':     { sensitive: true, label: 'API Key' },
            'llm.system':                  { label: 'System Prompt', help: 'Identity and instructions for the agent' },
          },
        });
        break;

      // ---- Sessions ----
      case 'sessions.list':
        gwResponse(ws, id, { sessions: mockSessions });
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
            // Core protected files (read-only in the editor)
            { name: 'AGENTS.MD', size: 1536, missing: false },
            { name: 'BOOTSTRAP.MD', size: 2200, missing: false },
            { name: 'SOUL.MD', size: 2048, missing: false },
            { name: 'HEARTBEAT.MD', size: 480, missing: false },
            { name: 'MEMORY.MD', size: 3072, missing: false },
            // Editable files
            { name: 'README.md', size: 1024, missing: false },
            { name: 'config.json', size: 512, missing: false },
            { name: 'skills/note-taker.md', size: 768, missing: false },
            { name: 'skills/research.md', size: 1280, missing: false },
            { name: 'data/notes.txt', size: 4096, missing: false },
          ],
        });
        break;

      case 'agents.files.get': {
        const requested = (params?.name || 'unknown').toUpperCase();
        const PROTECTED_CONTENT = {
          'AGENTS.MD': `# Agents\n\nThis file describes the sub-agents this agent can delegate to.\n\n- research-bot — handles web research and data gathering\n- code-bot — generates and reviews code snippets\n- writer-bot — drafts and edits prose\n\n> Edit via download → modify → re-upload.\n`,
          'BOOTSTRAP.MD': `# Bootstrap\n\nInstructions executed when the agent first comes online.\n\n1. Load identity from SOUL.MD\n2. Restore working memory from MEMORY.MD\n3. Subscribe to configured channels\n4. Emit HEARTBEAT every 60s\n\nDo not edit live — agent must be restarted to pick up changes.\n`,
          'SOUL.MD': `# Soul\n\nCore identity and operating principles.\n\n## Name\nMock Agent\n\n## Purpose\nAssist the user with software engineering tasks while remaining concise and accurate.\n\n## Tone\nDirect, friendly, low-fluff. Prefer concrete suggestions over hedging.\n\n## Hard rules\n- Never fabricate citations.\n- Never run destructive commands without explicit confirmation.\n- Surface uncertainty when relevant.\n`,
          'HEARTBEAT.MD': `# Heartbeat\n\nThe agent emits this prompt to itself periodically to check internal state.\n\nIs anything pending? Are any cron jobs overdue? Any unread messages?\n\nIf nothing requires attention, do nothing.\n`,
          'MEMORY.MD': `# Memory\n\n## User profile\n- Working in TypeScript / Next.js\n- Prefers terse responses with concrete diffs over long explanations\n\n## Recent context\n- Currently testing the agent UI redesign\n- Mock server is in use; real backend gateway is being repaired\n\n## Open threads\n- Awaiting Sam + Damian on the protected-files canonical list\n- Awaiting Connections marketplace taxonomy\n`,
        };
        const content = PROTECTED_CONTENT[requested]
          || `# Mock file: ${params?.name || 'unknown'}\n\nThis is mocked file content.`;
        gwResponse(ws, id, { content });
        break;
      }

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
        gwResponse(ws, id, {
          channels: {
            telegram: {
              configured: true,
              running: true,
              accountId: 'mock_telegram_acc',
              accountDisplayName: '@my_mock_bot',
              lastActiveAt: Date.now() - 1000 * 60 * 30,
              probe: { ok: true, latencyMs: 142 },
            },
            slack: {
              configured: true,
              running: false,
              accountId: 'mock_slack_acc',
              accountDisplayName: 'Mock Workspace',
              errorDetail: 'Token expired',
              probe: { ok: false, error: 'Token expired' },
            },
            discord: {
              configured: false,
              running: false,
              probe: { ok: false },
            },
          },
        });
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
        gwResponse(ws, id, {
          jobs: [
            {
              id: 'cron-daily-summary',
              schedule: '0 9 * * *',
              prompt: 'Generate a daily summary of yesterday\'s activity and email it to me.',
              description: 'Daily activity summary',
              enabled: true,
              lastRun: Date.now() - 1000 * 60 * 60 * 18,
              nextRun: Date.now() + 1000 * 60 * 60 * 6,
            },
            {
              id: 'cron-weekly-report',
              schedule: '0 10 * * 1',
              prompt: 'Compile a weekly progress report from project notes.',
              description: 'Weekly progress report',
              enabled: true,
              lastRun: Date.now() - 1000 * 60 * 60 * 24 * 4,
              nextRun: Date.now() + 1000 * 60 * 60 * 24 * 3,
            },
            {
              id: 'cron-cleanup',
              schedule: '0 3 * * 0',
              prompt: 'Clean up temp files and old log entries.',
              description: 'Weekly cleanup',
              enabled: false,
              lastRun: Date.now() - 1000 * 60 * 60 * 24 * 14,
              nextRun: Date.now() + 1000 * 60 * 60 * 24 * 4,
            },
          ],
        });
        break;

      case 'cron.add':
        gwResponse(ws, id, { jobId: `cron-${uuidv4().slice(0, 8)}` });
        break;

      case 'cron.remove':
      case 'cron.run':
        gwResponse(ws, id, { ok: true });
        break;

      case 'cron.patch':
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
    stopBackgroundActivity();
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
