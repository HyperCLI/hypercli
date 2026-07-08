import { createContext } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";
import type { HyperAgent } from "@hypercli.com/sdk/agent";
import type { WorkspacesAPI } from "@hypercli.com/sdk/workspaces";

export interface HyperCLIContextValue {
  /** Deployments client (agents CRUD, file ops, logs, shell) */
  deployments: Deployments | null;
  /** HyperAgent client (AI plans, models, inference) */
  hyperAgent: HyperAgent | null;
  /** Workspaces client (shared knowledge/workspace resources) */
  workspaces: WorkspacesAPI | null;
  /** Current auth token used to create SDK clients */
  token: string | null;
  /** Whether SDK clients are ready to use */
  ready: boolean;
  /** Force refresh token and recreate clients */
  refreshClients: () => Promise<void>;
}

export const HyperCLIContext = createContext<HyperCLIContextValue | null>(null);
