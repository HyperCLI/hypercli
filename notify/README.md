# Notify

`notify/` is the thin delivery service for backend-originated notifications.

The service is intentionally narrow:
- authenticate with `X-BACKEND-API-KEY`
- route by path category
- deliver to Telegram and/or Slack using provider-specific channel maps
- preserve client-submitted formatting
- keep a short in-memory log buffer for debugging

It is not supposed to own message composition anymore.

Current runtime model:
- one incoming payload contract
- one category path
- one notifier per provider
- one async worker queue per provider

That means Telegram and Slack are isolated from each other:
- Telegram flood control does not block Slack
- Slack rate limiting does not block Telegram
- each provider owns its own retry behavior

## Endpoints

- `POST /notify/{category}`
- `GET /logs`
- `GET /health`

Reserved paths:
- `health`
- `logs`

`/notify/{category}` determines the configured destination. There is no body `category` field.

## Auth

Every non-health endpoint requires:

```http
X-BACKEND-API-KEY: <key>
```

## Payload

Canonical request body:

```json
{
  "version": "v1",
  "severity": "info",
  "lines": [
    "<b>Job Complete</b>",
    "",
    "Job: <code>abc123</code>"
  ],
  "thread_id": "123",
  "media": null,
  "media_filename": null,
  "media_url": null
}
```

Rules:
- `version` is optional and defaults to `"v1"`.
- `severity` is optional and defaults to `"info"`.
- `lines` is required and must be a non-empty array of strings.
- Empty strings in `lines` are preserved and mean an intentional blank line.
- `thread_id` is optional and maps to provider-native threading:
  - Telegram: `message_thread_id`
  - Slack: `thread_ts`
- `media` is optional base64 content.
- `media_url` is optional remote media.
- `media` and `media_url` are mutually exclusive.
- `media_filename` is required when `media` or `media_url` is provided.

Provider rendering:
- Telegram joins `lines` with `\n` and sends HTML parse mode.
- Slack joins `lines` with `\n`, converts basic Telegram-style HTML (`<b>`, `<code>`, etc.) to Slack markdown, and posts via the Slack Web API.

## Formatting

Clients own the formatting.

That means the caller should send the final presentation-ready lines:

```json
{
  "lines": [
    "<b>Build Succeeded</b>",
    "",
    "Repo: orchestra",
    "Commit: <code>abc1234</code>"
  ]
}
```

Useful tricks:
- Use `""` in `lines` for a blank line.
- Python and TypeScript clients also accept a single string and split it on `\n`.
- Use simple Telegram HTML like `<b>`, `<i>`, and `<code>`.
- Keep formatting conservative if the same message is meant for both Telegram and Slack.
- Keep each visual chunk as its own line rather than hand-building one large multiline string.
- Send at most one media attachment with the message.

## Python Client

Shared client file:
- [notify_client.py](/home/ubuntu/dev/orchestra/notify/notify_client.py)

Typical sync usage in error handlers:

```python
from notify_client import notify

notify.send(
    "test",
    [
        "<b>Python Client</b>",
        "",
        "line two",
    ],
    severity="warning",
    thread_id="42",
)
```

Async usage:

```python
from notify_client import notify

await notify.send_async(
    "billing",
    [
        "<b>Invoice Settled</b>",
        "",
        "Account: user@example.com",
    ],
)
```

Background fire-and-forget:

```python
from notify_client import notify

notify.send_background(
    "system",
    ["<b>Worker Restarted</b>"],
)
```

`send_background()` is best-effort and never raises transport errors back into the caller.

Fetch recent logs:

```python
from notify_client import notify

logs = notify.fetch_logs(limit=50)
```

Environment variables used by the client:
- `NOTIFY_URL`
- `NOTIFY_API_KEY`
- `NOTIFY_TIMEOUT`

You can also pass `base_url=...` and `api_key=...` explicitly.

Use a notify-prefixed base URL, for example:

```text
https://api.hypercli.com/notify
```

CLI usage:

```bash
python notify_client.py send test "<b>Python CLI</b>" "" "line two" --severity warning
python notify_client.py logs --limit 20
```

## TypeScript Client

Shared client file:
- [notify_client.ts](/home/ubuntu/dev/orchestra/notify/notify_client.ts)

Usage:

```ts
import { notify } from "./notify_client";

await notify.send("test", [
  "<b>Node Client</b>",
  "",
  "line two",
], {
  severity: "error",
  threadId: "84",
});
```

Background fire-and-forget:

```ts
import { notify } from "./notify_client";

notify.sendBackground("system", ["<b>Worker Restarted</b>"]);
```

`sendBackground()` is best-effort and logs failures instead of throwing into the caller.

Fetch recent logs:

```js
const logs = await notify.fetchLogs({ limit: 50 });
```

Environment variables used by the client:
- `NOTIFY_URL`
- `NOTIFY_API_KEY`
- `NOTIFY_TIMEOUT`

CLI usage:

```bash
npx --yes tsx notify_client.ts send test "<b>TypeScript CLI</b>" "" "line two" --severity error
npx --yes tsx notify_client.ts logs --limit 20
```

## Logs

Use the `test` category like any other category:

```text
POST /notify/test
```

If `CHANNELS.test` is configured, it will route there. Otherwise it falls back to `default`.

`GET /logs` returns the most recent accepted or rejected notifications from an in-memory ring buffer.

Properties:
- requires `X-BACKEND-API-KEY`
- default limit is `100`
- max limit is `1000`
- storage is in-memory only
- logs are lost on restart

This endpoint exists for debugging and CI verification, not durable history.

## Provider Config

Telegram runtime env:
- `TELEGRAM_BOT_TOKEN`
- `CHANNELS`

Rules:
- `CHANNELS` must be a JSON object
- `CHANNELS.default` is required
- category routing uses exact match, then `default`

Slack runtime env:
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNELS`
- `SLACK_DEFAULT_CHANNEL`

Rules:
- `SLACK_CHANNELS` may be `{}` if `SLACK_DEFAULT_CHANNEL` is set
- category routing uses exact match from `SLACK_CHANNELS`, then `SLACK_DEFAULT_CHANNEL`
- the bot must already be invited to the target channel

Pulumi config in `pulumi-api-k8s` mirrors that shape:
- `telegram_bot_token`
- `telegram_channels`
- `slack_bot_token`
- `slack_channels`
- `slack_default_channel`

Important:
- runtime env vars use `SCREAMING_SNAKE_CASE`
- Pulumi config keys use `snake_case`

## Deployment Notes

Operational lessons from rollout:
- changing only env vars is not enough; make sure the built notify image actually contains the expected runtime files
- verify the live container filesystem when rollout behavior looks wrong
- for Slack rollout, the simplest checks are:
  - pod logs show `Configuration loaded (telegram=yes, slack=yes)`
  - pod logs show `Slack notifier ready`
  - `/app` inside the container contains `slack_notifier.py`

If a pod has Slack env vars but startup logs only mention Telegram, the image is stale even if the deployment rolled successfully.

## Testing

Local unit tests:

```bash
cd notify
pytest -q tests/test_app.py
```

The Orchestra CI job also boots a local notify server and verifies:
- Python client can send to `/notify/test`
- TypeScript client can send to `/notify/test`
- both entries appear in `/logs`
