from __future__ import annotations

import asyncio
import base64
import uuid

import pytest

from hypercli.http import APIError
from hypercli.openclaw.gateway import GatewayNodePairingRequired
from hypercli.openclaw.node_proxy import EGRESS_COMMANDS, NodeEgressClient, NodeEgressServer


EGRESS_NODE_DISPLAY_NAME = "SDK Node Egress E2E"


def _available_tiers(client) -> list[str]:
    budget = client.deployments.budget()
    slots = (budget or {}).get("slots") or {}
    return [
        tier
        for tier in ("small", "medium", "large")
        if int((slots.get(tier) or {}).get("available") or 0) > 0
    ]


async def _start_http_server(body: bytes):
    seen_paths: list[str] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = await reader.readuntil(b"\r\n\r\n")
        request_line = request.decode("iso-8859-1").split("\r\n", 1)[0]
        _method, path, _version = request_line.split(" ", 2)
        seen_paths.append(path)
        writer.write(
            (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: text/plain\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n"
                "\r\n"
            ).encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, int(server.sockets[0].getsockname()[1]), seen_paths


async def _start_echo_server():
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data.upper())
            await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, int(server.sockets[0].getsockname()[1])


async def _connect_and_pair_node(node: NodeEgressServer, operator) -> str:
    paired_device_id: str | None = None
    for _attempt in range(3):
        try:
            await node.connect()
            return paired_device_id or await _find_node_id(
                operator,
                display_name=EGRESS_NODE_DISPLAY_NAME,
            )
        except GatewayNodePairingRequired as exc:
            paired_device_id = exc.device_id or paired_device_id
            await operator.node_pair_approve(exc.request_id)
            await asyncio.sleep(1)
    await node.connect()
    return paired_device_id or await _find_node_id(
        operator,
        display_name=EGRESS_NODE_DISPLAY_NAME,
    )


async def _find_node_id(operator, *, display_name: str, timeout: float = 30.0) -> str:
    deadline = asyncio.get_running_loop().time() + timeout
    last_nodes: list[dict] = []
    while asyncio.get_running_loop().time() < deadline:
        last_nodes = await operator.nodes_list()
        for node in last_nodes:
            if node.get("displayName") == display_name and node.get("connected") is not False:
                node_id = node.get("nodeId")
                if isinstance(node_id, str) and node_id:
                    return node_id
        await asyncio.sleep(1)
    raise AssertionError(f"egress node did not appear in node.list; last_nodes={last_nodes!r}")


async def _wait_for_declared_commands(operator, node_id: str, timeout: float = 30.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    last_description: dict | None = None
    while asyncio.get_running_loop().time() < deadline:
        try:
            last_description = await operator.node_describe(node_id)
            commands = set(last_description.get("commands") or [])
            if set(EGRESS_COMMANDS).issubset(commands):
                return
        except Exception as exc:
            last_description = {"error": str(exc)}
        await asyncio.sleep(1)
    raise AssertionError(
        "egress node connected without the expected allowlisted commands; "
        f"node_id={node_id!r} last_description={last_description!r}"
    )


@pytest.mark.asyncio
async def test_node_egress_routes_http_and_tcp_through_live_gateway(
    client,
    test_agent_api_key: str,
    tmp_path,
):
    if not test_agent_api_key:
        pytest.skip(
            "TEST_AGENT_API_KEY not set; node egress E2E needs deployment and gateway access"
        )

    tiers = _available_tiers(client)
    if not tiers:
        pytest.skip("No available entitlement slots for node egress E2E")

    agent = None
    operator = None
    node = None
    http_server = None
    echo_server = None
    node_id: str | None = None
    name = f"sdk-node-egress-{uuid.uuid4().hex[:8]}"

    try:
        for tier in tiers:
            try:
                agent = client.deployments.create_openclaw(
                    name=name,
                    size=tier,
                    tags=["team=dev", "suite=sdk-node-egress-e2e"],
                    config={"gateway": {"nodes": {"allowCommands": list(EGRESS_COMMANDS)}}},
                    start=True,
                )
                break
            except APIError as exc:
                if exc.status_code in {429, 503} and tier != tiers[-1]:
                    continue
                raise
        assert agent is not None

        agent = client.deployments.wait_running(agent.id, timeout=360, poll_interval=5)
        agent.wait_for_gateway_context(timeout=180, retry_interval=3)

        operator = agent.gateway(
            device_store_path=str(tmp_path / "operator-device-auth.json"),
            timeout=30,
        )
        await operator.wait_ready(timeout=180, retry_interval=5)
        config = await operator.config_get()
        allow_commands = set(
            ((config.get("gateway") or {}).get("nodes") or {}).get("allowCommands") or []
        )
        assert set(EGRESS_COMMANDS).issubset(allow_commands)
        assert agent.gateway_url is not None

        node = NodeEgressServer(
            agent.gateway_url,
            "sdk-node-egress-e2e",
            gateway_token=agent.gateway_token,
            display_name=EGRESS_NODE_DISPLAY_NAME,
            allow_private_network=True,
            device_store_path=str(tmp_path / "node-device-auth.json"),
            timeout=30,
        )
        node_id = await _connect_and_pair_node(node, operator)
        await _wait_for_declared_commands(operator, node_id)

        egress = NodeEgressClient(operator, node_id=node_id, invoke_timeout_ms=30_000)

        http_body = b"node-egress-http-ok"
        http_server, http_port, seen_paths = await _start_http_server(http_body)
        response = await egress.http_fetch(
            f"http://127.0.0.1:{http_port}/egress-route-check",
            max_bytes=1024,
        )
        decoded_body = b"".join(
            base64.b64decode(chunk) for chunk in response["bodyBase64Chunks"]
        )
        assert response["status"] == 200
        assert decoded_body == http_body
        assert seen_paths == ["/egress-route-check"]

        echo_server, echo_port = await _start_echo_server()
        conn_id = await egress.tcp_open("127.0.0.1", echo_port)
        try:
            assert await egress.tcp_write(conn_id, b"node-egress-tcp-ok") == 18
            data, closed = await egress.tcp_read(conn_id, max_bytes=18, wait_ms=1000)
            assert data == b"NODE-EGRESS-TCP-OK"
            assert closed is False
        finally:
            await egress.tcp_close(conn_id)
    finally:
        if http_server is not None:
            http_server.close()
            await http_server.wait_closed()
        if echo_server is not None:
            echo_server.close()
            await echo_server.wait_closed()
        if node is not None:
            await node.close()
        if operator is not None:
            if node_id:
                try:
                    await operator.node_pair_remove(node_id)
                except Exception:
                    pass
            await operator.close()
        if agent is not None:
            try:
                client.deployments.delete(agent.id)
            except Exception:
                pass
