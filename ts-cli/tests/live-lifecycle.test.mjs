// Offline harness for the live-tester shell pair vendored in
// tests/live-lifecycle/{live.sh,lifecycle.sh} (mirrors of the mono's
// .github/scripts/cli/ copies, which the mono's live workflow still runs).
// Bash executes the real scripts; `node dist/index.js` inside them resolves
// to a stateful fake written per run, so the full lifecycle/presweep logic is
// exercised with zero network, zero secrets, zero real agents.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const script = fileURLToPath(new URL('./live-lifecycle/live.sh', import.meta.url));
const owner = '11111111-1111-4111-8111-111111111111';
const oldId = '22222222-2222-4222-8222-222222222222';
const newId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const old = (state, extra = {}) => ({
  id: oldId, name: 'hypercli-ci-lifecycle-abcdef0-1', runtime: 'opencode',
  tags: [`agent:${oldId}`], state, ...extra,
});

// A command-level fake: Bash invokes the real node CLI argv entry point, and
// the fake persists API-like state between invocations. No network or keys.
const mock = String.raw`
const fs = require('node:fs');
const file = process.env.MOCK_STATE;
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const a = process.argv.slice(2);
const op = a[0] === 'me' ? 'me' : a[1];
const row = s.agents.find(x => x.id === a[2]);
s.calls.push({ argv: a, state: row?.state });
function save() { fs.writeFileSync(file, JSON.stringify(s)); }
function reply(value) { save(); console.log(JSON.stringify(value)); }
function fail(error) { save(); console.error(error.text ?? 'error: secret-canary'); process.exit(error.rc ?? 1); }
if (!a.includes('--dev')) fail({rc: 91});
if (op === 'me') reply({identity:{userId:s.identity ?? s.owner,authType:'api_key',tags:s.keyTags ?? ['*:*']}});
else if (op === 'ls') {
  s.lists = (s.lists ?? 0) + 1;
  if (s.listFailure === s.lists) fail({text:'error: HTTP 503: secret-canary'});
  reply(s.badInventory ? {} : s.agents);
} else if (op === 'create') {
  if (!s.createError || s.lostCreate) {
    s.agents.push({id:s.newId,name:a[2],runtime:'opencode',state:'CREATING',tags:['agent:'+s.newId],...(s.createStates ? {states:s.createStates} : {})});
  }
  if (s.createError) fail(s.createError);
  reply(s.malformedCreate ? {} : s.agents.at(-1));
} else if (op === 'status') {
  if (!row) fail({text:'error: HTTP 404: missing'});
  if (row.vanish) {
    s.agents = s.agents.filter(x => x !== row);
    fail({text:'error: HTTP 404: missing'});
  }
  if (row.states?.length) row.state = row.states.shift();
  reply(row);
} else {
  if (!row) fail({text:'error: HTTP 404: missing'});
  const error = s.failures?.[op];
  if (error && (!error.id || error.id === row.id)) fail(error);
  if (op === 'wait') {
    row.state = a[a.indexOf('--state') + 1];
    reply(row);
  } else if (op === 'chat') reply({agent_id:row.id,reply:s.badChat ? 'secret-canary' : 'CI_OK'});
  else if (op === 'stop') {
    if (!['RUNNING','STARTING','STOPPING','STOPPED'].includes(row.state)) fail({text:'error: HTTP 409: cannot stop'});
    row.state = 'STOPPING'; row.states = ['STOPPING','STOPPED']; reply(row);
  } else if (op === 'delete') {
    if (!['STOPPED','ARCHIVED'].includes(row.state)) fail({text:'error: HTTP 409: cannot delete'});
    s.agents = s.agents.filter(x => x !== row); reply({ok:true});
  } else if (op === 'start') {
    if (row.state !== 'STOPPED') fail({text:'error: HTTP 409: cannot start'});
    row.state='STARTING'; reply(row);
  } else if (op === 'archive') {
    if (row.state !== 'STOPPED') fail({text:'error: HTTP 409: cannot archive'});
    row.state='ARCHIVING'; reply(row);
  } else if (op === 'restore') {
    if (row.state !== 'ARCHIVED') fail({text:'error: HTTP 409: cannot restore'});
    row.state='RESTORING'; reply(row);
  } else fail({rc:92});
}
`;

