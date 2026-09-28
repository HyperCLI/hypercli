import { describe, expect, it } from 'vitest';
import {
  AGENT_PERSONA_PROFILES,
  DEFAULT_PERSONA_SOUL_PATH,
  DEFAULT_PERSONA_USER_PATH,
  DefaultPersonaProfile,
  HermesPersonaProfile,
  OpenClawPersonaProfile,
  resolveAgentPersonaProfile,
  type AgentPersonaProfile,
} from '../src/agent-persona.js';
import {
  DEFAULT_CODING_AGENT_SYNC_INCLUDES,
  DEFAULT_HERMES_AGENT_SYNC_EXCLUDE,
  DEFAULT_HERMES_AGENT_SYNC_ROOT,
  type CodingAgentRuntime,
} from '../src/agents.js';

describe('DefaultPersonaProfile', () => {
  it('keeps the platform .hypercli landing zone', () => {
    const profile = new DefaultPersonaProfile();
    expect(profile.family).toBe('default');
    expect(profile.soulPath()).toBe('.hypercli/SOUL.md');
    expect(profile.userPath()).toBe('.hypercli/USER.md');
  });

  it('advertises both files as sync includes, USER-first like the coding table', () => {
    expect(new DefaultPersonaProfile().syncIncludes()).toEqual(['.hypercli/USER.md', '.hypercli/SOUL.md']);
  });
});

describe('OpenClawPersonaProfile', () => {
  it('places the persona at the OpenClaw workspace root', () => {
    const profile = new OpenClawPersonaProfile();
    expect(profile.family).toBe('openclaw_acp');
    expect(profile.soulPath()).toBe('.openclaw/workspace/SOUL.md');
    expect(profile.userPath()).toBe('.openclaw/workspace/USER.md');
  });

  it('needs no sync includes: the workspace sits under the synced home root', () => {
    expect(new OpenClawPersonaProfile().syncIncludes()).toEqual([]);
  });

  it('never lands under .hypercli', () => {
    const profile = new OpenClawPersonaProfile();
    for (const path of [profile.soulPath(), profile.userPath()]) {
      expect(path.startsWith('.hypercli/')).toBe(false);
    }
  });
});

describe('HermesPersonaProfile', () => {
  it('places SOUL.md at the HERMES_HOME root and USER.md under memories/', () => {
    const profile = new HermesPersonaProfile();
    expect(profile.family).toBe('hermes_acp');
    expect(profile.soulPath()).toBe('.hermes/SOUL.md');
    expect(profile.userPath()).toBe('.hermes/memories/USER.md');
  });

  it('paths stay under the default hermes sync root and survive its exclude set', () => {
    const profile = new HermesPersonaProfile();
    for (const path of [profile.soulPath(), profile.userPath()]) {
      expect(`${DEFAULT_HERMES_AGENT_SYNC_ROOT.slice(1)}/${path.replace(/^\//, '')}`).toContain('/');
      for (const exclude of DEFAULT_HERMES_AGENT_SYNC_EXCLUDE) {
        expect(path.startsWith(exclude.replace(/\/\*\*$/, ''))).toBe(false);
      }
    }
  });

  it('needs no sync includes', () => {
    expect(new HermesPersonaProfile().syncIncludes()).toEqual([]);
  });

  it('never lands under .hypercli', () => {
    const profile = new HermesPersonaProfile();
    for (const path of [profile.soulPath(), profile.userPath()]) {
      expect(path.startsWith('.hypercli/')).toBe(false);
    }
  });
});

describe('resolveAgentPersonaProfile', () => {
  it('resolves the canonical *_acp spellings', () => {
    expect(resolveAgentPersonaProfile('openclaw_acp')).toBeInstanceOf(OpenClawPersonaProfile);
    expect(resolveAgentPersonaProfile('hermes_acp')).toBeInstanceOf(HermesPersonaProfile);
  });

  it('falls back to the default profile for coding, buzz, generic, and unknown runtimes', () => {
    for (const runtime of ['opencode', 'codex', 'claude-code', 'goose', 'kimi-code', 'pi', 'buzz-agent', 'generic', 'unknown-runtime']) {
      const profile = resolveAgentPersonaProfile(runtime);
      expect(profile).toBeInstanceOf(DefaultPersonaProfile);
      expect(profile.soulPath()).toBe(DEFAULT_PERSONA_SOUL_PATH);
      expect(profile.userPath()).toBe(DEFAULT_PERSONA_USER_PATH);
    }
  });

  it('falls back for null/undefined runtimes', () => {
    expect(resolveAgentPersonaProfile(undefined)).toBeInstanceOf(DefaultPersonaProfile);
    expect(resolveAgentPersonaProfile(null)).toBeInstanceOf(DefaultPersonaProfile);
  });

  it('covers every known runtime spelling exactly once per family', () => {
    const runtimes = [
      'generic', 'openclaw-pro', 'openclaw_acp', 'hermes_acp',
      'buzz-agent', 'opencode', 'codex', 'claude-code', 'goose', 'kimi-code', 'pi',
    ];
    const expected: Record<string, 'openclaw_acp' | 'hermes_acp' | 'default'> = {
      'openclaw-pro': 'openclaw_acp',
      openclaw_acp: 'openclaw_acp',
      hermes_acp: 'hermes_acp',
    };
    for (const runtime of runtimes) {
      expect(resolveAgentPersonaProfile(runtime).family).toBe(expected[runtime] ?? 'default');
    }
  });

  it('registry keys form a small closed set', () => {
    expect(Object.keys(AGENT_PERSONA_PROFILES).sort()).toEqual(
      ['hermes_acp', 'openclaw-pro', 'openclaw_acp'],
    );
  });
});

describe('coding runtimes stay on the .hypercli persona', () => {
  it('every coding sync-include table carries the default persona includes', () => {
    const runtimeEntries = Object.entries(DEFAULT_CODING_AGENT_SYNC_INCLUDES) as [CodingAgentRuntime, readonly string[] | null][];
    for (const [runtime, includes] of runtimeEntries) {
      if (includes === null) continue;
      expect(includes, runtime).toContain(DEFAULT_PERSONA_SOUL_PATH);
      expect(includes, runtime).toContain(DEFAULT_PERSONA_USER_PATH);
    }
  });
});
