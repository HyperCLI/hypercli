#!/bin/bash

# Script to clear Netlify CDN cache
# Usage: ./scripts/clear-cache.sh

echo "🧹 Clearing Netlify CDN cache..."

# Check if Netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "❌ Netlify CLI is not installed. Install it with:"
    echo "   npm install -g netlify-cli"
    exit 1
fi

# Clear the cache for the current site
echo "📡 Purging cache for production deployment..."
netlify api deleteSiteBuild --data='{"cache_clear": true}'

# Alternative method: use the Sites API directly
# This requires your site ID and an access token
if [ -n "$NETLIFY_SITE_ID" ] && [ -n "$NETLIFY_AUTH_TOKEN" ]; then
    echo "🔄 Using API to clear cache for site: $NETLIFY_SITE_ID"
    curl -X POST "https://api.netlify.com/api/v1/sites/$NETLIFY_SITE_ID/builds" \
         -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
         -H "Content-Type: application/json" \
         -d '{"clear_cache": true}'
    echo ""
fi

echo "✅ Cache clearing initiated!"
echo ""
echo "💡 Tips for immediate cache refresh:"
echo "   1. Increment NEXT_PUBLIC_CACHE_VERSION in netlify.toml"
echo "   2. Deploy to production"
echo "   3. Wait 1-2 minutes for CDN propagation"
echo "   4. Hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)"
