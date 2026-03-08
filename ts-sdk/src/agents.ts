/**
 * HyperClaw agents API - exec/shell against reef containers.
 */
import type { HTTPClient } from './http.js';
import WebSocket from 'ws';

export interface AgentExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function execResultFromDict(data: any): AgentExecResult {
  return {
    exitCode: data.exit_code ?? -1,
    stdout: data.stdout || '',
    stderr: data.stderr || '',
  };
}

export class Agents {
  private apiKey: string;
  private apiBase: string;

  constructor(
    private http: HTTPClient,
    clawApiKey?: string,
    clawApiBase?: string
  ) {
    this.apiKey = clawApiKey || (http as any).apiKey;
    this.apiBase = (clawApiBase || process.env.HYPERCLAW_API_BASE || 'https://api.hyperclaw.app').replace(/\/$/, '');
  }

  /**
   * Execute a one-shot command on a HyperClaw agent pod.
   */
  async exec(agentId: string, command: string, timeout: number = 30): Promise<AgentExecResult> {
    const response = await fetch(`${this.apiBase}/api/agents/${agentId}/exec`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, timeout }),
    });

    if (!response.ok) {
      throw new Error(`Agent exec failed: ${response.status} ${response.statusText}`);
    }

    return execResultFromDict(await response.json());
  }

  /**
   * Connect to HyperClaw agent interactive shell via backend WebSocket proxy.
   */
  async shellConnect(agentId: string): Promise<WebSocket> {
    const tokenResponse = await fetch(`${this.apiBase}/api/agents/${agentId}/shell/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!tokenResponse.ok) {
      throw new Error(`Agent shell token failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenData: any = await tokenResponse.json();
    const jwt = tokenData.token;
    const wsBase = this.apiBase.replace('https://', 'wss://').replace('http://', 'ws://');
    const wsUrl = `${wsBase}/ws/shell/${agentId}?jwt=${encodeURIComponent(jwt)}`;

    return await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const onError = (err: Error) => reject(err);
      ws.once('error', onError);
      ws.once('open', () => {
        ws.off('error', onError);
        resolve(ws);
      });
    });
  }
}
