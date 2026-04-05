from __future__ import annotations

"""Renders API"""
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, List

if TYPE_CHECKING:
    from .http import HTTPClient
from .http import APIError


@dataclass
class Render:
    render_id: str
    state: str
    template: str | None = None
    render_type: str | None = None
    tags: list[str] | None = None
    result_url: str | None = None
    error: str | None = None
    created_at: float | None = None
    started_at: float | None = None
    completed_at: float | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Render":
        return cls(
            render_id=data.get("id") or data.get("render_id", ""),
            state=data.get("state", ""),
            template=data.get("template") or data.get("meta", {}).get("template"),
            render_type=data.get("type") or data.get("render_type"),
            tags=list(data.get("tags") or []),
            result_url=data.get("result_url"),
            error=data.get("error"),
            created_at=data.get("created_at"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )


@dataclass
class RenderStatus:
    render_id: str
    state: str
    progress: float | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "RenderStatus":
        return cls(
            render_id=data.get("id") or data.get("render_id", ""),
            state=data.get("state", ""),
            progress=data.get("progress"),
        )


class Renders:
    """Renders API wrapper"""

    def __init__(self, http: "HTTPClient", auth_http: "HTTPClient" | None = None):
        self._http = http
        self._auth_http = auth_http or http
        self._auth_me_cache: dict[str, Any] | None = None

    def _auth_me(self) -> dict[str, Any]:
        if self._auth_me_cache is None:
            self._auth_me_cache = self._auth_http.get("/auth/me")
        return self._auth_me_cache

    def _supports_subscription_family(self, family: str, resource: str | None = None) -> bool:
        try:
            auth_me = self._auth_me()
        except APIError:
            return False
        if not auth_me.get("has_active_subscription"):
            return False
        if auth_me.get("auth_type") == "user":
            return True
        capabilities = set(auth_me.get("capabilities") or [])
        if f"{family}:*" in capabilities:
            return True
        if resource and f"{family}:{resource}" in capabilities:
            return True
        return False

    def _post_flow(self, flow_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        primary = f"/agents/flow/{flow_type}" if self._supports_subscription_family("renders", flow_type) else f"/api/flow/{flow_type}"
        try:
            return self._http.post(primary, json=payload)
        except APIError as exc:
            if primary.startswith("/agents/flow/") and exc.status_code in {403, 404}:
                return self._http.post(f"/api/flow/{flow_type}", json=payload)
            raise

    def _get_render(self, render_id: str, *, status: bool = False) -> dict[str, Any]:
        suffix = "/status" if status else ""
        primary = f"/agents/flow/renders/{render_id}{suffix}" if self._supports_subscription_family("renders") else f"/api/renders/{render_id}{suffix}"
        try:
            return self._http.get(primary)
        except APIError as exc:
            if primary.startswith("/agents/flow/") and exc.status_code in {403, 404}:
                return self._http.get(f"/api/renders/{render_id}{suffix}")
            raise

    def _delete_render(self, render_id: str) -> dict:
        primary = f"/agents/flow/renders/{render_id}" if self._supports_subscription_family("renders") else f"/api/renders/{render_id}"
        try:
            return self._http.delete(primary)
        except APIError as exc:
            if primary.startswith("/agents/flow/") and exc.status_code in {403, 404}:
                return self._http.delete(f"/api/renders/{render_id}")
            raise

    def list(
        self,
        state: str = None,
        template: str = None,
        type: str = None,
        tags: list[str] | None = None,
    ) -> list[Render]:
        """List all renders.

        Args:
            state: Filter by state (e.g., "pending", "running", "completed")
            template: Filter by template name
            type: Filter by render type (e.g., "comfyui")
        """
        params = {}
        if state:
            params["state"] = state
        if template:
            params["template"] = template
        if type:
            params["type"] = type
        if tags:
            params["tag"] = list(tags)

        data = self._http.get("/api/renders", params=params or None)
        # Handle paginated response
        items = data.get("items", data) if isinstance(data, dict) else data
        return [Render.from_dict(r) for r in items]

    def get(self, render_id: str) -> Render:
        """Get render details"""
        data = self._get_render(render_id)
        return Render.from_dict(data)

    def create(
        self,
        params: dict,
        render_type: str = "comfyui",
        notify_url: str = None,
        tags: list[str] | None = None,
    ) -> Render:
        """Create a new render.

        Args:
            params: Render parameters (workflow-specific)
            render_type: Type of render (default: "comfyui")
            notify_url: Optional webhook URL for completion notification
        """
        payload = {
            "type": render_type,
            "params": params,
        }
        if notify_url:
            payload["notify_url"] = notify_url
        if tags:
            payload["tags"] = list(tags)

        data = self._http.post("/api/renders", json=payload)
        return Render.from_dict(data)

    def cancel(self, render_id: str) -> dict:
        """Cancel a render"""
        return self._delete_render(render_id)

    def status(self, render_id: str) -> RenderStatus:
        """Get render status (lightweight polling endpoint)"""
        data = self._get_render(render_id, status=True)
        return RenderStatus.from_dict(data)

    # =========================================================================
    # Flow endpoints - simplified interfaces
    # =========================================================================

    def create_flow(self, flow_type: str, **kwargs) -> Render:
        """Create a flow render via subscription flow when available, otherwise paid flow."""
        payload = {k: v for k, v in kwargs.items() if v is not None}
        data = self._post_flow(flow_type, payload)
        return Render.from_dict(data)

    def text_to_image(
        self,
        prompt: str,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate an image using Qwen-Image (great for text in images).

        Args:
            prompt: Text description of the image
            negative: Optional negative prompt (things to avoid)
            width: Optional output width
            height: Optional output height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.text_to_image("a cat wearing sunglasses")
        """
        return self.create_flow("text-to-image", prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url)

    def text_to_image_hidream(
        self,
        prompt: str,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate an image using HiDream I1 Full (highest quality).

        Args:
            prompt: Text description of the image
            negative: Optional negative prompt (things to avoid)
            width: Optional output width
            height: Optional output height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.text_to_image_hidream("a mystical forest")
        """
        return self.create_flow("text-to-image-hidream", prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url)

    def text_to_video(
        self,
        prompt: str,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate a video using Wan 2.2 14B.

        Args:
            prompt: Text description of the video
            negative: Optional negative prompt (things to avoid)
            width: Optional video width
            height: Optional video height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.text_to_video("a cat walking through a garden")
        """
        return self.create_flow("text-to-video", prompt=prompt, negative=negative, width=width, height=height, notify_url=notify_url)

    def image_to_video(
        self,
        prompt: str,
        image_url: str = None,
        file_ids: List[str] = None,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Animate an image using Wan 2.2 Animate.

        Args:
            prompt: Description of the motion/animation
            image_url: URL of the image to animate
            file_ids: Pre-uploaded file IDs [image_id]
            negative: Optional negative prompt (things to avoid)
            width: Optional video width
            height: Optional video height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.image_to_video("dancing", image_url="https://example.com/img.png")
        """
        return self.create_flow("image-to-video", prompt=prompt, image_url=image_url, file_ids=file_ids, negative=negative, width=width, height=height, notify_url=notify_url)

    def speaking_video(
        self,
        prompt: str,
        image_url: str = None,
        audio_url: str = None,
        file_ids: List[str] = None,
        negative: str = None,
        length: int = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate a lip-sync video using HuMo.

        Provide inputs as URLs or pre-uploaded file IDs:
        - URLs: image_url + audio_url
        - File IDs: file_ids=[image_file_id, audio_file_id]

        Args:
            prompt: Description of the scene/character
            image_url: URL of the face/character image
            audio_url: URL of the audio/speech file
            file_ids: Pre-uploaded file IDs [image_id, audio_id]
            negative: Optional negative prompt (things to avoid)
            length: Video length in frames at 25fps (calculated from audio duration)
            width: Optional video width
            height: Optional video height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.speaking_video(
                "A person talking to camera",
                image_url="https://example.com/face.png",
                audio_url="https://example.com/speech.mp3"
            )
        """
        return self.create_flow("speaking-video", prompt=prompt, image_url=image_url, audio_url=audio_url, file_ids=file_ids, negative=negative, length=length, width=width, height=height, notify_url=notify_url)

    def speaking_video_wan(
        self,
        prompt: str,
        image_url: str,
        audio_url: str,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate an audio-driven video using Wan 2.2 S2V.

        Args:
            prompt: Description of the scene/action
            image_url: URL of the image
            audio_url: URL of the audio file
            negative: Optional negative prompt (things to avoid)
            width: Optional video width
            height: Optional video height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.speaking_video_wan(
                "The person is singing",
                "https://example.com/face.png",
                "https://example.com/song.mp3"
            )
        """
        return self.create_flow("speaking-video-wan", prompt=prompt, image_url=image_url, audio_url=audio_url, negative=negative, width=width, height=height, notify_url=notify_url)

    def image_to_image(
        self,
        prompt: str,
        image_urls: List[str] = None,
        file_ids: List[str] = None,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Transform images using Qwen Image Edit with 1-3 input images.

        Args:
            prompt: Description of the transformation
            image_urls: List of 1-3 image URLs (first is main, others are references)
            file_ids: Pre-uploaded file IDs [main_id, ref1_id, ref2_id]
            negative: Optional negative prompt (things to avoid)
            width: Optional output width
            height: Optional output height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.image_to_image(
                "Apply the artistic style from the references",
                image_urls=["https://example.com/subject.jpg", "https://example.com/style.jpg"]
            )
        """
        return self.create_flow("image-to-image", prompt=prompt, image_urls=image_urls, file_ids=file_ids, negative=negative, width=width, height=height, notify_url=notify_url)

    def first_last_frame_video(
        self,
        prompt: str,
        start_image_url: str = None,
        end_image_url: str = None,
        file_ids: List[str] = None,
        negative: str = None,
        width: int = None,
        height: int = None,
        notify_url: str = None,
    ) -> Render:
        """Generate video morphing between two images using Wan 2.2.

        Args:
            prompt: Description of the transition/motion
            start_image_url: URL of the starting frame
            end_image_url: URL of the ending frame
            file_ids: Pre-uploaded file IDs [start_image_id, end_image_id]
            negative: Optional negative prompt (things to avoid)
            width: Optional video width
            height: Optional video height
            notify_url: Optional webhook URL for completion notification

        Example:
            render = client.renders.first_last_frame_video(
                "smooth transition from day to night",
                start_image_url="https://example.com/day.png",
                end_image_url="https://example.com/night.png"
            )
        """
        return self.create_flow("first-last-frame-video", prompt=prompt, start_image_url=start_image_url, end_image_url=end_image_url, file_ids=file_ids, negative=negative, width=width, height=height, notify_url=notify_url)

    def audio_to_text(
        self,
        audio_url: str = None,
        file_ids: List[str] = None,
        notify_url: str = None,
    ) -> Render:
        """Transcribe audio/video to text using WhisperX.

        Provide input as a URL or pre-uploaded file ID:
        - URL: audio_url="https://..."
        - File ID: file_ids=["audio_file_id"]

        Args:
            audio_url: URL of the audio or video file to transcribe
            file_ids: Pre-uploaded file IDs [audio_id]
            notify_url: Optional webhook URL for completion notification

        Returns:
            Render object. When completed, result_url points to a JSON file
            containing {"text": "transcription..."}.

        Example:
            render = client.renders.audio_to_text("https://example.com/recording.mp3")
            render = client.renders.audio_to_text(file_ids=["abc123"])
        """
        return self._flow("/api/flow/audio-to-text", audio_url=audio_url, file_ids=file_ids, notify_url=notify_url)

    def text_to_speech(
        self,
        text: str,
        mode: str = "custom",
        language: str = "Auto",
        speaker: str = None,
        style: str = None,
        model_size: str = None,
        voice_description: str = None,
        ref_audio_url: str = None,
        file_ids: List[str] = None,
        ref_text: str = None,
        use_xvector_only: bool = None,
        notify_url: str = None,
    ) -> Render:
        """Generate speech from text using Qwen3-TTS.

        Three modes:
        - "custom": Predefined speakers with optional style instructions
        - "design": Describe any voice in natural language
        - "clone": Clone a voice from reference audio

        Args:
            text: Text to synthesize
            mode: TTS mode ("custom", "design", or "clone")
            language: Language (Auto, English, Chinese, Japanese, Korean, etc.)
            speaker: Speaker name for custom mode (Ryan, Serena, etc.)
            style: Style instruction for custom mode (e.g. "Speak cheerfully")
            model_size: Model size ("0.6B" or "1.7B")
            voice_description: Voice description for design mode
            ref_audio_url: Reference audio URL for clone mode
            ref_text: Transcript of reference audio for clone mode
            use_xvector_only: Use x-vector only for clone mode
            notify_url: Optional webhook URL for completion notification

        Returns:
            Render object. When completed, result_url points to the WAV audio file.

        Example:
            render = client.renders.text_to_speech("Hello!", mode="design",
                voice_description="A young Indian male, enthusiastic")
        """
        return self._flow(
            "/api/flow/text-to-speech",
            text=text,
            mode=mode,
            language=language,
            speaker=speaker,
            style=style,
            model_size=model_size,
            voice_description=voice_description,
            ref_audio_url=ref_audio_url,
            file_ids=file_ids,
            ref_text=ref_text,
            use_xvector_only=use_xvector_only,
            notify_url=notify_url,
        )
