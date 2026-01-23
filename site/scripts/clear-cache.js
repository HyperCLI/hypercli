#!/usr/bin/env node

/**
 * Clear Netlify CDN Cache
 * 
 * This script clears the Netlify CDN cache for your site.
 * 
 * Usage:
 *   node scripts/clear-cache.js
 * 
 * Environment variables:
 *   NETLIFY_SITE_ID - Your Netlify site ID (optional, can be read from .netlify/state.json)
 *   NETLIFY_AUTH_TOKEN - Your Netlify personal access token
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const NETLIFY_API = 'api.netlify.com';

function getSiteId() {
  // Try to get from environment first
  if (process.env.NETLIFY_SITE_ID) {
    return process.env.NETLIFY_SITE_ID;
  }

  // Try to read from .netlify/state.json
  const statePath = path.join(__dirname, '..', '.netlify', 'state.json');
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return state.siteId;
    } catch (err) {
      console.error('⚠️  Could not read site ID from .netlify/state.json');
    }
  }

  return null;
}

function clearCache(siteId, authToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ clear_cache: true });

    const options = {
      hostname: NETLIFY_API,
      path: `/api/v1/sites/${siteId}/builds`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('🧹 Clearing Netlify CDN cache...\n');

  const siteId = getSiteId();
  const authToken = process.env.NETLIFY_AUTH_TOKEN;

  if (!siteId) {
    console.error('❌ Error: NETLIFY_SITE_ID not found.');
    console.error('   Set the NETLIFY_SITE_ID environment variable or run this from a linked Netlify site.\n');
    process.exit(1);
  }

  if (!authToken) {
    console.error('❌ Error: NETLIFY_AUTH_TOKEN not found.');
    console.error('   Get your personal access token from: https://app.netlify.com/user/applications#personal-access-tokens');
    console.error('   Then set it as an environment variable: export NETLIFY_AUTH_TOKEN=your_token\n');
    process.exit(1);
  }

  try {
    console.log(`📡 Site ID: ${siteId}`);
    console.log('🔄 Triggering cache clear build...\n');

    const result = await clearCache(siteId, authToken);

    console.log('✅ Cache clearing build initiated successfully!');
    console.log(`   Build ID: ${result.id}`);
    console.log(`   Deploy URL: ${result.deploy_url || 'N/A'}\n`);

    console.log('💡 Next steps:');
    console.log('   1. Wait for the build to complete (check Netlify dashboard)');
    console.log('   2. Cache should be cleared within 1-2 minutes');
    console.log('   3. Hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)\n');

    console.log('📝 Alternative: Increment NEXT_PUBLIC_CACHE_VERSION in netlify.toml and deploy');

  } catch (err) {
    console.error('❌ Error clearing cache:', err.message);
    process.exit(1);
  }
}

main();
