#!/usr/bin/env bash
# Python SDK + py-cli unit gate inside the SDK CI image.
set -euo pipefail

cd /opt
pytest --import-mode=importlib -q \
  sdk/tests/test_bootstrap_dev_test_keys.py \
  sdk/tests/test_bootstrap_console_test_key.py \
  sdk/tests/test_bootstrap_agents_e2e_user.py \
  sdk/tests/test_jobs.py \
  sdk/tests/test_agents.py \
  sdk/tests/test_hermes.py \
  sdk/tests/test_coding_agents.py \
  sdk/tests/test_gateway.py \
  sdk/tests/test_keys.py \
  sdk/tests/test_node_proxy.py \
  sdk/tests/test_workspaces.py \
  sdk/tests/test_exec_shell_dryrun.py \
  sdk/tests/test_repository_integrity.py \
  py-cli/tests/test_llm_command.py \
  py-cli/tests/test_jobs_list_tags.py \
  py-cli/tests/test_workspaces_command.py \
  py-cli/tests/test_exec_shell_dryrun.py
