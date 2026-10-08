#!/usr/bin/env python3
"""Own a unit-test process group, including Linux orphaned fixture descendants.

Usage: python3 tools/run_unit_tests.py [--timeout SECONDS] -- COMMAND [ARGS...]
POSIX only. Inherit output directly: a fixture holding a pipe must not block exit.
This is a standalone supervisor, never an in-process pytest plugin.
"""

import argparse
import ctypes
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

OWNER_ENV = "HYPERCLI_UNIT_SUPERVISED"


def send_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def adopted_children():
    if sys.platform != "linux":
        return []
    return [int(pid) for pid in Path(
        f"/proc/self/task/{os.getpid()}/children"
    ).read_text().split()]


def cleanup(process, first_signal):
    # Complete within Actions' cancellation grace period. Repeated signals are
    # recorded by the handler, not raised through this cleanup. Escalate even
    # when the test leader has exited (pytest-timeout's thread mode uses _exit).
    started = time.monotonic()
    errors = set()

    def report(error):
        message = str(error)
        if message not in errors:
            print(f"unit runner: cleanup: {message}", file=sys.stderr)
            errors.add(message)

    def attempt(operation, fallback=None):
        # Keep trying other cleanup operations after a narrow OS failure. Do
        # not turn a cancellation/test failure into an unrelated traceback.
        try:
            return operation()
        except OSError as error:
            report(error)
            return fallback

    for sig, until in ((first_signal, 0.5), (signal.SIGTERM, 1.5), (signal.SIGKILL, 3.0)):
        attempt(lambda: send_group(process.pid, sig))
        signalled = set()
        while True:
            attempt(process.poll)  # Preserve Popen's leader status.
            for pid in attempt(adopted_children, []):
                if pid != process.pid and pid not in signalled:
                    # These are our unreaped direct children, so their PID cannot
                    # be reused before waitpid. Includes setsid/double-fork peers.
                    try:
                        os.kill(pid, sig)
                    except ProcessLookupError:
                        pass
                    except OSError as error:
                        report(error)
                    signalled.add(pid)
            if process.returncode is not None:
                while True:
                    try:
                        pid, _ = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        break
                    except OSError as error:
                        report(error)
                        break
                    if pid == 0:
                        break
                    signalled.discard(pid)
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    if not attempt(adopted_children, [None]):
                        return not errors
                except OSError as error:
                    report(error)
            if time.monotonic() >= started + until:
                break
            time.sleep(0.02)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=0,
                        help="whole-command deadline; 0 disables (default)")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if not command or not math.isfinite(args.timeout) or args.timeout < 0:
        parser.error("provide a command and a finite nonnegative timeout")
    if os.name != "posix":
        parser.error("unit process supervision requires POSIX (use WSL on Windows)")

    # Package scripts may run beneath a supervised CI shell/npm/Turbo command.
    # Exec in the inherited group: never introduce a competing cleanup deadline.
    if os.environ.get(OWNER_ENV) == "1":
        if args.timeout:
            parser.error("nested deadlines require foreground timeout under the existing owner")
        try:
            os.execvp(command[0], command)
        except OSError as error:
            print(f"unit runner: {error}", file=sys.stderr)
            return 127 if isinstance(error, FileNotFoundError) else 126

    cancelled = 0

    def interrupt(signum, _frame):
        nonlocal cancelled
        if not cancelled:
            cancelled = signum

    # Install before spawning: a signal in Popen must not lose the child handle.
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupt)
    if sys.platform == "linux":
        # As in the native session gate, adopt even descendants that leave the
        # original group. Do not rely on runner/container PID 1 to reap them.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            print("unit runner: cannot enable child subreaper", file=sys.stderr)
            return 125
    if cancelled:
        return 128 + cancelled

    process = None
    status = 125
    first_signal = signal.SIGTERM
    try:
        process = subprocess.Popen(command, start_new_session=True,
                                   env={**os.environ, OWNER_ENV: "1"})
        deadline = time.monotonic() + args.timeout if args.timeout else None
        while True:
            if cancelled:
                status = 128 + cancelled
                first_signal = cancelled
                break
            result = process.poll()
            if result is not None:
                status = result if result >= 0 else 128 - result
                break
            if deadline is not None and time.monotonic() >= deadline:
                print("unit runner: command timed out", file=sys.stderr, flush=True)
                status = 124
                break
            time.sleep(0.02)
    except OSError as error:
        print(f"unit runner: {error}", file=sys.stderr)
        status = 127 if isinstance(error, FileNotFoundError) else 126
    finally:
        if process is not None and not cleanup(process, first_signal):
            print("unit runner: process cleanup incomplete (OS error or 3-second budget)", file=sys.stderr)
            if status == 0:
                status = 125
    return 128 + cancelled if cancelled else status


if __name__ == "__main__":
    sys.exit(main())
