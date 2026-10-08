"""CI regression tests for unit-runner cancellation (no application services)."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


RUNNER = Path(__file__).with_name("run_unit_tests.py")
# These tests deliberately launch independent supervisors beneath the CI owner.
RUNNER_ENV = {key: value for key, value in os.environ.items()
              if key != "HYPERCLI_UNIT_SUPERVISED"}


@unittest.skipUnless(os.name == "posix", "POSIX process groups")
class UnitSupervisorTests(unittest.TestCase):
    def test_preserves_command_status(self):
        for status in (0, 7, 124):
            with self.subTest(status=status):
                result = subprocess.run(
                    [sys.executable, str(RUNNER), "--", sys.executable,
                     "-c", f"raise SystemExit({status})"], timeout=8, env=RUNNER_ENV,
                )
                self.assertEqual(result.returncode, status)

    def test_signal_exit_is_nonzero(self):
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--", sys.executable, "-c",
             "import os, signal; os.kill(os.getpid(), signal.SIGTERM)"], timeout=8, env=RUNNER_ENV,
        )
        self.assertEqual(result.returncode, 143)

    def test_nested_wrapper_execs_in_the_existing_group(self):
        code = "import os; assert os.getpid() != os.getpgrp()"
        # The outer command is a shell: the nested wrapper must stay in its
        # group, rather than becoming another session leader/cleanup owner.
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--", "sh", "-c",
             '"$@" & wait "$!"', "unit-nesting", sys.executable, str(RUNNER),
             "--", sys.executable, "-c", code], timeout=8, env=RUNNER_ENV,
        )
        self.assertEqual(result.returncode, 0)

    def test_cleanup_os_errors_do_not_replace_test_status(self):
        for operation in ("adopted_children", "send_group"):
            for status in (0, 7):
                with self.subTest(operation=operation, status=status):
                    code = (
                        "import runpy, sys\n"
                        f"gate = runpy.run_path({str(RUNNER)!r})\n"
                        "def denied(*args): raise PermissionError('cleanup-denied')\n"
                        f"gate['main'].__globals__[{operation!r}] = denied\n"
                        f"sys.argv = [{str(RUNNER)!r}, '--', sys.executable, '-c', "
                        f"'raise SystemExit({status})']\n"
                        "sys.exit(gate['main']())\n"
                    )
                    result = subprocess.run(
                        [sys.executable, "-c", code], env=RUNNER_ENV,
                        capture_output=True, text=True, timeout=8,
                    )
                    self.assertEqual(result.returncode, status or 125, result.stderr)
                    self.assertIn("cleanup-denied", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)

    @unittest.skipUnless(sys.platform == "linux", "Linux adoption and zombie reaping")
    def test_cancellation_timeout_and_abrupt_exit_reap_fixture_tree(self):
        # A detached grandchild ignores graceful signals and holds stdout open.
        # A successful return from communicate therefore also proves that the
        # supervisor did not leave a fixture retaining the output pipe.
        for mode, expected in (("int", 130), ("term", 143), ("timeout", 124),
                               ("exit", 7), ("success", 0)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                ready = Path(temp) / "fixture.pid"
                leaf = (
                    "import os, signal, time; from pathlib import Path; "
                    "signal.signal(signal.SIGINT, signal.SIG_IGN); "
                    "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                    f"Path({str(ready)!r}).write_text(str(os.getpid())); "
                    "time.sleep(60)"
                )
                parent = (
                    "import os, subprocess, sys, time; from pathlib import Path\n"
                    f"subprocess.Popen([sys.executable, '-c', {leaf!r}], start_new_session=True)\n"
                    f"while not Path({str(ready)!r}).exists(): time.sleep(0.01)\n"
                    + (f"os._exit({expected})\n" if mode in ("exit", "success")
                       else "time.sleep(60)\n")
                )
                command = [sys.executable, str(RUNNER)]
                if mode == "timeout":
                    command += ["--timeout", "1"]
                command += ["--", sys.executable, "-c", parent]
                process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, env=RUNNER_ENV)
                fixture_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while not ready.exists() or not ready.read_text():
                        if time.monotonic() >= deadline or process.poll() is not None:
                            self.fail("fixture did not become ready")
                        time.sleep(0.01)
                    fixture_pid = int(ready.read_text())
                    if mode in ("int", "term"):
                        sig = signal.SIGINT if mode == "int" else signal.SIGTERM
                        process.send_signal(sig)
                        time.sleep(0.1)
                        if process.poll() is None:
                            process.send_signal(sig)  # Must not interrupt reaping.
                    _, stderr = process.communicate(timeout=8)
                    self.assertEqual(process.returncode, expected, stderr.decode())
                    self.assertFalse(Path(f"/proc/{fixture_pid}").exists(),
                                     "fixture is still running or an unreaped zombie")
                    fixture_pid = None
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                    if fixture_pid is not None:
                        try:
                            os.kill(fixture_pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
