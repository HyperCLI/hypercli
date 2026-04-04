"""Main HyperCLI client"""
from .config import (
    get_agent_api_key,
    get_agents_api_base_url,
    get_agents_api_base_url_from_product_base,
    get_agents_ws_url,
    get_agents_ws_url_from_product_base,
    get_api_key,
    get_api_url,
)
from .http import HTTPClient
from .billing import Billing
from .jobs import Jobs
from .user import UserAPI
from .instances import Instances
from .renders import Renders
from .files import Files
from .agents import Deployments
from .agent import HyperAgent
from .keys import KeysAPI


def _derive_agents_api_base(api_url: str, agent_dev: bool) -> str:
    return get_agents_api_base_url(agent_dev) if agent_dev else get_agents_api_base_url_from_product_base(api_url)


def _derive_agents_ws_url(api_url: str, agent_dev: bool) -> str:
    return get_agents_ws_url(agent_dev) if agent_dev else get_agents_ws_url_from_product_base(api_url)


class HyperCLI:
    """
    HyperCLI API Client

    Usage:
        from hypercli import HyperCLI

        client = HyperCLI()  # Uses HYPER_API_KEY from env or ~/.hypercli/config
        # or
        client = HyperCLI(api_key="your_key")

        # Billing
        balance = client.billing.balance()
        print(f"Balance: ${balance.total}")

        # Jobs
        job = client.jobs.create(
            image="nvidia/cuda:12.0",
            gpu_type="l40s",
            command="python train.py"
        )
        print(f"Job: {job.job_id}")

        # User
        user = client.user.get()
    """

    def __init__(
        self,
        api_key: str = None,
        api_url: str = None,
        agent_api_key: str = None,
        agent_dev: bool = False,
        agents_api_base_url: str = None,
        agents_ws_url: str = None,
    ):
        resolved_product_api_key = api_key or get_api_key()
        resolved_agent_api_key = agent_api_key or get_agent_api_key()
        self._api_key = resolved_product_api_key or resolved_agent_api_key
        if not self._api_key:
            raise ValueError(
                "API key required. Set HYPER_API_KEY/HYPERCLI_API_KEY or "
                "HYPER_AGENTS_API_KEY, create ~/.hypercli/config, or pass api_key parameter."
            )

        self._api_url = api_url or get_api_url()
        self._http = HTTPClient(self._api_url, self._api_key)

        # API namespaces
        resolved_agents_api_base = (
            agents_api_base_url
            or (_derive_agents_api_base(self._api_url, agent_dev) if api_url else get_agents_api_base_url(agent_dev))
        )
        resolved_agents_ws_url = (
            agents_ws_url
            or (_derive_agents_ws_url(self._api_url, agent_dev) if api_url else get_agents_ws_url(agent_dev))
        )
        auth_http = HTTPClient(resolved_agents_api_base, self._api_key)
        self.deployments = Deployments(
            self._http,
            api_key=resolved_agent_api_key,
            api_base=resolved_agents_api_base,
            agents_ws_url=resolved_agents_ws_url,
        )
        self.billing = Billing(self._http)
        self.jobs = Jobs(self._http)
        self.user = UserAPI(self._http, auth_http=auth_http)
        self.instances = Instances(self._http)
        self.renders = Renders(self._http)
        self.files = Files(self._http)
        self.keys = KeysAPI(self._http)
        self.agent = HyperAgent(
            self._http,
            agent_api_key=resolved_agent_api_key,
            dev=agent_dev,
            agents_api_base_url=resolved_agents_api_base,
        )

    @property
    def api_url(self) -> str:
        return self._api_url

    @property
    def api_key(self) -> str:
        return self._api_key
