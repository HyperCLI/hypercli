#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


PROVIDER_PATH = Path("/opt/hermes/plugins/memory/mem0/__init__.py")

HELPERS_ANCHOR = '_DEFAULT_USER_ID = "hermes-user"'

HELPERS_BLOCK = '_DEFAULT_USER_ID = "hermes-user"' + """

# --- HyperCLI: process-shared OSS backend ----------------------------------
# Each ACP session builds a fresh AIAgent (acp_adapter/session.py
# _make_agent), which loads a fresh Mem0MemoryProvider and calls initialize()
# while an earlier session's provider may still be alive (agents are kept for
# session resume). An OSSBackend holds the qdrant local storage lock
# (_backend.py: Memory.from_config), so a second backend on the same path
# dies with "Storage folder ... is already accessed by another instance of
# Qdrant client" and every mem0 tool on the new session degrades to
# "backend not initialized". OSS mode therefore shares one backend
# process-wide, keyed by the resolved OSS config; add()/search() scope
# (user_id/agent_id) is passed per call, so sharing the store across
# providers is safe. Refcounted: close() runs when the last provider owning
# the shared instance releases it.
_OSS_SHARED_BACKENDS: dict = {}
_OSS_SHARED_LOCK = threading.Lock()


def _acquire_oss_backend(oss_config: dict):
    from ._backend import OSSBackend

    key = json.dumps(oss_config, sort_keys=True, default=str)
    with _OSS_SHARED_LOCK:
        shared = _OSS_SHARED_BACKENDS.get(key)
        if shared is not None:
            backend, refcount = shared
            _OSS_SHARED_BACKENDS[key] = (backend, refcount + 1)
            return backend
        backend = OSSBackend(oss_config)
        _OSS_SHARED_BACKENDS[key] = (backend, 1)
        return backend


def _release_oss_backend(backend) -> None:
    close = False
    with _OSS_SHARED_LOCK:
        for key, (shared, refcount) in list(_OSS_SHARED_BACKENDS.items()):
            if shared is not backend:
                continue
            if refcount > 1:
                _OSS_SHARED_BACKENDS[key] = (shared, refcount - 1)
            else:
                del _OSS_SHARED_BACKENDS[key]
                close = True
            break
        else:
            close = True
    if close:
        backend.close()
"""

CREATE_NEEDLE = """            if self._mode == "oss":
                from ._backend import OSSBackend
                return OSSBackend(self._config.get("oss", {}))
"""
CREATE_REPLACEMENT = """            if self._mode == "oss":
                return _acquire_oss_backend(self._config.get("oss", {}))
"""

SHUTDOWN_NEEDLE = """    def _shutdown_backend(self):
        try:
            if self._backend:
                self._backend.close()
                self._backend = None
        except Exception:
            pass
"""
SHUTDOWN_REPLACEMENT = """    def _shutdown_backend(self):
        try:
            if self._backend:
                if self._mode == "oss":
                    _release_oss_backend(self._backend)
                else:
                    self._backend.close()
                self._backend = None
        except Exception:
            pass
"""


def replace_once(text: str, needle: str, replacement: str) -> str:
    if text.count(needle) != 1:
        raise SystemExit(f"could not locate expected block in {PROVIDER_PATH}: {needle!r}")
    return text.replace(needle, replacement)


def main() -> None:
    text = PROVIDER_PATH.read_text(encoding="utf-8")
    if "_acquire_oss_backend" in text:
        return

    text = replace_once(text, HELPERS_ANCHOR, HELPERS_BLOCK)
    text = replace_once(text, CREATE_NEEDLE, CREATE_REPLACEMENT)
    text = replace_once(text, SHUTDOWN_NEEDLE, SHUTDOWN_REPLACEMENT)

    PROVIDER_PATH.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
