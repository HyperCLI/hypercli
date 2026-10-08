# Interruptible unit tests

`run_unit_tests.py` is the shared **test-only** POSIX supervisor. Python 3 is
required, including for npm test scripts. It lives in the public checkout so
SDK/CLI tests work without the private mono checkout. The CLI CI image copies
it to `/opt/tools` and installs Python.
The npm scripts use POSIX `exec` and checkout-relative helper paths: a package-only
copy/npm tarball does not include the sibling `tools/` directory. Mono packages
require the initialized, matching `hypercli` submodule. Native Windows shells are
not supported; use WSL. Python must already be provisioned on the runner; the
Dockerfile installation is image-build-time, not a per-job host package install.

For a direct pytest, unittest, Vitest, or Cargo invocation, use:

```sh
python3 tools/run_unit_tests.py -- python3 -m pytest py-sdk/tests
python3 tools/run_unit_tests.py -- cargo test --manifest-path rs-sdk/Cargo.toml
python3 tools/run_unit_tests.py --timeout 150 -- COMMAND ARGUMENTS
```

Paths above are relative to `hypercli/`. In the mono root use
`hypercli/tools/run_unit_tests.py`; arguments and the caller's working directory
are otherwise unchanged. Bare framework commands bypass the supervisor.

## Entrypoint inventory and wiring

- Mono `agents/scripts/run_unit_tests.sh`: protocol, backend and ten shards,
  lagoon/reef and four shards, S3 proxy, routines, and the separately scheduled
  runner group. `--list` remains a dependency-free inventory. One supervisor owns
  the whole loop; GNU `timeout --foreground` keeps each file in that owned group.
  The 150-second file limit, 10-second timeout kill grace and pytest's 60-second
  thread timeout are retained. A file failure stops the loop and triggers cleanup;
  leftover children after successful files are cleaned up when the launcher exits.
  This shell launcher still requires GNU `timeout` (also on macOS).
- Mono agents CI: separate integrations/notify unit invocations, backend
  admission repro, selected ACP Rust regressions, and native runner unit command.
  Containerized provider/ACP tests use Docker init and exec so cancellation reaches
  the container, whose PID namespace also contains detached descendants.
  Docker's `--stop-timeout 3` configures the grace period for a Docker stop
  operation; it does not bound signals forwarded by an attached `docker run`.
  These container steps do not have the Python supervisor's cleanup deadline.
- App `npm test`, `npm run test:packaging`, and CI's Rust and offline pipeline
  tests. The multi-command frontend CI step is itself supervised so cancellation
  sent only to the Actions step process does not wait on a foreground shell.
- SDK/CLI `npm test`, SDK `test:files`; public CI's Python SDK/CLI,
  Rust SDK, selected CLI files, and the mounted CLI unit gate scripts.
- Site root test/coverage orchestration, console/shared-ui tests, ts-wallet,
  Slack relay, and the consolidated Slack offline-contract launcher.
- Parent/public release-version unittest jobs also run the supervisor regression
  tests in `tools/test_run_unit_tests.py`.

`agents/tests/run_tests.sh` mixes deployed/integration tests and credential setup;
`agents/lagoon/run_tests.sh` starts a Docker-backed security integration. They are
not unit launchers. E2E/smoke launchers, the specialized native session verdict
gate, separately owned `gpus/`/`admin/`, and service submodules are not rewired.

## Cancellation and limits

- There is one cleanup owner per command tree. It sets the internal inherited
  `HYPERCLI_UNIT_SUPERVISED=1` marker; nested package wrappers exec their command
  in the existing group instead of creating another supervisor/session. Do not
  set this marker manually or carry it into an independent invocation. Nested
  `--timeout` is rejected; shell launchers use foreground GNU timeout instead.
- App CI and npm/Turbo orchestration can contain package wrappers, but those
  wrappers introduce no competing cleanup timers on either Linux or macOS.
  Turbo's test tasks explicitly pass through the ownership marker in strict
  environment mode; build/dev tasks are unchanged.
- The command gets its own session/process group; SIGINT, SIGTERM and SIGHUP
  received by the supervisor produce status `128 + signal` (130/143/129).
  The first signal is forwarded during cleanup, then TERM and KILL escalate
  within a three-second cleanup budget. Repeated signals cannot skip cleanup.
- The leader is reaped using `Popen`. On Linux a child subreaper adopts orphaned
  descendants, including fixture/server processes using `setsid` or double fork;
  adopted children are signalled and reaped until none remain. Cleanup also runs
  on success and failure, rather than assuming an exited leader means no children.
- The supervisor's deadline expiry returns 124. Foreground GNU timeout retains
  its own statuses (124 on timeout, 137 if its KILL escalation is needed).
  Ordinary nonzero results and cancellation statuses are retained even if cleanup
  hits an OS error. Errors are diagnosed and remaining cleanup operations are
  attempted; incomplete cleanup changes an otherwise successful result to 125.
  No output capture or pipe-EOF wait is used by the supervisor.
- On macOS/other POSIX systems only the original process group and direct child
  are owned: there is no Linux subreaper. Fixtures that detach into a new session
  must clean themselves up; use Linux CI for the full detached-tree guarantee.
  Native Windows is unsupported; use WSL. The supervisor cannot run cleanup if
  it itself receives SIGKILL, the host dies, or the kernel cannot terminate a
  process in uninterruptible I/O. Remote resources and Docker daemon workloads
  created by arbitrary tests still require their fixture-specific teardown.
- Runtime validation belongs to CI. The change was inspected statically only;
  the regression tests were added but not executed locally.
