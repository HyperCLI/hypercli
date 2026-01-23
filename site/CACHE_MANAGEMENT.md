# Cache Management Guide

This guide explains how to clear server-side caching on production when UI changes aren't appearing.

## Problem

After deploying changes to production, you may not see your UI updates (especially theme changes) due to:
- Netlify CDN caching
- Browser caching
- Next.js build cache

## Solutions

### Method 1: Increment Cache Version (Recommended)

This is the simplest and most reliable method:

1. Open `netlify.toml`
2. Find the `NEXT_PUBLIC_CACHE_VERSION` environment variable
3. Increment the version number:
   ```toml
   NEXT_PUBLIC_CACHE_VERSION = "2"  # was "1"
   ```
4. Commit and push to trigger a new deployment
5. Wait 1-2 minutes for CDN propagation
6. Hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)

### Method 2: Use the Clear Cache Script

#### Option A: Using Node.js (Cross-platform)

```bash
# Set your Netlify credentials (get token from https://app.netlify.com/user/applications)
export NETLIFY_AUTH_TOKEN="your_token_here"
export NETLIFY_SITE_ID="your_site_id_here"  # Optional if running from linked site

# Run the script
npm run clear-cache
```

#### Option B: Using Bash (Linux/Mac/Git Bash)

```bash
export NETLIFY_AUTH_TOKEN="your_token_here"
npm run clear-cache:sh
```

#### Option C: Using Batch (Windows)

```cmd
set NETLIFY_AUTH_TOKEN=your_token_here
npm run clear-cache:bat
```

### Method 3: Clear Cache via Netlify CLI

If you have Netlify CLI installed globally:

```bash
netlify login
netlify api deleteSiteBuild --data='{"cache_clear": true}'
```

### Method 4: Clear Cache via Netlify Dashboard

1. Go to https://app.netlify.com
2. Select your site
3. Go to "Deploys" tab
4. Click "Trigger deploy" → "Clear cache and deploy site"

## Cache Control Headers

The project now includes optimized cache control headers in `netlify.toml`:

- **HTML files**: No caching (`max-age=0`) - ensures latest content
- **Next.js static assets**: Cached forever with content hashes (`max-age=31536000`)
- **CSS/JS files**: Cached for 1 hour (`max-age=3600`)

## Getting Your Netlify Credentials

### Site ID
Find your site ID in:
- Netlify Dashboard → Site Settings → General → Site details → Site ID
- Or in `.netlify/state.json` if you've linked the site locally

### Personal Access Token
1. Go to https://app.netlify.com/user/applications#personal-access-tokens
2. Click "New access token"
3. Give it a name (e.g., "Cache Clearing")
4. Copy the token (you won't be able to see it again)
5. Store it securely (e.g., in your password manager)

## Troubleshooting

### Changes still not appearing?

1. **Check deployment status**: Ensure your latest commit was deployed
2. **Verify changes in repo**: Confirm changes are in the branch being deployed
3. **Hard refresh**: Use Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
4. **Clear browser cache**: Go to DevTools → Application → Clear storage
5. **Check in incognito**: Test in an incognito/private browser window
6. **Wait for CDN propagation**: CDN changes can take 1-2 minutes to propagate globally
7. **Check build logs**: Look for errors in Netlify build logs

### Cache script not working?

- **Netlify CLI not found**: Install with `npm install -g netlify-cli`
- **Authentication failed**: Check your `NETLIFY_AUTH_TOKEN` is correct
- **Site not found**: Verify `NETLIFY_SITE_ID` is correct

## Best Practices

1. **For theme changes**: Always increment `NEXT_PUBLIC_CACHE_VERSION` and redeploy
2. **For critical fixes**: Use "Clear cache and deploy" from Netlify dashboard
3. **For development**: Use `npm run dev` locally - no caching issues
4. **After major updates**: Consider incrementing cache version proactively

## Environment Variables

The following environment variable can be used for cache busting:

- `NEXT_PUBLIC_CACHE_VERSION`: Increment this to force browser cache invalidation

To use it in your components:
```typescript
// This value will change when NEXT_PUBLIC_CACHE_VERSION is updated
const cacheVersion = process.env.NEXT_PUBLIC_CACHE_VERSION;
```

## Additional Resources

- [Netlify Cache Documentation](https://docs.netlify.com/configure-builds/manage-dependencies/#cache-node-modules)
- [Next.js Caching Documentation](https://nextjs.org/docs/app/building-your-application/caching)
- [HTTP Cache-Control Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
