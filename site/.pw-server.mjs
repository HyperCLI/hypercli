// Persistent Playwright server: launches headed chromium, exposes a tiny HTTP
// control API on 127.0.0.1:9222 so we can drive it from bash.
// Usage:
//   node .pw-server.mjs            # regular debugging: viewport follows window
//   node .pw-server.mjs --desktop  # deterministic 1440x900 viewport (e2e-style)
import { chromium } from 'playwright';

const PORT = Number(process.env.PW_PORT || 9222);
const desktop = process.argv.includes('--desktop') || process.env.PW_DESKTOP === '1';
const browser = await chromium.launch({ headless: false });
// --desktop pins a fixed viewport for reproducible e2e runs; the default mode
// lets the page viewport follow the real window size so the headed browser
// matches the host screen for interactive debugging.
const context = await browser.newContext(
  desktop ? { viewport: { width: 1440, height: 900 } } : { viewport: null },
);
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[console.${msg.type()}]`, msg.text());
  }
});
page.on('pageerror', (err) => console.log('[pageerror]', String(err)));

const { createServer } = await import('node:http');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (url.pathname === '/goto') {
      await page.goto(url.searchParams.get('url'), { waitUntil: 'domcontentloaded' });
      return send(200, { ok: true, title: await page.title(), url: page.url() });
    }
    if (url.pathname === '/eval') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { fn } = JSON.parse(body || '{}');
      const result = await page.evaluate(fn);
      return send(200, { ok: true, result });
    }
    if (url.pathname === '/screenshot') {
      const path = url.searchParams.get('path') || '/tmp/pw-shot.png';
      await page.screenshot({ path, fullPage: url.searchParams.get('full') === '1' });
      return send(200, { ok: true, path });
    }
    if (url.pathname === '/click') {
      await page.click(url.searchParams.get('sel'));
      return send(200, { ok: true });
    }
    if (url.pathname === '/fill') {
      await page.fill(url.searchParams.get('sel'), url.searchParams.get('value') ?? '');
      return send(200, { ok: true });
    }
    if (url.pathname === '/url') {
      return send(200, { ok: true, url: page.url(), title: await page.title() });
    }
    if (url.pathname === '/wait') {
      const ms = Number(url.searchParams.get('ms') || 1000);
      await page.waitForTimeout(ms);
      return send(200, { ok: true });
    }
    send(404, { ok: false, error: 'unknown route' });
  } catch (err) {
    send(500, { ok: false, error: String(err) });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`playwright control listening on http://127.0.0.1:${PORT} (${desktop ? 'desktop 1440x900' : 'window-size viewport'})`);
  console.log('routes: /goto?url=  /eval  /screenshot?path=  /click?sel=  /fill?sel=&value=  /url  /wait?ms=');
});
