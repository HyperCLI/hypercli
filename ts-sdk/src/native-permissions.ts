import type { SessionConfigOption } from '@agentclientprotocol/sdk';

// Verified adapter contracts: claude-agent-acp 0.59.0, codex-acp 1.1.7,
// OpenCode 1.18.35 with the image-provisioned native agent profile.
const UNATTENDED_MODES: Readonly<Record<string, string>> = {
  'claude-code': 'bypassPermissions',
  codex: 'agent-full-access',
  opencode: 'hypercli-unattended',
};

/** Resolve a native full-access choice only when this session advertises it.
 * Other runtimes retain their native policy; no callback approval fallback.
 */
export function nativeUnattendedChoice(runtime: string, options: readonly SessionConfigOption[]): {
  configId: string; value: string;
} | null {
  const value = UNATTENDED_MODES[runtime];
  if (!value) return null;
  const option = options.find(option => option.id === 'mode' && option.type === 'select' &&
    option.options.some(choice => 'group' in choice
      ? choice.options.some(choice => choice.value === value) : choice.value === value));
  return option ? { configId: option.id, value } : null;
}
