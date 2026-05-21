"""Runtime compatibility helpers for third-party dependencies."""

import collections
from collections import abc as collections_abc


def ensure_collections_compat() -> None:
    """Restore removed ``collections`` ABC aliases for older dependencies."""
    for name in ("Mapping", "MutableMapping", "Sequence", "MutableSet"):
        if not hasattr(collections, name):
            setattr(collections, name, getattr(collections_abc, name))