// spawnSync would block the vitest worker event loop past the RPC timeout;
// a promise wrapper keeps the harness's own 15s cap semantics.
function spawnAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`spawn timed out after ${options.timeout}ms`));
    }, options.timeout);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status) => { clearTimeout(timer); resolve({status, stdout, stderr}); });
  });
}

async function run(scenario = {}, env = {}, sub = 'lifecycle') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lifecycle-test-'));
  try {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.mkdirSync(path.join(root, 'scratch'));
    fs.writeFileSync(path.join(root, 'dist/index.js'), mock);
    const state = path.join(root, 'mock.json');
    fs.writeFileSync(state, JSON.stringify({owner, newId, agents:[], calls:[], ...scenario}), {mode:0o600});
    const result = await spawnAsync('bash', [script, 'agents', sub], {
      env: {...process.env, HYPER_API_KEY:'offline-only-secret-canary',
        HYPER_API_BASE:'https://api.dev.hypercli.com', HYPERCLI_CI_USER_ID:owner,
        CLI_WORKDIR:root, TMPDIR:path.join(root,'scratch'), MOCK_STATE:state,
        LIFECYCLE_CLEANUP_SECONDS:'10', LIFECYCLE_POLL_SECONDS:'0', SWEEP_POLL_SECONDS:'0', ...env},
      timeout:15000,
    });
    assert.doesNotMatch(result.stdout + result.stderr, /secret-canary/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'scratch')), [], 'only job scratch is removed');
    return {...result, ...JSON.parse(fs.readFileSync(state, 'utf8'))};
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
}
const mutations = result => result.calls.filter(c => ['create','start','stop','archive','restore','delete','chat'].includes(c.argv[1]));

// Bash + mocked-node invocations can outlast vitest's 5s default on a cold
// runner; the harness-internal spawn timeout above stays 15s.
const t = (name, fn) => test(name, { timeout: 30000 }, fn);

t('empty inventory runs the complete lifecycle with two checked replies', async () => {
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mutations(r).map(c=>c.argv[1]), ['create','start','chat','stop','archive','restore','start','chat','stop','delete']);
  assert.deepEqual(r.calls.filter(c=>c.argv[1]==='wait').map(c=>c.argv[c.argv.indexOf('--state')+1]),
    ['STOPPED','RUNNING','STOPPED','ARCHIVED','STOPPED','RUNNING','STOPPED']);
  assert.deepEqual(r.agents, []);
  assert.ok(mutations(r)[0].argv[2].length <= 32);
  assert.equal(r.calls[1].argv[1], 'ls');
});

for (const state of ['RUNNING','STOPPED','ARCHIVED','CREATING','STARTING','STOPPING','RESTORING','ARCHIVING','UPGRADING','DELETED']) {
  t(`presweep handles ${state} through observed legal states before create`, async () => {
    const stable = state === 'STARTING' ? 'RUNNING' : state === 'ARCHIVING' ? 'ARCHIVED' : 'STOPPED';
    const transition = ['CREATING','STARTING','STOPPING','RESTORING','ARCHIVING','UPGRADING'].includes(state);
    const r = await run({agents:[old(state, transition ? {states:[state,stable]} : {})]});
    assert.equal(r.status, 0, r.stderr);
    const oldCalls = mutations(r).filter(c=>c.argv[2]===oldId);
    assert.deepEqual(oldCalls.map(c=>c.argv[1]), state === 'DELETED' ? [] :
      (state === 'RUNNING' || state === 'STARTING') ? ['stop','delete'] : ['delete']);
    assert.ok(oldCalls.every(c=>c.argv[1] !== 'stop' || c.state === 'RUNNING'));
    const create = r.calls.findIndex(c=>c.argv[1]==='create');
    assert.ok(oldCalls.every(c=>r.calls.indexOf(c)<create));
  });
}

