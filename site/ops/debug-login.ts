import { chromium } from 'playwright';

const BASE_URL = 'https://gilfoyle.hypercli.com';
const TEST_EMAIL = 'agent@nedos.io';

async function debugLogin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });

  // Intercept all network requests
  const requests: { url: string; method: string; status?: number; type?: string }[] = [];
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('api.') || url.includes('auth') || url.includes('privy') || url.includes('login')) {
      requests.push({ url, method: req.method(), type: req.resourceType() });
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('api.') || url.includes('auth') || url.includes('privy') || url.includes('login')) {
      const existing = requests.find(r => r.url === url && !r.status);
      if (existing) existing.status = res.status();
    }
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('auth') || text.includes('token') || text.includes('cookie') || text.includes('login') || text.includes('🍪') || text.includes('error') || text.includes('Error')) {
      console.log(`[CONSOLE ${msg.type()}] ${text}`);
    }
  });

  console.log('=== Step 1: Navigate to', BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  console.log('Page title:', await page.title());
  console.log('URL:', page.url());

  // Check initial auth state
  const initialLS = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const result: Record<string, string> = {};
    for (const k of keys) {
      if (k.includes('auth') || k.includes('token') || k.includes('privy') || k.includes('claw')) {
        result[k] = localStorage.getItem(k)?.slice(0, 80) + '...';
      }
    }
    return result;
  });
  console.log('\n=== Initial localStorage:', JSON.stringify(initialLS, null, 2));

  const initialCookies = await context.cookies();
  console.log('\n=== Initial cookies:', initialCookies.map(c => `${c.name}=${c.value.slice(0, 30)}... (domain: ${c.domain})`));

  // Check if there's a login/sign-in button
  console.log('\n=== Step 2: Looking for login button...');
  await page.screenshot({ path: '/tmp/debug-login-1-initial.png' });

  // Try to find various login buttons
  const loginSelectors = [
    'button:has-text("Sign In")',
    'button:has-text("Login")',
    'button:has-text("Log In")',
    'button:has-text("Connect")',
    'button:has-text("Get Started")',
    'button:has-text("Sign Up")',
    'a:has-text("Sign In")',
    'a:has-text("Login")',
    '[data-testid*="login"]',
    '[data-testid*="sign"]',
  ];

  let loginButton = null;
  for (const sel of loginSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
      loginButton = el;
      console.log(`Found login button: "${sel}" -> text: "${await el.textContent()}"`);
      break;
    }
  }

  if (!loginButton) {
    // Maybe already authenticated or need to explore the page
    console.log('No login button found. Page may already be authenticated or have different UX.');
    const bodyText = await page.locator('body').textContent();
    console.log('Body text snippet:', bodyText?.slice(0, 500));

    // Check all buttons
    const buttons = await page.locator('button').allTextContents();
    console.log('All buttons:', buttons.filter(b => b.trim()));

    // Check all links
    const links = await page.locator('a').allTextContents();
    console.log('All links:', links.filter(l => l.trim()).slice(0, 20));
  } else {
    console.log('\n=== Step 3: Clicking login button...');
    await loginButton.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/debug-login-2-after-click.png' });

    // Look for email input in Privy modal
    console.log('\n=== Step 4: Looking for email input...');
    const emailInputSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email"]',
      'input[placeholder*="Email"]',
      'input[aria-label*="email"]',
    ];

    let emailInput = null;
    for (const sel of emailInputSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        emailInput = el;
        console.log(`Found email input: "${sel}"`);
        break;
      }
    }

    // Also check iframes (Privy often uses iframes)
    const frames = page.frames();
    console.log(`Found ${frames.length} frames`);
    for (const frame of frames) {
      console.log(`  Frame: ${frame.url()}`);
      if (frame.url().includes('privy')) {
        for (const sel of emailInputSelectors) {
          const el = frame.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            emailInput = el;
            console.log(`Found email input in Privy iframe: "${sel}"`);
            break;
          }
        }
      }
    }

    if (emailInput) {
      console.log('\n=== Step 5: Entering email:', TEST_EMAIL);
      await emailInput.fill(TEST_EMAIL);
      await page.screenshot({ path: '/tmp/debug-login-3-email.png' });

      // Look for submit button
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Submit")',
        'button:has-text("Send")',
        'button:has-text("Log in")',
      ];

      for (const sel of submitSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log(`Found submit button: "${sel}" -> "${await btn.textContent()}"`);
          await btn.click();
          console.log('Clicked submit. Waiting for response...');
          await page.waitForTimeout(5000);
          await page.screenshot({ path: '/tmp/debug-login-4-after-submit.png' });
          break;
        }
      }
    } else {
      console.log('No email input found. Checking page state...');
      const allInputs = await page.locator('input').all();
      for (const inp of allInputs) {
        const type = await inp.getAttribute('type');
        const name = await inp.getAttribute('name');
        const ph = await inp.getAttribute('placeholder');
        const visible = await inp.isVisible();
        if (visible) console.log(`  Input: type=${type} name=${name} placeholder=${ph}`);
      }
    }
  }

  // Final state check
  console.log('\n=== Final State ===');
  const finalLS = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const result: Record<string, string> = {};
    for (const k of keys) {
      result[k] = localStorage.getItem(k)?.slice(0, 100) + '...';
    }
    return result;
  });
  console.log('localStorage keys:', Object.keys(finalLS));
  for (const [k, v] of Object.entries(finalLS)) {
    if (k.includes('auth') || k.includes('token') || k.includes('privy') || k.includes('claw')) {
      console.log(`  ${k}: ${v}`);
    }
  }

  const finalCookies = await context.cookies();
  console.log('\nCookies:', finalCookies.map(c => `${c.name} (domain: ${c.domain}, path: ${c.path})`));

  console.log('\n=== Network Requests (auth-related) ===');
  for (const r of requests) {
    console.log(`  ${r.method} ${r.url} -> ${r.status ?? 'pending'}`);
  }

  await browser.close();
}

debugLogin().catch(console.error);
