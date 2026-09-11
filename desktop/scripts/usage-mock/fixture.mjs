// Sanitized sample of the real /agents/usage/* payloads (7-day window ending
// 2026-09-11). Shapes and magnitudes match the live API; ids, key hashes, and
// agent names are replaced with deterministic fakes.

function fakeHex(seed, length) {
  let x = seed;
  let out = "";
  while (out.length < length) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += x.toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

// Real per-day totals from /agents/usage/history?days=7.
const HISTORY = [
  ["2026-09-05", 3164746, 3136662, 28084, 137],
  ["2026-09-06", 22780, 22535, 245, 3],
  ["2026-09-07", 115810206, 115354152, 456054, 1207],
  ["2026-09-08", 377538887, 375862662, 1676225, 4225],
  ["2026-09-09", 568713344, 565985589, 2727755, 5873],
  ["2026-09-10", 519295834, 517056671, 2239163, 6009],
  ["2026-09-11", 168260128, 166971084, 1289044, 2270],
];

function historyEntry([date, total, prompt, completion, requests]) {
  return { date, total_tokens: total, prompt_tokens: prompt, completion_tokens: completion, requests };
}

// Real per-key totals/requests for the top 8; the long tail is synthesized at
// the same magnitude as the live tail (<50k tokens each).
const KEY_TOTALS = [
  [1335295310, 15205],
  [412252908, 4268],
  [2342167, 90],
  [638093, 33],
  [482474, 25],
  [435757, 27],
  [325467, 11],
  [317567, 10],
  [241380, 8],
  [152040, 6],
  [118945, 5],
  [96410, 4],
  [48210, 3],
  [43905, 3],
  [38920, 2],
  [33415, 2],
  [28960, 2],
  [24475, 2],
  [18930, 1],
  [15220, 1],
  [9845, 1],
  [4310, 1],
  [2180, 1],
];

function keyEntry([total, requests], index) {
  const keyHash = fakeHex(0x5eed + index * 7919, 64);
  const prompt = Math.round(total * 0.995);
  return {
    key_hash: keyHash,
    // The backend reports hash prefixes as names for unnamed keys.
    name: keyHash.slice(0, 12),
    total_tokens: total,
    prompt_tokens: prompt,
    completion_tokens: total - prompt,
    requests,
  };
}

const AGENTS = ["ops", "radar", "penny", "nova"].map((name, index) => ({
  agent_id: `${fakeHex(0xa4e17 + index * 104729, 8)}-${fakeHex(index + 1, 4)}-4d07-8d2a-${fakeHex(index + 3, 12)}`,
  name,
  managed: true,
  avatar_url: null,
  total_tokens: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  requests: 0,
}));

// Real unattributed totals from /agents/usage/agents?days=7.
const UNATTRIBUTED = {
  total_tokens: 1752805925,
  prompt_tokens: 1744389355,
  completion_tokens: 8416570,
  requests: 19724,
};

export async function usageSummary(days = 7) {
  const clamped = Math.min(Math.max(Math.trunc(days) || 7, 1), 30);
  let history = HISTORY.map(historyEntry);
  if (clamped <= history.length) {
    history = history.slice(-clamped);
  } else {
    const pad = Array.from({ length: clamped - history.length }, (_, index) => ({
      date: `2026-08-${String(13 + index).padStart(2, "0")}`,
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      requests: 0,
    }));
    history = [...pad, ...history];
  }
  return {
    days: clamped,
    history,
    keys: KEY_TOTALS.map(keyEntry),
    agents: AGENTS,
    unattributed: UNATTRIBUTED,
  };
}
