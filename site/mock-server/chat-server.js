const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { faker } = require('@faker-js/faker');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = process.env.CHAT_PORT || 4002;

app.use(cors());
app.use(express.json());

// ============================================================================
// DATA STORAGE
// ============================================================================

const conversations = new Map();
const messages = new Map();
const wsConnections = new Map();

function generateConversation(agentId) {
  return {
    id: uuidv4(),
    agent_id: agentId,
    title: faker.hacker.phrase(),
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    message_count: faker.number.int({ min: 1, max: 100 }),
  };
}

function generateMessage(conversationId, role = null) {
  const roles = ['user', 'assistant', 'system'];
  return {
    id: uuidv4(),
    conversation_id: conversationId,
    role: role || faker.helpers.arrayElement(roles),
    content: faker.hacker.phrase(),
    created_at: faker.date.recent().toISOString(),
    metadata: {
      tokens: faker.number.int({ min: 10, max: 1000 }),
      processing_time_ms: faker.number.int({ min: 100, max: 5000 }),
    },
  };
}

// Initialize with sample data
function initializeChatData() {
  const agentIds = [uuidv4(), uuidv4(), uuidv4()];

  agentIds.forEach(agentId => {
    for (let i = 0; i < 3; i++) {
      const conv = generateConversation(agentId);
      conversations.set(conv.id, conv);

      // Add messages to conversation
      for (let j = 0; j < faker.number.int({ min: 3, max: 10 }); j++) {
        const msg = generateMessage(conv.id);
        messages.set(msg.id, msg);
      }
    }
  });
}

initializeChatData();

// ============================================================================
// REST ENDPOINTS
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'chat',
    timestamp: new Date().toISOString(),
  });
});

// List conversations for an agent
app.get('/conversations/:agentId', (req, res) => {
  const { agentId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const agentConversations = Array.from(conversations.values())
    .filter(c => c.agent_id === agentId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(offset, offset + limit);

  res.json({
    conversations: agentConversations,
    total: agentConversations.length,
    limit,
    offset,
  });
});

// Create a new conversation
app.post('/conversations/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { title } = req.body;

  const conversation = {
    id: uuidv4(),
    agent_id: agentId,
    title: title || faker.hacker.phrase(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 0,
  };

  conversations.set(conversation.id, conversation);
  res.status(201).json(conversation);
});

// Get a conversation
app.get('/conversations/:agentId/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  res.json(conversation);
});

// Delete a conversation
app.delete('/conversations/:agentId/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  conversations.delete(conversationId);
  // Delete all messages in conversation
  Array.from(messages.entries()).forEach(([msgId, msg]) => {
    if (msg.conversation_id === conversationId) {
      messages.delete(msgId);
    }
  });

  res.json({ success: true });
});

// List messages in a conversation
app.get('/conversations/:agentId/:conversationId/messages', (req, res) => {
  const { conversationId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const conversationMessages = Array.from(messages.values())
    .filter(m => m.conversation_id === conversationId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(offset, offset + limit);

  res.json({
    messages: conversationMessages,
    total: conversationMessages.length,
    limit,
    offset,
  });
});

// Add a message to a conversation
app.post('/conversations/:agentId/:conversationId/messages', (req, res) => {
  const { conversationId } = req.params;
  const { role, content } = req.body;

  const conversation = conversations.get(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const message = {
    id: uuidv4(),
    conversation_id: conversationId,
    role: role || 'user',
    content: content || faker.hacker.phrase(),
    created_at: new Date().toISOString(),
    metadata: {
      tokens: faker.number.int({ min: 10, max: 1000 }),
      processing_time_ms: faker.number.int({ min: 100, max: 5000 }),
    },
  };

  messages.set(message.id, message);
  conversation.message_count += 1;
  conversation.updated_at = new Date().toISOString();

  // Broadcast message to WebSocket clients
  broadcastMessage({
    type: 'message',
    conversationId,
    message,
  });

  // Simulate assistant response
  if (message.role === 'user') {
    setTimeout(() => {
      const assistantMessage = {
        id: uuidv4(),
        conversation_id: conversationId,
        role: 'assistant',
        content: faker.hacker.phrase(),
        created_at: new Date().toISOString(),
        metadata: {
          tokens: faker.number.int({ min: 50, max: 500 }),
          processing_time_ms: faker.number.int({ min: 500, max: 3000 }),
        },
      };

      messages.set(assistantMessage.id, assistantMessage);
      conversation.message_count += 1;
      conversation.updated_at = new Date().toISOString();

      broadcastMessage({
        type: 'message',
        conversationId,
        message: assistantMessage,
      });
    }, faker.number.int({ min: 500, max: 2000 }));
  }

  res.status(201).json(message);
});

// ============================================================================
// WEBSOCKET SUPPORT
// ============================================================================

function broadcastMessage(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  wsConnections.set(clientId, ws);

  console.log(`[WebSocket] Client connected: ${clientId}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: new Date().toISOString(),
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // Handle different message types
      switch (message.type) {
        case 'subscribe':
          ws.conversationId = message.conversationId;
          ws.send(JSON.stringify({
            type: 'subscribed',
            conversationId: message.conversationId,
          }));
          break;

        case 'send_message':
          const { conversationId, content, role } = message;
          const conversation = conversations.get(conversationId);

          if (conversation) {
            const newMessage = {
              id: uuidv4(),
              conversation_id: conversationId,
              role: role || 'user',
              content,
              created_at: new Date().toISOString(),
              metadata: {
                tokens: faker.number.int({ min: 10, max: 1000 }),
                processing_time_ms: faker.number.int({ min: 100, max: 5000 }),
              },
            };

            messages.set(newMessage.id, newMessage);
            conversation.message_count += 1;

            broadcastMessage({
              type: 'message',
              conversationId,
              message: newMessage,
            });

            // Simulate assistant typing and response
            if (role === 'user' || !role) {
              broadcastMessage({
                type: 'typing',
                conversationId,
                role: 'assistant',
              });

              setTimeout(() => {
                const assistantMessage = {
                  id: uuidv4(),
                  conversation_id: conversationId,
                  role: 'assistant',
                  content: faker.hacker.phrase(),
                  created_at: new Date().toISOString(),
                  metadata: {
                    tokens: faker.number.int({ min: 50, max: 500 }),
                    processing_time_ms: faker.number.int({ min: 500, max: 3000 }),
                  },
                };

                messages.set(assistantMessage.id, assistantMessage);
                conversation.message_count += 1;

                broadcastMessage({
                  type: 'message',
                  conversationId,
                  message: assistantMessage,
                });
              }, faker.number.int({ min: 1000, max: 3000 }));
            }
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    wsConnections.delete(clientId);
    console.log(`[WebSocket] Client disconnected: ${clientId}`);
  });

  ws.on('error', (error) => {
    console.error(`[WebSocket] Error for ${clientId}:`, error.message);
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================================================
// START SERVER
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Mock Chat Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🏥 Health check: GET http://localhost:${PORT}/health\n`);
  console.log('📚 Key endpoints:');
  console.log('   GET    /conversations/{agentId}');
  console.log('   POST   /conversations/{agentId}');
  console.log('   GET    /conversations/{agentId}/{conversationId}');
  console.log('   DELETE /conversations/{agentId}/{conversationId}');
  console.log('   GET    /conversations/{agentId}/{conversationId}/messages');
  console.log('   POST   /conversations/{agentId}/{conversationId}/messages\n');
  console.log('📡 WebSocket events:');
  console.log('   subscribe_message');
  console.log('   send_message');
  console.log('   typing\n');
});
