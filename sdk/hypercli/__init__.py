"""HyperCLI SDK - Python client for HyperCLI API"""
from .client import HyperCLI
from .config import (
    configure,
    GHCR_IMAGES,
    COMFYUI_IMAGE,
    DEFAULT_API_URL,
    DEFAULT_WS_URL,
    DEFAULT_AGENTS_API_BASE_URL,
    DEFAULT_AGENTS_WS_URL,
    DEV_AGENTS_API_BASE_URL,
    DEV_AGENTS_WS_URL,
    get_api_url,
    get_ws_url,
    get_agents_api_base_url,
    get_agents_ws_url,
)
from .http import APIError, AsyncHTTPClient
from .instances import GPUType, GPUConfig, Region, GPUPricing, PricingTier
from .jobs import Job, JobMetrics, GPUMetrics, find_job, find_by_id, find_by_hostname, find_by_ip
from .renders import Render, RenderStatus
from .x402 import X402Client, X402JobLaunch, X402FlowCreate, X402RenderCreate, FlowCatalogItem
from .files import File, AsyncFiles
from .job import BaseJob, ComfyUIJob, GradioJob, apply_params, apply_graph_modes, find_node, find_nodes, load_template, graph_to_api, expand_subgraphs, DEFAULT_OBJECT_INFO
from .logs import LogStream, stream_logs, fetch_logs
from .agents import Deployments, Agent, OpenClawAgent, ExecResult, build_openclaw_routes
from .shell import ShellSession, shell_connect
from .agent import HyperAgent, HyperAgentPlan, HyperAgentModel
from .gateway import GatewayClient, GatewayError, ChatEvent
__version__ = "2026.3.18"
__all__ = [
    "HyperCLI",
    "configure",
    "get_api_url",
    "get_ws_url",
    "get_agents_api_base_url",
    "get_agents_ws_url",
    "APIError",
    # Images
    "GHCR_IMAGES",
    "COMFYUI_IMAGE",
    "DEFAULT_API_URL",
    "DEFAULT_WS_URL",
    "DEFAULT_AGENTS_API_BASE_URL",
    "DEFAULT_AGENTS_WS_URL",
    "DEV_AGENTS_API_BASE_URL",
    "DEV_AGENTS_WS_URL",
    # Instance types
    "GPUType",
    "GPUConfig",
    "Region",
    "GPUPricing",
    "PricingTier",
    # Jobs API
    "Job",
    "JobMetrics",
    "GPUMetrics",
    # Renders API
    "Render",
    "RenderStatus",
    # x402 API
    "X402Client",
    "X402JobLaunch",
    "X402FlowCreate",
    "X402RenderCreate",
    "FlowCatalogItem",
    # Files API
    "File",
    "AsyncFiles",
    "AsyncHTTPClient",
    # Job lookup utils
    "find_job",
    "find_by_id",
    "find_by_hostname",
    "find_by_ip",
    # Job helpers
    "BaseJob",
    "ComfyUIJob",
    "GradioJob",
    # Workflow utils
    "apply_params",
    "apply_graph_modes",
    "find_node",
    "find_nodes",
    "load_template",
    "graph_to_api",
    "expand_subgraphs",
    "DEFAULT_OBJECT_INFO",
    # Log streaming
    "LogStream",
    "stream_logs",
    "fetch_logs",
    # Agents (Reef Pods)
    "Deployments",
    "Agent",
    "OpenClawAgent",
    "ExecResult",
    "build_openclaw_routes",
    # Shell
    "ShellSession",
    "shell_connect",
    # HyperAgent
    "HyperAgent",
    "HyperAgentPlan",
    "HyperAgentModel",
    # OpenClaw Gateway
    "GatewayClient",
    "GatewayError",
    "ChatEvent",
]
