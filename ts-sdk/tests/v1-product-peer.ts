import assert from 'node:assert/strict';
import { CodingAgentAcpClient } from '../src/acp.js';

const updates: unknown[] = [];
const client = await CodingAgentAcpClient.connect({ url: process.argv[2], token: '' }, {
  cwd: '/workspace', onUpdate: update => updates.push(update),
  onPermissionRequest: params => {
    assert.equal(params.toolCall.toolCallId, 'tool');
    return { outcome: { outcome: 'selected', optionId: 'allow' } };
  },
});
try {
  assert.equal(client.negotiatedProtocolVersion, 1);
  const { sessionId } = await client.newSession();
  await client.resumeSession(sessionId);
  const result = await client.prompt(sessionId, [{ type: 'text', text: 'TS v1' }, { type: 'audio', data: 'AA==', mimeType: 'audio/wav' }]);
  assert.equal(result.stopReason, 'end_turn');
  assert.deepEqual(updates, [{ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } } }]);
} finally { client.close(); }
