# Flow 02: Stripe Checkout (Test Mode)

Purchases a plan via Stripe test card after logging in via Privy.

## Steps

1. **Login** via Privy (reuses Flow 01 helper)
2. Navigate to **Dashboard → Plans**
3. Click **Subscribe** on the first available plan
4. Checkout modal opens → click **"Pay $X with Card"**
5. Redirect to **Stripe Checkout** (checkout.stripe.com)
6. Fill test card: `4242 4242 4242 4242`, any future expiry, any CVC
7. Submit payment
8. Stripe processes → redirect back to `/dashboard/plans?session_id=...`

## Prerequisites

- Same as Flow 01 (Privy login)
- Stripe in **test mode** (`sk_test_*` key on the backend)
- Dev backend must have valid `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`

## Environment Variables

Same as Flow 01, plus:

| Variable | Required | Default | Description |
|---|---|---|---|
| `IMAP_PASS` | **yes** | — | IMAP password (for login) |

No additional Stripe env needed — test card details are hardcoded.

## Stripe Test Card

| Field | Value |
|---|---|
| Card number | `4242 4242 4242 4242` |
| Expiry | `12/30` (any future date) |
| CVC | `123` (any 3 digits) |
| Name | `E2E Test` |

See [Stripe test cards docs](https://docs.stripe.com/testing#cards) for more options (3DS, decline, etc.)

## Usage

```bash
# Run headless
IMAP_PASS=xxx npx playwright test e2e/flows/02-stripe-checkout.spec.ts

# Run headed
IMAP_PASS=xxx npx playwright test e2e/flows/02-stripe-checkout.spec.ts --headed
```

## Screenshots

Saved to `e2e/screenshots/`:
- `02-01-dashboard.png` — dashboard after login
- `02-02-plans.png` — plans page
- `02-03-checkout-modal.png` — checkout modal (card vs crypto)
- `02-04-stripe-checkout.png` — Stripe hosted checkout page
- `02-05-card-filled.png` — test card details entered
- `02-06-success.png` — back on plans page after payment

## Key Files

- `02-stripe-checkout.spec.ts` — test spec
- `helpers.ts` — shared login helper

## Notes

- **NOT for every CI build** — this creates real (test) Stripe subscriptions
- Stripe Checkout uses direct inputs (not iframed) on the hosted page
- Don't use `waitForLoadState("networkidle")` on Stripe — it keeps connections alive
- The test subscribes to the first available plan; if the test user already has a plan, it clicks "Upgrade" instead
- Typical runtime: ~40s
- Backend must return the checkout URL from `POST /stripe/{plan_id}`
