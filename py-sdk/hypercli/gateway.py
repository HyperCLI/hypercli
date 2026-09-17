"""Backward-compatible module alias for OpenClaw gateway surfaces."""

import sys

from .openclaw import gateway as _gateway

sys.modules[__name__] = _gateway
