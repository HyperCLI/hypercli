"""Main HyperCLI client"""
from .config import get_api_key, get_api_url
from .http import HTTPClient
from .billing import Billing
from .jobs import Jobs
from .user import UserAPI
from .instances import Instances
from .renders import Renders
from .files import Files
from .claw import Claw
from .keys import KeysAPI


class HyperCLI:
    """
    HyperCLI API Client

    Usage:
        from hypercli import HyperCLI

        client = HyperCLI()  # Uses HYPERCLI_API_KEY from env or ~/.hypercli/config
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

    def __init__(self, api_key: str = None, api_url: str = None, claw_api_key: str = None, claw_dev: bool = False):
        self._api_key = api_key or get_api_key()
        if not self._api_key:
            raise ValueError(
                "API key required. Set HYPERCLI_API_KEY env var, "
                "create ~/.hypercli/config, or pass api_key parameter."
            )

        self._api_url = api_url or get_api_url()
        self._http = HTTPClient(self._api_url, self._api_key)

        # API namespaces
        self.billing = Billing(self._http)
        self.jobs = Jobs(self._http)
        self.user = UserAPI(self._http)
        self.instances = Instances(self._http)
        self.renders = Renders(self._http)
        self.files = Files(self._http)
        self.keys = KeysAPI(self._http)
        self.claw = Claw(self._http, claw_api_key=claw_api_key, dev=claw_dev)

    @property
    def api_url(self) -> str:
        return self._api_url
