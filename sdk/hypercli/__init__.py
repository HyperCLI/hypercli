"""HyperCLI SDK - Python client for HyperCLI API"""
from .client import HyperCLI
from .config import configure, GHCR_IMAGES, COMFYUI_IMAGE
from .http import APIError, AsyncHTTPClient
from .instances import GPUType, GPUConfig, Region, GPUPricing, PricingTier
from .jobs import Job, JobMetrics, GPUMetrics, find_job, find_by_id, find_by_hostname, find_by_ip
from .renders import Render, RenderStatus
from .x402 import X402Client, X402JobLaunch, X402FlowCreate, X402RenderCreate, FlowCatalogItem
from .files import File, AsyncFiles
from .job import BaseJob, ComfyUIJob, GradioJob, apply_params, apply_graph_modes, find_node, find_nodes, load_template, graph_to_api, expand_subgraphs, DEFAULT_OBJECT_INFO
from .logs import LogStream, stream_logs, fetch_logs
from .agents import Agents, ReefPod, ExecResult
from .claw import Claw, ClawKey, ClawPlan, ClawModel
from .gateway import GatewayClient, GatewayError, ChatEvent

__version__ = "0.8.9"
__all__ = [
    "HyperCLI",
    "configure",
    "APIError",
    # Images
    "GHCR_IMAGES",
    "COMFYUI_IMAGE",
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
    "Agents",
    "ReefPod",
    "ExecResult",
    # HyperClaw
    "Claw",
    "ClawKey",
    "ClawPlan",
    "ClawModel",
    # OpenClaw Gateway
    "GatewayClient",
    "GatewayError",
    "ChatEvent",
]
