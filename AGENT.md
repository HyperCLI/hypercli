# AGENT.md (HyperCLI)

Guide for contributors/agents working in `orchestra/hypercli`.

## Packages

- `sdk/` (`hypercli-sdk`): Python client APIs (jobs, flows, x402 helpers, claw)
- `cli/` (`hypercli-cli`): operator UX for jobs/flows/x402/claw
- `docs/`: Mintlify docs source
- `site/`: web properties and marketing/docs site code

## Current CLI Surface

- `hyper instances ...` (GPU discovery + launch, including `--x402` launch)
- `hyper jobs ...` (lifecycle + logs/metrics)
- `hyper flow ...` (recommended media endpoint family, includes `--x402`)
- `hyper claw ...` (HyperClaw checkout/config integration)
- `hyper llm` command removed

## Important Paths

- x402 SDK helper: `sdk/hypercli/x402.py`
- flow CLI: `cli/hypercli_cli/flow.py`
- x402 GPU launch CLI: `cli/hypercli_cli/instances.py`
- docs nav: `docs/docs.json`

## Release Checklist

1. Bump versions in:
   - `sdk/pyproject.toml`
   - `sdk/hypercli/__init__.py`
   - `cli/pyproject.toml`
   - `cli/hypercli_cli/__init__.py`
2. Build both packages:
   - `cd sdk && python3 -m build`
   - `cd cli && python3 -m build`
3. Smoke test x402 GPU launch path (`hyper instances launch ... --x402`).
4. Keep docs aligned with shipped CLI/SDK surfaces.