t('FAILED is an actionable blocker; other removable inventory is still cleaned', async () => {
  const r = await run({agents:[old('FAILED'), old('STOPPED',{id:otherId,name:'hypercli-ci-lifecycle-abcdef1-1',tags:[`agent:${otherId}`]})]});
  assert.equal(r.status, 1);
  assert.deepEqual(mutations(r).map(c=>[c.argv[1],c.argv[2]]), [['delete',otherId]]);
  assert.match(r.stderr, new RegExp(`id=${oldId}.*state=FAILED.*admin-inspect`));
  assert.match(r.stderr, /CREATE not attempted/);
});

for (const state of ['CREATING','STARTING','STOPPING','RESTORING','ARCHIVING','UPGRADING']) {
  t(`stalled ${state} times out without a stop/delete/create`, async () => {
    const r = await run({agents:[old(state)]}, {LIFECYCLE_CLEANUP_SECONDS:'0'});
    assert.equal(r.status, 1);
    assert.deepEqual(mutations(r), []);
    assert.match(r.stderr, new RegExp(`state=${state}.*admin-inspect`));
  });
}

t('missing agent during cleanup is reconciled as absence', async () => {
  const r = await run({agents:[old('RUNNING',{vanish:true})]});
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!mutations(r).some(c=>c.argv[2]===oldId));
});

t('ownership filter excludes personal names, display aliases, lookalikes and other suites', async () => {
  const unrelated = [
    old('RUNNING',{id:otherId,name:'personal',display_name:'hypercli-ci-lifecycle-abcdef0-1'}),
    old('RUNNING',{id:'55555555-5555-4555-8555-555555555555',name:'hypercli-ci-lifecycle-personal'}),
    old('RUNNING',{id:'66666666-6666-4666-8666-666666666666',name:'hypercli-ci-routines-abcdef0-1'}),
  ];
  const r = await run({agents:unrelated});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.agents, unrelated);
  assert.ok(mutations(r).every(c=>c.argv[1]==='create' || c.argv[2]===newId));
});

for (const override of [{tags:[`owner=${owner}`]}, {tags:[]}, {tags:[`agent:${otherId}`]}, {tags:[`agent:${oldId}`,'plan:pro']}, {runtime:'generic'}, {state:'unknown'}]) {
  t(`unverified CI-looking row blocks admission: ${JSON.stringify(override)}`, async () => {
    const r = await run({agents:[old('RUNNING',override)]});
    assert.equal(r.status, 1);
    assert.deepEqual(mutations(r), []);
  });
}

for (const config of [{identity:otherId}, {keyTags:['agents:*']}, {badInventory:true}, {listFailure:1}]) {
  t(`account/scope/inventory failure cannot mutate: ${JSON.stringify(config)}`, async () => {
    const r = await run(config);
    assert.equal(r.status, 1);
    assert.deepEqual(mutations(r), []);
  });
}

t('production endpoint overrides are refused before calling CLI', async () => {
  for (const env of [{HYPER_API_BASE:'https://api.hypercli.com'}]) {
    const r = await run({},env);
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
  }
});

for (const op of ['stop','delete']) {
  t(`presweep ${op} failure blocks CREATE instead of being swallowed`, async () => {
    const r = await run({agents:[old(op==='stop'?'RUNNING':'STOPPED')],failures:{[op]:{text:'error: HTTP 409: secret-canary'}}});
    assert.equal(r.status, 1);
    assert.equal(mutations(r).filter(c=>c.argv[1]==='create').length, 0);
    assert.match(r.stderr, /http=409/);
    assert.match(r.stderr, /LIFECYCLE_LEFTOVER/);
  });
}

for (const [text,cause] of [
  ['HTTP 429: Maximum 10 saved agents for this account (10 existing). secret-canary','saved_agent_quota_no_retry'],
  ['HTTP 429: rate limit secret-canary','quota_or_rate_limit_no_retry'],
  ['HTTP 409: No available slot secret-canary','capacity_unavailable_no_create_retry'],
]) {
  t(`CREATE ${cause} is not blindly retried`, async () => {
    const r = await run({createError:{rc:17,text}});
    assert.equal(r.status, 17);
    assert.equal(mutations(r).filter(c=>c.argv[1]==='create').length, 1);
    assert.match(r.stderr, new RegExp(cause));
  });
}

