---
name: hypercli-account
description: >
  Inspect HyperCLI user, balance, transactions, plans, subscriptions, and
  entitlements; manage API keys; create or migrate the local Base wallet; top
  up, subscribe, redeem codes, and perform wallet login/onboarding. Use for
  hyper billing, keys, user, wallet, and account-oriented hyper agent commands.
---

# HyperCLI Account

Load the `hypercli` and `hypercli-auth` skills before account work. This skill
covers account operations; `hypercli-auth` owns credential precedence,
configuration recovery, and identity diagnostics. References are under:

- `/opt/hypercli/docs/cli/commands/billing.mdx`
- `/opt/hypercli/docs/cli/commands/keys.mdx`
- `/opt/hypercli/docs/cli/commands/user.mdx`
- `/opt/hypercli/docs/cli/commands/wallet.mdx`
- `/opt/hypercli/docs/cli/commands/agent.mdx`

## Complete command map

| Area | Commands |
| --- | --- |
| Product account | `hyper user`, `hyper billing balance`, `transactions`, `invoices` |
| Product keys | `hyper keys create`, `list`, `disable` |
| Local wallet | `hyper wallet create`, `encrypt`, `decrypt`, `address`, `qr`, `balance` |
| Wallet/account | `hyper wallet topup`, `login` |
| Onboarding/payment | `hyper agent onboard`, `subscribe`, `login`, `activate-code` |
| Subscription reads | `hyper agent status`, `plans`, `current-plan`, `subscriptions`, `subscription-summary` |

`hyper user` is a callback command: run the group itself, not
`hyper user get`. Voice, embedding utilities, runtime lifecycle, and provider
config under `hyper agent` belong to their domain skills.

## Safe account inspection

```bash
hyper user
hyper user --output json
hyper billing balance --output json
hyper billing transactions --limit 50 --page 1 --output json
```

`hyper user` fetches the current user record. Billing balance reports total,
available, and optional rewards. Transaction JSON can expose identifiers,
amounts, status, and timestamps; keep it private and paginate instead of
dumping an entire history.

`hyper billing invoices` is registered but its SDK endpoint is still TODO. It
currently prints a placeholder regardless of `--limit` or `--output`; do not
describe that as a successful invoice query.

For identity/capability diagnosis use `hyper me` through the `hypercli-auth`
skill. Account data success does not prove a different key has the scopes
needed for compute, agents, voice, or flows.

## API keys

```bash
# Narrow key for one workload
hyper keys create --name flow-worker --tag flows:* --tag files:*

# Explicit full access, only when required
hyper keys create --name trusted-admin --all --duration 12h

hyper keys list
hyper keys disable <key-id>
```

`create` accepts repeatable `--tag`, optional `--duration` such as `12h` or
`30d`, or `--all`; `--all` and `--tag` are mutually exclusive. Keys default to
no access when no tags are attached. `--all` expands to `*:*` and should be
reserved for a trusted interactive operator.

Common built-in families include `jobs:*`/`jobs:self`, `renders:*`, `flows:*`,
`files:*`, `agents:*`, `models:*`, `voice:*`, `user:*`, and `api:*`. Built-in
scopes/selectors use `:`; user metadata uses `=`. Exact agent selectors are
`agent:<uuid>`, not an agent name. Choose least privilege based on the actual
routes the client will call.

The full API key is printed once by `create`. Keep the terminal private and put
the value directly into an approved secret store; never echo it back in an
answer. `list` shows only ID, tags, preview, activity, and timestamps.

`disable` is irreversible and prompts unless `--yes`. Re-resolve the full key
ID, check its last use and owner, obtain approval, then disable. Do not rotate
or disable a key merely because one unrelated request failed.

## Local wallet lifecycle

Install wallet support before these commands:

```bash
pip install 'hypercli-cli[wallet]'
```

The wallet lives at `~/.hypercli/wallet.json` with mode `0600` when written by
current commands.

```bash
hyper wallet create
hyper wallet address
hyper wallet qr --output wallet-address.png
hyper wallet balance
```

`create` generates a new Ethereum wallet and defaults to an encrypted
keystore. If a wallet exists, it prompts before overwrite. Overwrite destroys
access unless the old private key is backed up, so never confirm automatically.
Fund only with USDC on Base mainnet.

`--no-passphrase` deliberately writes a plaintext private key. Use it only for
an explicitly approved migration workflow, then protect or encrypt it:

```bash
hyper wallet create --no-passphrase
hyper wallet encrypt
hyper wallet decrypt
```

