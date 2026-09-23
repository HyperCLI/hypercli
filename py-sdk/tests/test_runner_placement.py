from unittest.mock import Mock

from hypercli.agents import Deployments


def test_coding_create_forwards_runner_and_canonical_executable():
    deployments = Deployments(Mock(), api_key="test", api_base="https://example.test")
    target = {"tags": ["linux"], "runner_id": "13a51b38-9f25-4867-83fc-5839b15a17ba"}
    deployments._post = Mock(return_value={
        "id": "runner-agent", "state": "STARTING", "runtime": "opencode",
        "runner": target,
    })

    agent = deployments.create_opencode(runner=target)

    body = deployments._post.call_args.kwargs["json"]
    assert body["runner"] == target
    assert body["command"] == ["/usr/local/bin/hyper-acp"]
    assert agent.runner == target
