import { sameOpenClawSelectableSessionKey } from "@/lib/openclaw-session-sdk-surface";

const DATABASE_NAME = "hypercli-skill-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "scopes";
const FALLBACK_PREFIX = "hypercli.skill-drafts.v1:";
const MAX_DRAFTS_PER_SCOPE = 50;
const MAX_REVISIONS_PER_SCOPE = 100;
const MAX_TEST_SESSIONS_PER_SCOPE = 100;

export type SkillDraftOrigin = "created" | "imported";

export interface SkillDraftScope {
  ownerId: string;
  agentId: string;
}

export interface SkillDraftRecord {
  id: string;
  origin: SkillDraftOrigin;
  content: string;
  directories: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillDraftRevision {
  id: string;
  draftId: string;
  skillId: string;
  content: string;
  directories: string[];
  contentHash: string;
  createdAt: number;
}

export interface SkillDraftTestSession {
  id: string;
  draftId: string;
  revisionId: string;
  skillId: string;
  skillName: string;
  requestedSessionKey: string;
  canonicalSessionKey?: string;
  testedAt: number;
}

interface SkillDraftCollection {
  key: string;
  version: 1;
  drafts: SkillDraftRecord[];
  revisions: SkillDraftRevision[];
  testSessions: SkillDraftTestSession[];
}

const memoryFallback = new Map<string, SkillDraftCollection>();

function normalizedScopePart(value: string, fallback: string): string {
  return value.trim().toLowerCase() || fallback;
}

export function skillDraftScopeKey(scope: SkillDraftScope): string {
  return `${encodeURIComponent(normalizedScopePart(scope.ownerId, "local"))}:${encodeURIComponent(normalizedScopePart(scope.agentId, "unknown-agent"))}`;
}

function emptyCollection(key: string): SkillDraftCollection {
  return { key, version: 1, drafts: [], revisions: [], testSessions: [] };
}

function validCollection(value: unknown, key: string): SkillDraftCollection {
  if (!value || typeof value !== "object") return emptyCollection(key);
  const candidate = value as Partial<SkillDraftCollection>;
  if (candidate.version !== 1 || candidate.key !== key) return emptyCollection(key);
  return {
    key,
    version: 1,
    drafts: Array.isArray(candidate.drafts) ? candidate.drafts : [],
    revisions: Array.isArray(candidate.revisions) ? candidate.revisions : [],
    testSessions: Array.isArray(candidate.testSessions) ? candidate.testSessions : [],
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readCollection(scope: SkillDraftScope): Promise<SkillDraftCollection> {
  const key = skillDraftScopeKey(scope);
  const database = await openDatabase();
  if (database) {
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return validCollection(value, key);
    } catch {
      database.close();
    }
  }

  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
      return stored ? validCollection(JSON.parse(stored), key) : emptyCollection(key);
    } catch {}
  }
  return validCollection(memoryFallback.get(key), key);
}

async function writeCollection(scope: SkillDraftScope, collection: SkillDraftCollection): Promise<void> {
  const key = skillDraftScopeKey(scope);
  const value = { ...collection, key, version: 1 as const };
  const database = await openDatabase();
  if (database) {
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      return;
    } catch {
      database.close();
    }
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
      return;
    } catch {}
  }
  memoryFallback.set(key, value);
}

async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function loadSkillDrafts(scope: SkillDraftScope): Promise<SkillDraftRecord[]> {
  const collection = await readCollection(scope);
  return [...collection.drafts].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSkillDraft(scope: SkillDraftScope, draftId: string): Promise<SkillDraftRecord | null> {
  const collection = await readCollection(scope);
  return collection.drafts.find((draft) => draft.id === draftId) ?? null;
}

export async function saveSkillDraft(
  scope: SkillDraftScope,
  draft: Pick<SkillDraftRecord, "id" | "origin" | "content" | "directories">,
): Promise<SkillDraftRecord> {
  const collection = await readCollection(scope);
  const previous = collection.drafts.find((item) => item.id === draft.id);
  const now = Date.now();
  const record: SkillDraftRecord = {
    ...draft,
    directories: [...new Set(draft.directories)].sort(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const drafts = [record, ...collection.drafts.filter((item) => item.id !== record.id)];
  if (drafts.length > MAX_DRAFTS_PER_SCOPE) throw new Error(`You can keep at most ${MAX_DRAFTS_PER_SCOPE} local skill drafts for one agent.`);
  await writeCollection(scope, { ...collection, drafts });
  return record;
}

export async function discardSkillDraft(scope: SkillDraftScope, draftId: string): Promise<void> {
  const collection = await readCollection(scope);
  const revisionIds = new Set(collection.revisions.filter((revision) => revision.draftId === draftId).map((revision) => revision.id));
  await writeCollection(scope, {
    ...collection,
    drafts: collection.drafts.filter((draft) => draft.id !== draftId),
    revisions: collection.revisions.filter((revision) => revision.draftId !== draftId),
    testSessions: collection.testSessions.filter((session) => session.draftId !== draftId && !revisionIds.has(session.revisionId)),
  });
}

export async function createSkillDraftRevision(
  scope: SkillDraftScope,
  draft: Pick<SkillDraftRecord, "id" | "content" | "directories">,
): Promise<SkillDraftRevision> {
  const collection = await readCollection(scope);
  const hash = await contentHash(`${draft.content}\n${JSON.stringify([...draft.directories].sort())}`);
  const id = `${draft.id}:${hash}`;
  const existing = collection.revisions.find((revision) => revision.id === id);
  if (existing) return existing;
  const revision: SkillDraftRevision = {
    id,
    draftId: draft.id,
    skillId: draft.id,
    content: draft.content,
    directories: [...draft.directories].sort(),
    contentHash: hash,
    createdAt: Date.now(),
  };
  const revisions = [revision, ...collection.revisions];
  if (revisions.length > MAX_REVISIONS_PER_SCOPE) throw new Error(`You can keep at most ${MAX_REVISIONS_PER_SCOPE} tested skill revisions for one agent.`);
  await writeCollection(scope, { ...collection, revisions });
  return revision;
}

export async function linkSkillDraftTestSession(
  scope: SkillDraftScope,
  input: Omit<SkillDraftTestSession, "id" | "testedAt">,
): Promise<SkillDraftTestSession> {
  const collection = await readCollection(scope);
  const record: SkillDraftTestSession = {
    ...input,
    id: `${input.draftId}:${input.requestedSessionKey}`,
    testedAt: Date.now(),
  };
  const testSessions = [record, ...collection.testSessions.filter((session) => session.id !== record.id)]
    .slice(0, MAX_TEST_SESSIONS_PER_SCOPE);
  await writeCollection(scope, { ...collection, testSessions });
  return record;
}

export async function findSkillDraftTestSession(
  scope: SkillDraftScope,
  sessionKey: string,
): Promise<SkillDraftTestSession | null> {
  const collection = await readCollection(scope);
  return collection.testSessions.find((session) => (
    sameOpenClawSelectableSessionKey(session.requestedSessionKey, sessionKey)
    || sameOpenClawSelectableSessionKey(session.canonicalSessionKey, sessionKey)
  )) ?? null;
}

export async function updateSkillDraftTestSessionKey(
  scope: SkillDraftScope,
  requestedSessionKey: string,
  canonicalSessionKey: string,
): Promise<void> {
  const collection = await readCollection(scope);
  const testSessions = collection.testSessions.map((session) => (
    sameOpenClawSelectableSessionKey(session.requestedSessionKey, requestedSessionKey)
      ? { ...session, canonicalSessionKey }
      : session
  ));
  await writeCollection(scope, { ...collection, testSessions });
}