`encrypt` and `decrypt` rewrite the wallet in place. Decrypt leaves a plaintext
private key on disk. Ensure backups and filesystem protections before either
migration. `--passphrase` can leak through history/process inspection; prefer a
prompt or `HYPERCLI_WALLET_PASSPHRASE` in a protected process environment.
Legacy `~/.hypercli/wallet.passphrase` may also be read and is highly sensitive.

`address` does not unlock the keystore. `qr` prints or writes the public Base
address, appending `.png` when missing. An address is public but publishing it
links account activity. `balance` unlocks the wallet and queries the fixed Base
USDC contract/RPC; it is not the same as the HyperCLI product balance.

## Top up and wallet login

```bash
hyper wallet topup 10
hyper wallet login --name workstation
```

`topup` requires a positive USDC decimal with at most six places, sufficient
wallet USDC, and a working product API key. It resolves the current product
user, handles the backend `402` challenge, signs payment, and credits that
user's account. Confirm amount, wallet address, network, product identity, and
API base before signing. On an ambiguous failure, inspect wallet balance,
product balance, and transactions before any retry.

`wallet login` signs a challenge, creates a 180-day full-access desktop key
tagged `*:*` and `key_type=desktop`, saves it to `~/.hypercli/config`, and
prints the key once. This is broad authority. Keep output private and verify
the saved identity with `hyper me` afterward.

## Plans and entitlements

```bash
hyper agent plans
hyper agent current-plan --json
hyper agent subscriptions --json
hyper agent subscription-summary --json
```

- `plans` is remote discovery of current IDs, price, duration, TPM, and RPM.
  Use it immediately before payment; do not hard-code an old plan price.
- `current-plan` shows the effective plan, pooled limits, expiry/provider,
  cancellation state, and slot inventory.
- `subscriptions` lists each subscription/entitlement item.
- `subscription-summary` shows the pooled effective view, active counts, slots,
  and associated user data.

The last three accept `--dev` and `--json`. JSON contains account,
subscription, entitlement, provider, and user identifiers. Do not paste raw
payloads. `--dev` selects a different environment and is never an auth fix.

`hyper agent status` is a legacy local-file view of
`~/.hypercli/agent-key.json`; it prints a long key prefix and expiry/limits.
Use `hyper me` for current server-backed identity checks, and never share the
legacy status output.

## Subscribe, redeem, and onboard

```bash
hyper agent subscribe basic 25
hyper agent activate-code <code>
hyper agent activate-code <code> --extend-existing
```

`subscribe` is an x402 wallet payment. Plan defaults to `basic`; an optional
amount scales the duration. It can print the full returned key and writes
secret-bearing `~/.hypercli/agent-key.json` plus key history in
`~/.hypercli/agent-keys.yaml`. Confirm live plan/amount and wallet balance,
keep all output/state private, and do not retry an uncertain payment.

`activate-code` redeems a secret code for the current account. By default it
creates a new entitlement; `--extend-existing` changes that behavior. The
command prints the code in table mode, and JSON can include grant/entitlement
details. Do not place an unredeemed code in shell logs or responses.

`hyper agent login` is a legacy wallet login path that writes a user-bound key
to `~/.hypercli/agent-key.json`. Prefer `hyper wallet login` for the canonical
product config unless an existing deployment specifically relies on the
legacy file.

Guided onboarding combines wallet creation, Base funding, plan selection,
payment, provider config, and verification:

```bash
hyper agent onboard --status
hyper agent onboard --dry-run --plan basic --amount 25
hyper agent onboard --plan basic --amount 25
```

It stores resumable state under `~/.hypercli/onboard/state.json`, a wallet QR,
wallet/key files, and possibly OpenClaw config. State can contain a full API
key. `--reset` discards onboarding state but not necessarily every generated
wallet/config artifact. JSON mode is noninteractive and may create an encrypted
wallet with an empty passphrase when no passphrase environment is supplied;
do not use it for unattended onboarding without an explicit secure setup.

Treat `--dry-run` only as the implementation's onboarding preflight; inspect
its output before assuming no local state was touched. For real onboarding,
monitor the resumable status rather than restarting the six-step flow.

## Failure and completion rules

- Separate wallet USDC, product account balance, subscription entitlement, and
  API-key authorization. They are four different states.
- Never print private keys, passphrases, wallet JWTs, API keys, activation
  codes, signed payment headers, or secret-bearing state files.
- On `401`/`403`, stop and load the `hypercli-auth` skill. Do not pay, log in,
  or mint a full-access key as an automatic remedy.
- Payment completion requires confirmed account/entitlement state, not merely a
  signature or transaction submission.
- Report public wallet address only when needed, amount/network, resulting
  account or entitlement state, and key ID/name without the key value.
