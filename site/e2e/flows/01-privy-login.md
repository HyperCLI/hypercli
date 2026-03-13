# Flow 01: Privy Login

Automated login via Privy email OTP using IMAP to fetch the verification code.

## Steps

1. Navigate to landing page
2. Click **Sign In** → Privy modal opens
3. Enter email address → click **Submit**
4. Privy sends 6-digit OTP to the email
5. IMAP helper polls for the OTP email (up to 30s)
6. Enter OTP digits into Privy's 6-input form
7. Privy authenticates → redirect to `/dashboard`

## Prerequisites

- Dev frontend running (e.g., `https://gilfoyle.dev.hypercli.com`)
- IMAP-accessible email account (Fastmail, Gmail, etc.)
- Python 3 (for `fetch-otp.py` IMAP helper)

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `IMAP_PASS` | **yes** | — | IMAP password / app password |
| `PRIVY_EMAIL` | no | `agent@nedos.io` | Email for Privy login |
| `IMAP_HOST` | no | `imap.fastmail.com` | IMAP server |
| `IMAP_USER` | no | `agent@nedos.io` | IMAP username |
| `E2E_BASE_URL` | no | `https://gilfoyle.dev.hypercli.com` | Frontend URL |

## Usage

```bash
# Run headless
IMAP_PASS=xxx npx playwright test e2e/flows/01-privy-login.spec.ts

# Run headed (visible browser)
IMAP_PASS=xxx npx playwright test e2e/flows/01-privy-login.spec.ts --headed

# Debug mode (step-by-step)
IMAP_PASS=xxx npx playwright test e2e/flows/01-privy-login.spec.ts --debug
```

## Screenshots

Saved to `e2e/screenshots/`:
- `01-landing.png` — landing page before login
- `01-dashboard.png` — dashboard after successful login

## Key Files

- `01-privy-login.spec.ts` — test spec
- `helpers.ts` — shared `privyLogin()` function (reused by other flows)
- `fetch-otp.py` — Python IMAP helper (polls for Privy OTP)

## Notes

- The IMAP helper clears old Privy emails before submitting, so it only picks up the fresh OTP
- Privy OTP inputs are 6 individual `<input name="code-0">` through `<input name="code-5">`
- Typical runtime: ~20-25s (most time spent waiting for the OTP email)
