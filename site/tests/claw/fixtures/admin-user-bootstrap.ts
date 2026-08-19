/**
 * Create and destroy a throwaway identity for the agents E2E suite.
 *
 * This is the admin-sdk's user surface, expressed directly over HTTP: the SDK
 * is a private package and this repository is public, so we cannot depend on
 * it here. The shapes are its shapes -- POST /admin/users, DELETE
 * /admin/users/{id}, X-BACKEND-API-KEY -- so the two stay legible against each
 * other.
 *
 * Everything comes from the environment. Nothing is defaulted to a real host,
 * and nothing is written down here that a public repository should not carry.
 */

const ADMIN_KEY_HEADER = "X-BACKEND-API-KEY";

export interface AdminUserIdentity {
  email: string;
  /** Shared by both planes: the Agents projection reuses the Orchestra id. */
  userId: string;
  orchestraAdminBase: string;
  agentsAdminBase: string;
}

function required(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required to bootstrap an E2E identity`);
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Orchestra's admin base. ADMIN_BACKEND_BASE is a secret so the host stays
 * masked in logs; TEST_API_BASE_URL is the plaintext fallback CI already sets.
 */
function orchestraAdminBase(): string {
  const configured = (process.env.ADMIN_BACKEND_BASE ?? process.env.TEST_API_BASE_URL ?? "").trim();
  if (!configured) {
    throw new Error("Set ADMIN_BACKEND_BASE (preferred) or TEST_API_BASE_URL");
  }
  const base = stripTrailingSlash(configured);
  return base.endsWith("/api") ? base : `${base}/api`;
}

/**
 * The Agents admin base. Derived only from an explicit override or a known dev
 * host -- deriving it by guesswork is how a test suite ends up pointed at
 * production without anyone noticing.
 */
function agentsAdminBase(): string {
  const override = (process.env.TEST_AGENTS_ADMIN_BASE ?? "").trim();
  if (override) return stripTrailingSlash(override);

  const product = stripTrailingSlash(orchestraAdminBase().replace(/\/api$/, ""));
  const url = new URL(product);
  const agentsHost: Record<string, string> = {
    "api.dev.hypercli.com": "api.agents.dev.hypercli.com",
    "api.dev.hyperclaw.app": "api.agents.dev.hypercli.com",
    "dev-api.hyperclaw.app": "api.agents.dev.hypercli.com",
  };
  const mapped = agentsHost[url.hostname.toLowerCase()];
  if (!mapped) {
    throw new Error(
      `Cannot derive the agents admin API from ${url.hostname}; set TEST_AGENTS_ADMIN_BASE`,
    );
  }
  return `${url.protocol}//${mapped}`;
}

/** Refuse to bootstrap against anything but dev unless explicitly allowed. */
function assertDevTarget(orchestra: string, agents: string): void {
  if ((process.env.ALLOW_NON_DEV_E2E_USER_BOOTSTRAP ?? "").trim() === "1") return;
  const hosts = [new URL(orchestra).hostname, new URL(agents).hostname];
  for (const host of hosts) {
    if (!host.includes("dev")) {
      throw new Error(
        `Refusing to bootstrap an E2E identity against ${host}; `
          + "set ALLOW_NON_DEV_E2E_USER_BOOTSTRAP=1 to override",
      );
    }
  }
}

async function adminRequest(
  base: string,
  path: string,
  init: { method: string; body?: unknown; expect?: number[] },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${stripTrailingSlash(base)}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      [ADMIN_KEY_HEADER]: required("BACKEND_API_KEY"),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const accepted = init.expect ?? [200, 201];
  if (!accepted.includes(response.status)) {
    // The host is deliberately not echoed: it may be a secret.
    throw new Error(
      `${init.method} ${path} failed: ${response.status} ${String(text).slice(0, 300)}`,
    );
  }
  return { status: response.status, body };
}

/**
 * Create a fresh identity on both planes.
 *
 * The id is generated here so the two planes share one, and so a run never
 * addresses an identity it did not create. That matters more than it sounds:
 * the Agents admin resolver used to answer an unknown id with the oldest user
 * in the table, so a stale or guessed id was somebody else's account.
 */
export async function bootstrapAdminUser(suite = "agents-subscription"): Promise<AdminUserIdentity> {
  const orchestra = orchestraAdminBase();
  const agents = agentsAdminBase();
  assertDevTarget(orchestra, agents);

  const userId = crypto.randomUUID();
  const email = `${suite}-${userId.replace(/-/g, "").slice(0, 12)}@example.com`;

  await adminRequest(orchestra, "/admin/users", {
    method: "POST",
    body: { user_id: userId, email, user_type: "PAID" },
    expect: [200, 201, 409],
  });

  // The Agents projection reuses the Orchestra id, which is what lets teardown
  // address one identity on both planes. Its body deliberately differs from
  // Orchestra's: this plane derives the account type itself and rejects
  // user_type outright, so sending one 422s.
  await adminRequest(agents, "/admin/users", {
    method: "POST",
    body: {
      user_id: userId,
      external_id: userId,
      orchestra_user_id: userId,
      email,
    },
    expect: [200, 201, 409],
  });

  return { email, userId, orchestraAdminBase: orchestra, agentsAdminBase: agents };
}

/**
 * Destroy the identity, Agents plane first.
 *
 * Deleting a user is refused while it still owns Agents whose deleted_at is
 * unset, so a run that dies before its own teardown strands its identity. The
 * Agents are deleted here first for exactly that reason -- and by id, never by
 * a filter that could match something this run did not create.
 */
export async function cleanupAdminUser(identity: AdminUserIdentity): Promise<void> {
  const failures: string[] = [];

  try {
    const { body } = await adminRequest(
      identity.agentsAdminBase,
      `/admin/deployments?user_id=${identity.userId}&limit=100`,
      { method: "GET", expect: [200, 404] },
    );
    const items = (body as { items?: Array<{ id?: string }> } | null)?.items ?? [];
    for (const agent of items) {
      if (!agent?.id) continue;
      await adminRequest(identity.agentsAdminBase, `/admin/deployments/${agent.id}`, {
        method: "DELETE",
        expect: [200, 202, 204, 404, 410],
      });
    }
  } catch (error) {
    failures.push(`agents: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const [label, base] of [
    ["agents user", identity.agentsAdminBase],
    ["orchestra user", identity.orchestraAdminBase],
  ] as const) {
    try {
      await adminRequest(base, `/admin/users/${identity.userId}`, {
        method: "DELETE",
        expect: [200, 202, 204, 404, 410],
      });
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length) {
    // Loud on purpose. Silent teardown is what left fifty identities on dev.
    throw new Error(`E2E identity cleanup failed for ${identity.email}: ${failures.join("; ")}`);
  }
}