t('lost CREATE response is recovered by exact unique name without another create', async () => {
  const r = await run({lostCreate:true,createError:{rc:17},createStates:['CREATING','STOPPED'], agents:[]});
  assert.equal(r.status, 17);
  assert.equal(mutations(r).filter(c=>c.argv[1]==='create').length, 1);
  assert.deepEqual(r.agents, []);
});

t('an HTTP admission error after saving a row still reconciles and cleans it', async () => {
  const r = await run({lostCreate:true,createError:{rc:17,text:'error: HTTP 409: secret-canary'},createStates:['STOPPED']});
  assert.equal(r.status, 17);
  assert.deepEqual(r.agents, []);
  assert.equal(mutations(r).filter(c=>c.argv[1]==='create').length, 1);
});

t('malformed create response is recovered without trusting its missing ID', async () => {
  const r = await run({malformedCreate:true,createStates:['STOPPED']});
  assert.equal(r.status, 1);
  assert.deepEqual(r.agents, []);
});

t('ambiguous duplicate inventory cannot authorize deletion', async () => {
  const r = await run({agents:[old('STOPPED'),old('STOPPED',{id:otherId})]});
  assert.equal(r.status, 1);
  assert.deepEqual(mutations(r), []);
});

t('failed verification list after partial cleanup still blocks create', async () => {
  const r = await run({agents:[old('STOPPED')],listFailure:2});
  assert.equal(r.status, 1);
  assert.deepEqual(mutations(r).map(c=>c.argv[1]), ['delete']);
});

for (const op of ['start','chat','archive','restore']) {
  t(`${op} failure preserves the original error and cleans only the current run`, async () => {
    const r = await run({failures:{[op]:{rc:17,text:'error: HTTP 409: secret-canary'}}});
    assert.equal(r.status, 17);
    assert.deepEqual(r.agents, []);
    assert.ok(mutations(r).some(c=>c.argv[1]==='delete' && c.argv[2]===newId));
  });
}

t('cleanup failure cannot replace the original chat failure', async () => {
  const r = await run({failures:{chat:{rc:17},stop:{rc:29}}});
  assert.equal(r.status, 17);
  assert.equal(r.agents.length, 1);
  assert.match(r.stderr, /LIFECYCLE_LEFTOVER/);
  assert.ok(!mutations(r).some(c=>c.argv[1]==='delete'));
});

t('a successful chat command with the wrong reply fails acceptance and is cleaned', async () => {
  const r = await run({badChat:true});
  assert.equal(r.status, 1);
  assert.deepEqual(r.agents, []);
  assert.match(r.stderr, /chat_reply/);
});

// --- account presweep (live.sh agents presweep, shared with agents/e2e-routines) ---
const sweep = (scenario = {}, env = {}) => run(scenario, env, 'presweep');
const foreign = (id, state, name) => ({id, name, runtime:'opencode', tags:[`agent:${id}`], state});

t('presweep deletes every agent the account can list, whatever its name', async () => {
  const r = await sweep({agents:[
    old('RUNNING'),
    foreign(otherId, 'STOPPED', 'someones-personal-agent'),
    foreign('55555555-5555-4555-8555-555555555555', 'ARCHIVED', 'hypercli-ci-routines-abcdef0-1'),
  ]});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.agents, []);
  assert.deepEqual(mutations(r).map(c=>[c.argv[1],c.argv[2]]), [
    ['stop', oldId], ['delete', oldId],
    ['delete', otherId],
    ['delete', '55555555-5555-4555-8555-555555555555'],
  ]);
  // STOP is only ever issued from a state that admits it.
  assert.ok(mutations(r).every(c=>c.argv[1]!=='stop' || ['RUNNING','STARTING'].includes(c.state)));
});

t('presweep stops a STARTING agent but never one the backend would 409', async () => {
  const r = await sweep({agents:[old('STARTING',{states:['STARTING','STOPPED']})]});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mutations(r).map(c=>c.argv[1]), ['stop','delete']);
  assert.deepEqual(r.agents, []);
});

