/**
 * Navigation utilities for cross-domain navigation
 * Handles navigation between main site and subdomains
 *
 * These values are inlined at BUILD TIME by Next.js webpack.
 * Required env vars are validated in each app's next.config.ts
 */

const MAIN_SITE_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL!;
const CONSOLE_URL = process.env.NEXT_PUBLIC_CONSOLE_URL!;
const CLAW_URL = process.env.NEXT_PUBLIC_CLAW_URL || '';
const IS_MAIN_SITE = process.env.NEXT_PUBLIC_IS_MAIN_SITE === 'true';

/**
 * Get navigation URLs - returns absolute URLs for cross-domain links, relative for same-domain
 * These are determined at BUILD TIME based on NEXT_PUBLIC_IS_MAIN_SITE
 */
export const NAV_URLS = {
  // Home always goes to main site
  home: IS_MAIN_SITE ? '/' : MAIN_SITE_URL,

  // Main site pages
  models: IS_MAIN_SITE ? '/models' : `${MAIN_SITE_URL}/models`,
  gpus: IS_MAIN_SITE ? '/gpus' : `${MAIN_SITE_URL}/gpus`,
  playground: IS_MAIN_SITE ? '/playground' : `${MAIN_SITE_URL}/playground`,
  docs: 'https://docs.hypercli.com',
  apiReference: 'https://docs.hypercli.com/api-reference/introduction',
  partner: IS_MAIN_SITE ? '/partner' : `${MAIN_SITE_URL}/partner`,
  enterprise: IS_MAIN_SITE ? '/enterprise' : `${MAIN_SITE_URL}/enterprise`,
  dataCenter: IS_MAIN_SITE ? '/data-center' : `${MAIN_SITE_URL}/data-center`,
  // Architecture & Security page
  architecture: IS_MAIN_SITE ? '/architecture' : `${MAIN_SITE_URL}/architecture`,

  // Legal pages
  privacy: IS_MAIN_SITE ? '/privacy' : `${MAIN_SITE_URL}/privacy`,
  terms: IS_MAIN_SITE ? '/terms' : `${MAIN_SITE_URL}/terms`,

  // Console pages
  console: `${CONSOLE_URL}/dashboard`,
  launch: `${CONSOLE_URL}/jobs`,
  dashboard: `${CONSOLE_URL}/dashboard`,
  jobs: `${CONSOLE_URL}/jobs`,
  history: `${CONSOLE_URL}/history`,
  keys: `${CONSOLE_URL}/keys`,

  // HyperClaw
  claw: CLAW_URL,
  clawDashboard: `${CLAW_URL}/dashboard`,
} as const;

/**
 * Get the contact modal trigger (always opens modal, no navigation)
 */
export const openContactModal = (setModalOpen: (open: boolean) => void) => {
  setModalOpen(true);
};
