/**
 * HyperCLI SDK - TypeScript client for HyperCLI API
 */

// Main client
export { HyperCLI, type HyperCLIOptions } from './client.js';

// Configuration
export {
  configure,
  getApiKey,
  getApiUrl,
  getWsUrl,
  GHCR_IMAGES,
  COMFYUI_IMAGE,
  DEFAULT_API_URL,
  DEFAULT_WS_URL,
} from './config.js';

// Errors
export { APIError } from './errors.js';

// HTTP Client
export { HTTPClient } from './http.js';

// Billing API
export { Billing, type Balance, type Transaction } from './billing.js';

// Jobs API
export {
  Jobs,
  type Job,
  type GPUMetrics,
  type SystemMetrics,
  type JobMetrics,
  type CreateJobOptions,
  findJob,
  findById,
  findByHostname,
  findByIp,
  isUuid,
} from './jobs.js';

// Instances API
export {
  Instances,
  type GPUType,
  type GPUConfig,
  type Region,
  type GPUPricing,
  type PricingTier,
  type AvailableGPU,
} from './instances.js';

// Renders API
export {
  Renders,
  type Render,
  type RenderStatus,
} from './renders.js';

// Files API
export {
  Files,
  type File,
} from './files.js';

// User API
export {
  UserAPI,
  type User,
} from './user.js';

// Keys API
export {
  KeysAPI,
  type ApiKey,
} from './keys.js';

// Logs
export {
  LogStream,
  streamLogs,
  fetchLogs,
} from './logs.js';

// HyperClaw
export {
  Claw,
  type ClawKey,
  type ClawPlan,
  type ClawModel,
} from './claw.js';

// Job helpers
export {
  BaseJob,
  type BaseJobOptions,
} from './job/base.js';

export {
  ComfyUIJob,
  DEFAULT_OBJECT_INFO,
  findNode,
  findNodes,
  applyParams,
  applyGraphModes,
  graphToApi,
} from './job/comfyui.js';

export {
  GradioJob,
  type GradioJobOptions,
} from './job/gradio.js';
