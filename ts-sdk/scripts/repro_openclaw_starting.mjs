#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lookup } from 'node:dns/promises';

const agentsMod = await import(pathToFileURL(resolve(process.cwd(), 'dist/agents.js')).href);
const httpMod = await import(pathToFileURL(resolve(process.cwd(), 'dist/http.js')).href);

const { Deployments } = agentsMod;
const { HTTPClient } = httpMod;

function env(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function normalizeProductBase(raw) {
  const value = (raw || '').trim().replace(/\/$/, '');
  if (!value) throw new Error('HYPER_API_BASE is required');
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  return `${url.protocol}//${url.host}`;
}

function agentsBaseFromProductBase(productBase) {
  return `${normalizeProductBase(productBase)}/agents`;
}

function allowedOrigin(agentsBase) {
  const host = new URL(agentsBase).host.toLowerCase();
  return host === 'api.dev.hypercli.com' ? 'https://agents.dev.hypercli.com' : 'https://agents.hypercli.com';
}

function registryConfig() {
  const registryUrl = env('HYPERCLAW_SMOKE_OPENCLAW_REGISTRY_URL');
  const username = env('HYPERCLAW_SMOKE_OPENCLAW_REGISTRY_USERNAME');
  const password = env('HYPERCLAW_SMOKE_OPENCLAW_REGISTRY_PASSWORD');
  return {
    ...(registryUrl ? { registryUrl } : {}),
    ...(registryUrl && username && password ? { registryAuth: { username, password } } : {}),
  };
}

function summarize(agent) {
  return {
    id: agent.id,
    name: agent.name,
    state: agent.state,
    clusterId: agent.clusterId ?? null,
    podId: agent.podId ?? null,
    hostname: agent.hostname ?? null,
    startedAt: agent.startedAt ? agent.startedAt.toISOString() : null,
    updatedAt: agent.updatedAt ? agent.updatedAt.toISOString() : null,
  };
}

async function tryDns(hostname) {
  if (!hostname) return { ok: false, error: 'missing hostname' };
  try {
    const result = await lookup(hostname);
    return { ok: true, address: result.address, family: result.family };
  } catch (error) {
    return { ok: false, error: `${error?.code || error?.name || 'ERROR'}: ${error?.message || error}` };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const productBase = normalizeProductBase(args['api-base'] || env('HYPER_API_BASE'));
  const agentsBase = agentsBaseFromProductBase(productBase);
  const apiKey = args['api-key'] || env('HYPER_API_KEY') || env('TEST_API_KEY');
  if (!apiKey) throw new Error('Pass --api-key or set HYPER_API_KEY/TEST_API_KEY');

  const image = args.image || env('HYPERCLAW_SMOKE_OPENCLAW_IMAGE');
  if (!image) throw new Error('HYPERCLAW_SMOKE_OPENCLAW_IMAGE is required');

  const size = (args.size || env('HYPERCLAW_SMOKE_OPENCLAW_SMALL_AGENT_SIZE', 'small')).toLowerCase();
  const timeoutSeconds = Number(args.timeout || env('OPENCLAW_REPRO_TIMEOUT', '240'));
  const pollSeconds = Number(args.poll || env('OPENCLAW_REPRO_POLL', '5'));
  const holdSeconds = Number(args.hold || '0');
  const noDelete = args['no-delete'] === 'true';
  const agentName = args.name || `openclaw-starting-repro-${randomUUID().slice(0, 8)}`;

  const http = new HTTPClient(agentsBase, apiKey);
  const deployments = new Deployments(http, apiKey, agentsBase);

  const createOptions = {
    name: agentName,
    size,
    image,
    syncRoot: '/home/node',
    syncEnabled: true,
    env: {
      HOME: '/home/node',
      HYPER_API_BASE: productBase,
      OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: allowedOrigin(agentsBase),
    },
    routes: {
      openclaw: { port: 18789, auth: false, prefix: '' },
    },
    start: true,
    ...registryConfig(),
  };

  let created = null;
  try {
    created = await deployments.create(createOptions);
    console.log(JSON.stringify({ phase: 'created', agent: summarize(created) }, null, 2));

    const deadline = Date.now() + timeoutSeconds * 1000;
    let last = created;
    while (Date.now() < deadline) {
      last = await deployments.get(created.id);
      console.log(JSON.stringify({ phase: 'poll', agent: summarize(last) }, null, 2));
      if (String(last.state).toUpperCase() === 'RUNNING') {
        const dns = await tryDns(last.hostname ?? null);
        const envPayload = await deployments.env(last.id).catch((error) => ({ error: String(error) }));
        console.log(JSON.stringify({ phase: 'running', agent: summarize(last), dns, envPayload }, null, 2));
        if (holdSeconds > 0) {
          await sleep(holdSeconds * 1000);
        }
        return;
      }
      if (String(last.state).toUpperCase() === 'FAILED' || String(last.state).toUpperCase() === 'STOPPED') {
        break;
      }
      await sleep(pollSeconds * 1000);
    }

    const fresh = await deployments.get(created.id);
    const dns = await tryDns(fresh.hostname ?? null);
    const envPayload = await deployments.env(fresh.id).catch((error) => ({ error: String(error) }));
    const gatewayContext = typeof fresh.waitForGatewayContext === 'function'
      ? await fresh.waitForGatewayContext({ timeoutMs: 10_000, retryIntervalMs: 1_000 }).catch((error) => ({ error: String(error) }))
      : { skipped: 'not-openclaw-agent' };
    console.error(JSON.stringify({ phase: 'stuck', agent: summarize(fresh), dns, envPayload, gatewayContext }, null, 2));
    process.exitCode = 1;
  } finally {
    if (created && !noDelete) {
      await deployments.stop(created.id).catch(() => null);
      await deployments.delete(created.id).catch(() => null);
    }
  }
}

await main();