t('a FAILED agent is reported as unreclaimable and does not abort the sweep', async () => {
  const r = await sweep({agents:[old('FAILED'), foreign(otherId,'STOPPED','leftover')]});
  assert.equal(r.status, 0, r.stderr);
  // No stop/delete is even attempted on FAILED: it has no legal exit.
  assert.deepEqual(mutations(r).map(c=>[c.argv[1],c.argv[2]]), [['delete', otherId]]);
  assert.match(r.stderr, new RegExp(`SWEEP_UNRECLAIMABLE id=${oldId} .*state=FAILED reason=no-legal-exit-from-FAILED`));
  assert.match(r.stderr, new RegExp(`SWEEP_RESIDUE id=${oldId} .*state=FAILED`));
  assert.deepEqual(r.agents.map(a=>a.id), [oldId]);
});

t('unreclaimable residue that leaves no slot fails fast with ids and states', async () => {
  const r = await sweep({agents:[old('FAILED'), foreign(otherId,'FAILED','stuck-two')]}, {HYPERCLI_AGENT_CAP:'2'});
  assert.equal(r.status, 1);
  assert.equal(mutations(r).length, 0);
  assert.match(r.stderr, /could not free a slot: 2 agent\(s\) remain, cap is 2/);
  assert.match(r.stderr, new RegExp(`SWEEP_RESIDUE id=${oldId} .*state=FAILED`));
  assert.match(r.stderr, new RegExp(`SWEEP_RESIDUE id=${otherId} .*state=FAILED`));
});

t('residue that still leaves a slot is reported but does not fail the sweep', async () => {
  const r = await sweep({agents:[old('FAILED')]}, {HYPERCLI_AGENT_CAP:'2'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /SWEEP_UNRECLAIMABLE/);
});

t('an unhandled state is residue, not a blind stop-then-delete', async () => {
  const r = await sweep({agents:[old('DELETING')]});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mutations(r), []);
  assert.match(r.stderr, /SWEEP_UNRECLAIMABLE .*state=DELETING reason=unhandled-state/);
});

t('presweep deletes nothing when the key is not the pinned CI account', async () => {
  for (const config of [{identity:otherId}, {}]) {
    const env = config.identity ? {} : {HYPERCLI_CI_USER_ID:otherId};
    const r = await sweep({agents:[old('STOPPED')], ...config}, env);
    assert.equal(r.status, 1);
    assert.deepEqual(mutations(r), []);
  }
});

t('presweep refuses to sweep blind when the inventory is unusable', async () => {
  for (const config of [{listFailure:1}, {badInventory:true}]) {
    const r = await sweep({agents:[old('STOPPED')], ...config});
    assert.equal(r.status, 1);
    assert.deepEqual(mutations(r), []);
  }
});

t('a rejected stop is residue with its status, and the sweep continues', async () => {
  const r = await sweep({agents:[old('RUNNING'), foreign(otherId,'STOPPED','leftover')],
    failures:{stop:{text:'error: HTTP 409: secret-canary', id:oldId}}});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /SWEEP_UNRECLAIMABLE .*reason=stop-rejected-http-409/);
  assert.deepEqual(r.agents.map(a=>a.id), [oldId]);
});

t('lifecycle refuses CREATE when the account is at its cap instead of 429ing', async () => {
  const agents = Array.from({length: 10}, (_, i) =>
    foreign(`7777777${i}-7777-4777-8777-777777777777`, 'STOPPED', `not-ours-${i}`));
  const r = await run({agents});
  assert.equal(r.status, 1);
  assert.deepEqual(mutations(r), []);
  assert.match(r.stderr, /LIFECYCLE_NO_CAPACITY live=10 cap=10 needed=1/);
  assert.match(r.stderr, /LIFECYCLE_BLOCKING id=77777770-7777-4777-8777-777777777777 name=not-ours-0 state=STOPPED/);
});

t('lifecycle still creates when the account has room below the cap', async () => {
  const agents = Array.from({length: 3}, (_, i) =>
    foreign(`7777777${i}-7777-4777-8777-777777777777`, 'STOPPED', `not-ours-${i}`));
  const r = await run({agents}, {LIFECYCLE_AGENT_CAP:'5'});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(mutations(r).filter(c=>c.argv[1]==='create').length, 1);
  assert.match(r.stderr, /LIFECYCLE_CAPACITY live=3 cap=5/);
});
