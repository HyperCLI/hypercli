from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path


BUZZ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUZZ_DIR))

from testlib import (  # noqa: E402
    assert_auth_methods,
    assert_common_contract,
    assert_models,
    assert_runtime_auth_wrapper,
    assert_user_config_preserved,
    require_image_argument,
    run,
)


image = require_image_argument()
assert_common_contract(
    image,
    runtime="kimi-code",
    agent_command="/opt/hypercli/bin/kimi",
    agent_args="acp",
    entrypoint="/opt/hypercli/bin/kimi-entrypoint",
)
assert_auth_methods(
    image,
    agent_command="/opt/hypercli/bin/kimi",
    agent_args="acp",
    expected={"login"},
    terminal={"login"},
)
assert_runtime_auth_wrapper(
    image,
    runtime_command="/usr/local/bin/hypercli-kimi-auth",
)
run(image, ["kimi", "login", "--help"])
wrapper_status = run(image, ["hypercli-runtime-auth", "status"], check=False)
assert wrapper_status.returncode == 0
assert json.loads(wrapper_status.stdout) == {
    "runtime": "kimi-code",
    "authenticated": False,
}
run(image, ["hypercli-runtime-auth", "login", "--help"])
runtime_env = {
    "BUZZ_ACP_MODEL": "runtime-model",
    "HYPER_API_BASE": "https://api.dev.hypercli.com/",
    "HYPER_AGENTS_API_KEY": "runtime-secret",
}
configured = run(
    image,
    [
        "python3",
        "-c",
        """
from pathlib import Path

config = Path('/home/node/.kimi-code/config.toml')
assert not config.exists()
""",
    ],
    env=runtime_env,
)
assert configured.returncode == 0
with tempfile.TemporaryDirectory() as home_name:
    home = Path(home_name)
    home.chmod(0o777)
    credentials = home / ".kimi-code/credentials"
    credentials.mkdir(parents=True)
    credential = credentials / "kimi-code.json"
    credential.write_text(
        json.dumps(
            {
                "access_token": "credential-probe-token",
                "refresh_token": "credential-probe-refresh",
                "expires_at": 4_102_444_800,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    credential.chmod(0o600)
    mounted_status = run(
        image,
        ["hypercli-runtime-auth", "status"],
        mounts=[(home, "/home/node")],
    )
    assert json.loads(mounted_status.stdout) == {
        "runtime": "kimi-code",
        "authenticated": True,
    }
    assert "credential-probe" not in mounted_status.stdout

    credential.chmod(0o644)
    insecure_status = run(
        image,
        ["hypercli-runtime-auth", "status"],
        mounts=[(home, "/home/node")],
    )
    assert json.loads(insecure_status.stdout)["authenticated"] is False

    credential.write_text('{"access_token":""}\n', encoding="utf-8")
    credential.chmod(0o600)
    empty_status = run(
        image,
        ["hypercli-runtime-auth", "status"],
        mounts=[(home, "/home/node")],
    )
    assert json.loads(empty_status.stdout)["authenticated"] is False

    credential.write_text("not-json\n", encoding="utf-8")
    credential.chmod(0o600)
    corrupt_status = run(
        image,
        ["hypercli-runtime-auth", "status"],
        mounts=[(home, "/home/node")],
    )
    assert json.loads(corrupt_status.stdout)["authenticated"] is False

run(image, ["kimi", "doctor"], env=runtime_env)
with tempfile.TemporaryDirectory() as home_name:
    home = Path(home_name)
    home.chmod(0o777)
    credentials = home / ".kimi-code/credentials"
    credentials.mkdir(parents=True)
    credential = credentials / "kimi-code.json"
    credential.write_text(
        json.dumps(
            {
                "access_token": "runtime-model-token",
                "refresh_token": "runtime-model-refresh",
                "expires_at": 4_102_444_800,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    credential.chmod(0o600)
    assert_models(
        image,
        agent_command="/opt/hypercli/bin/kimi",
        agent_args="acp",
        env={**runtime_env, "HYPERCLI_RUNTIME_INFERENCE": "hypercli"},
        mounts=[(home, "/home/node")],
    )
assert_user_config_preserved(
    image,
    relative_path=".kimi-code/tui.toml",
    generated_contains="auto_install = false",
    user_content="[upgrade]\nauto_install = true\n",
)

print(f"{image}: Kimi Code contract passed")
