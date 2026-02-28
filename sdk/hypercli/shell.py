"""Interactive shell over WebSocket for running job containers.

SDK-level: async WebSocket client that connects to the director's
/orchestra/ws/shell/{job_id}?token={job_key} endpoint.

Protocol (text frames):
  Client → Server:  raw stdin text, or xterm resize "\x1b[8;{rows};{cols}t"
  Server → Client:  raw stdout/stderr text
"""
import asyncio
from typing import TYPE_CHECKING, Callable, Optional

import websockets

from .config import get_ws_url

if TYPE_CHECKING:
    from .client import HyperCLI

WS_SHELL_PATH = "/orchestra/ws/shell"


async def shell_connect(
    client: "HyperCLI",
    job_id: str,
    job_key: str = None,
    shell: str = "/bin/bash",
    on_output: Callable[[str], None] = None,
    on_close: Callable[[str], None] = None,
) -> "ShellSession":
    """Connect to a running job's shell via WebSocket.

    Args:
        client: HyperCLI client instance
        job_id: Job ID
        job_key: Job key for auth (fetched if None)
        shell: Shell executable (default: /bin/bash)
        on_output: Callback for output data
        on_close: Callback when shell closes (receives reason string)

    Returns:
        ShellSession object for sending input and managing the connection.
    """
    if not job_key:
        job = client.jobs.get(job_id)
        job_key = job.job_key

    ws_url = get_ws_url()
    url = f"{ws_url}{WS_SHELL_PATH}/{job_id}?token={job_key}&shell={shell}"

    ws = await websockets.connect(
        url,
        ping_interval=30,
        ping_timeout=20,
        close_timeout=5,
        max_size=2**20,
        compression=None,
    )

    session = ShellSession(ws, on_output=on_output, on_close=on_close)
    session._reader_task = asyncio.create_task(session._read_loop())
    return session


class ShellSession:
    """Async WebSocket shell session."""

    def __init__(
        self,
        ws,
        on_output: Callable[[str], None] = None,
        on_close: Callable[[str], None] = None,
    ):
        self._ws = ws
        self._on_output = on_output
        self._on_close = on_close
        self._reader_task: Optional[asyncio.Task] = None
        self._closed = False

    async def send(self, data: str):
        """Send stdin data to the shell."""
        if not self._closed:
            await self._ws.send(data)

    async def resize(self, cols: int, rows: int):
        """Send terminal resize."""
        if not self._closed:
            await self._ws.send(f"\x1b[8;{rows};{cols}t")

    async def close(self):
        """Close the shell session."""
        self._closed = True
        if self._reader_task:
            self._reader_task.cancel()
        try:
            await self._ws.close()
        except Exception:
            pass

    async def _read_loop(self):
        """Read output from WebSocket and dispatch to callback."""
        try:
            async for message in self._ws:
                if self._closed:
                    break
                if isinstance(message, bytes):
                    message = message.decode(errors="replace")
                if self._on_output:
                    self._on_output(message)
        except websockets.ConnectionClosed as e:
            reason = e.reason or f"code {e.code}"
            if self._on_close and not self._closed:
                self._on_close(reason)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if self._on_close and not self._closed:
                self._on_close(str(e))
        finally:
            self._closed = True

    @property
    def closed(self) -> bool:
        return self._closed
