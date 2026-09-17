//! Renders / flow product API.
//!
//! Mirrors the Python SDK's `hypercli/renders.py` (contract authority),
//! including its capability routing: flow writes go to `{agents}/flow/...`
//! when the credential advertises the `flows` subscription family (capability
//! tags, or `has_active_subscription` with `auth_type == "user"`), and fall
//! back to `{product}/api/flow/...` on a 403/404 from the agents path.

use std::sync::OnceLock;

use reqwest::StatusCode;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{AuthMe, HyperCliClient, HyperCliError};

/// Render projection returned by the flow/render endpoints.
#[derive(Clone, Debug)]
pub struct Render {
    pub render_id: String,
    pub state: String,
    pub template: Option<String>,
    pub render_type: Option<String>,
    pub tags: Vec<String>,
    pub result_url: Option<String>,
    pub error: Option<String>,
    pub created_at: Option<f64>,
    pub started_at: Option<f64>,
    pub completed_at: Option<f64>,
}

impl Render {
    /// Tolerant wire parse: accepts `id` or `render_id`, `type` or
    /// `render_type`, and `meta.template` as the template fallback.
    pub fn from_value(data: &Value) -> Result<Self, HyperCliError> {
        let render = serde_json::from_value::<RenderWire>(data.clone())
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        Ok(render.into_render())
    }
}

/// Numbers and numeric strings parse; anything else becomes `None`.
fn de_opt_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Num(f64),
        Str(String),
        Other(serde::de::IgnoredAny),
    }
    Ok(match Option::<Raw>::deserialize(deserializer)? {
        Some(Raw::Num(value)) => Some(value),
        Some(Raw::Str(value)) => value.trim().parse().ok(),
        _ => None,
    })
}

#[derive(Deserialize)]
struct RenderWire {
    #[serde(default)]
    render_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default, rename = "type")]
    render_type_alias: Option<String>,
    #[serde(default)]
    render_type: Option<String>,
    #[serde(default)]
    template: Option<String>,
    #[serde(default)]
    meta: Value,
    #[serde(default)]
    state: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    result_url: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    created_at: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    started_at: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    completed_at: Option<f64>,
}

impl RenderWire {
    fn into_render(self) -> Render {
        Render {
            render_id: self.render_id.or(self.id).unwrap_or_default(),
            state: self.state,
            template: self.template.or_else(|| {
                self.meta
                    .get("template")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            }),
            render_type: self.render_type_alias.or(self.render_type),
            tags: self.tags,
            result_url: self.result_url,
            error: self.error,
            created_at: self.created_at,
            started_at: self.started_at,
            completed_at: self.completed_at,
        }
    }
}

/// Lightweight render status from the polling endpoint.
#[derive(Clone, Debug)]
pub struct RenderStatus {
    pub render_id: String,
    pub state: String,
    pub progress: Option<f64>,
}

impl RenderStatus {
    fn from_value(data: &Value) -> Result<Self, HyperCliError> {
        #[derive(Deserialize)]
        struct StatusWire {
            #[serde(default)]
            render_id: Option<String>,
            #[serde(default)]
            id: Option<String>,
            #[serde(default)]
            state: String,
            #[serde(default)]
            progress: Option<f64>,
        }
        let wire = serde_json::from_value::<StatusWire>(data.clone())
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        Ok(Self {
            render_id: wire.render_id.or(wire.id).unwrap_or_default(),
            state: wire.state,
            progress: wire.progress,
        })
    }
}

/// Filters for [`RendersClient::list`].
#[derive(Clone, Debug, Default)]
pub struct RenderListFilters {
    pub state: Option<String>,
    pub template: Option<String>,
    pub render_type: Option<String>,
    pub tags: Vec<String>,
}

/// Create a render with workflow-specific params
/// (`POST {product}/api/renders`).
#[derive(Clone, Debug, Serialize)]
pub struct CreateRenderRequest {
    #[serde(rename = "type")]
    pub render_type: String,
    pub params: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_url: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

impl CreateRenderRequest {
    pub fn new(params: Value) -> Self {
        Self {
            render_type: "comfyui".to_owned(),
            params,
            notify_url: None,
            tags: Vec::new(),
        }
    }
}

macro_rules! flow_request {
    ($name:ident { $required:ident : $required_ty:ty, $( $field:ident : $ty:ty ),* $(,)? }) => {
        #[derive(Clone, Debug, Default, Serialize)]
        pub struct $name {
            pub $required: $required_ty,
            $(
                #[serde(skip_serializing_if = "Option::is_none")]
                pub $field: Option<$ty>,
            )*
        }

        impl $name {
            pub fn new($required: $required_ty) -> Self {
                Self {
                    $required,
                    ..Default::default()
                }
            }
        }
    };
}

flow_request!(TextToImageRequest {
    prompt: String,
    negative: String,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(TextToVideoRequest {
    prompt: String,
    negative: String,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(ImageToVideoRequest {
    prompt: String,
    image_url: String,
    file_ids: Vec<String>,
    negative: String,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(ImageToImageRequest {
    prompt: String,
    image_urls: Vec<String>,
    file_ids: Vec<String>,
    negative: String,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(SpeakingVideoRequest {
    prompt: String,
    image_url: String,
    audio_url: String,
    file_ids: Vec<String>,
    negative: String,
    length: u32,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(FirstLastFrameVideoRequest {
    prompt: String,
    start_image_url: String,
    end_image_url: String,
    file_ids: Vec<String>,
    negative: String,
    width: u32,
    height: u32,
    notify_url: String,
});

flow_request!(AudioToTextRequest {
    audio_url: String,
    file_ids: Vec<String>,
    notify_url: String,
});

/// `text_to_speech` request (Qwen3-TTS). `mode` and `language` always
/// serialize, matching the Python SDK's non-optional defaults.
#[derive(Clone, Debug, Serialize)]
pub struct TextToSpeechRequest {
    pub text: String,
    pub mode: String,
    pub language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_audio_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_xvector_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_url: Option<String>,
}

impl TextToSpeechRequest {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            mode: "custom".to_owned(),
            language: "Auto".to_owned(),
            speaker: None,
            style: None,
            model_size: None,
            voice_description: None,
            ref_audio_url: None,
            file_ids: None,
            ref_text: None,
            use_xvector_only: None,
            notify_url: None,
        }
    }
}

/// Blocking client for the renders/flow API. Obtained through
/// [`HyperCliClient::renders`]; shares the client's retry/timeout/trace
/// behavior and its cached `auth_me` context.
pub struct RendersClient<'a> {
    pub(crate) client: &'a HyperCliClient,
    pub(crate) auth_me: &'a OnceLock<Option<AuthMe>>,
}

impl RendersClient<'_> {
    fn cached_auth_me(&self) -> Option<&AuthMe> {
        self.auth_me
            .get_or_init(|| self.client.auth_me().ok())
            .as_ref()
    }

    /// Mirrors the Python SDK: capability tags win; otherwise an active
    /// subscription with `auth_type == "user"` qualifies.
    fn supports_flows_family(&self, flow_type: Option<&str>) -> bool {
        let Some(auth_me) = self.cached_auth_me() else {
            return false;
        };
        if auth_me
            .capabilities
            .iter()
            .any(|capability| capability == "flows:*")
        {
            return true;
        }
        if let Some(flow_type) = flow_type {
            let needle = format!("flows:{flow_type}");
            if auth_me
                .capabilities
                .iter()
                .any(|capability| capability == &needle)
            {
                return true;
            }
        }
        if !auth_me.has_active_subscription {
            return false;
        }
        auth_me.auth_type == "user"
    }

    fn flow_get(&self, render_id: &str, status: bool) -> Result<Value, HyperCliError> {
        let suffix = if status { "/status" } else { "" };
        let agents_url = self
            .client
            .endpoint(&format!("flow/renders/{render_id}{suffix}"));
        let product_url = self
            .client
            .product_endpoint(&format!("api/flow/renders/{render_id}{suffix}"));
        let get = |url: &str| {
            self.client
                .http
                .get(url)
                .bearer_auth(self.client.api_key.expose_secret())
        };
        if self.supports_flows_family(None) {
            match self
                .client
                .send_json("renders.get", "GET", &agents_url, None, get(&agents_url))
            {
                Err(error)
                    if matches!(
                        error.status(),
                        Some(StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
                    ) =>
                {
                    self.client.send_json(
                        "renders.get",
                        "GET",
                        &product_url,
                        None,
                        get(&product_url),
                    )
                }
                outcome => outcome,
            }
        } else {
            self.client
                .send_json("renders.get", "GET", &product_url, None, get(&product_url))
        }
    }

    fn flow_post(&self, flow_type: &str, payload: &Value) -> Result<Value, HyperCliError> {
        let agents_url = self.client.endpoint(&format!("flow/{flow_type}"));
        let product_url = self
            .client
            .product_endpoint(&format!("api/flow/{flow_type}"));
        let post = |url: &str| {
            self.client
                .http
                .post(url)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(payload)
        };
        let trace = Some(payload.clone());
        if self.supports_flows_family(Some(flow_type)) {
            match self.client.send_json(
                "renders.create_flow",
                "POST",
                &agents_url,
                trace.clone(),
                post(&agents_url),
            ) {
                Err(error)
                    if matches!(
                        error.status(),
                        Some(StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
                    ) =>
                {
                    self.client.send_json(
                        "renders.create_flow",
                        "POST",
                        &product_url,
                        trace,
                        post(&product_url),
                    )
                }
                outcome => outcome,
            }
        } else {
            self.client.send_json(
                "renders.create_flow",
                "POST",
                &product_url,
                trace,
                post(&product_url),
            )
        }
    }

    /// Create a flow render, routed through the subscription flow endpoints
    /// when the credential supports them.
    pub fn create_flow<S: Serialize>(
        &self,
        flow_type: &str,
        payload: &S,
    ) -> Result<Render, HyperCliError> {
        let mut payload = serde_json::to_value(payload)
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        // Match the Python SDK: silently drop None-valued keys.
        if let Some(object) = payload.as_object_mut() {
            object.retain(|_, value| !value.is_null());
        }
        let data = self.flow_post(flow_type, &payload)?;
        Render::from_value(&data)
    }

    /// List renders; the server may return a bare array or an `{items: [...]}`
    /// page.
    pub fn list(&self, filters: &RenderListFilters) -> Result<Vec<Render>, HyperCliError> {
        let url = self.client.product_endpoint("api/renders");
        let mut query: Vec<(String, String)> = Vec::new();
        if let Some(state) = filters.state.as_deref().filter(|state| !state.is_empty()) {
            query.push(("state".to_owned(), state.to_owned()));
        }
        if let Some(template) = filters.template.as_deref().filter(|t| !t.is_empty()) {
            query.push(("template".to_owned(), template.to_owned()));
        }
        if let Some(render_type) = filters.render_type.as_deref().filter(|t| !t.is_empty()) {
            query.push(("type".to_owned(), render_type.to_owned()));
        }
        query.extend(
            filters
                .tags
                .iter()
                .map(|tag| ("tag".to_owned(), tag.clone())),
        );
        let data: Value = self.client.send_json(
            "renders.list",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .query(&query),
        )?;
        let items = data.get("items").cloned().unwrap_or_else(|| data.clone());
        let items = items
            .as_array()
            .ok_or_else(|| HyperCliError::InvalidResponse("render list must be an array".into()))?;
        items.iter().map(Render::from_value).collect()
    }

    /// Get one render.
    pub fn get(&self, render_id: &str) -> Result<Render, HyperCliError> {
        Render::from_value(&self.flow_get(render_id, false)?)
    }

    /// Lightweight render status for polling loops.
    pub fn status(&self, render_id: &str) -> Result<RenderStatus, HyperCliError> {
        RenderStatus::from_value(&self.flow_get(render_id, true)?)
    }

    /// Cancel a render. The response shape is backend-owned.
    pub fn cancel(&self, render_id: &str) -> Result<Value, HyperCliError> {
        let agents_url = self.client.endpoint(&format!("flow/renders/{render_id}"));
        let product_url = self
            .client
            .product_endpoint(&format!("api/flow/renders/{render_id}"));
        let delete = |url: &str| {
            self.client
                .http
                .delete(url)
                .bearer_auth(self.client.api_key.expose_secret())
        };
        if self.supports_flows_family(None) {
            match self.client.send_json(
                "renders.cancel",
                "DELETE",
                &agents_url,
                None,
                delete(&agents_url),
            ) {
                Err(error)
                    if matches!(
                        error.status(),
                        Some(StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
                    ) =>
                {
                    self.client.send_json(
                        "renders.cancel",
                        "DELETE",
                        &product_url,
                        None,
                        delete(&product_url),
                    )
                }
                outcome => outcome,
            }
        } else {
            self.client.send_json(
                "renders.cancel",
                "DELETE",
                &product_url,
                None,
                delete(&product_url),
            )
        }
    }

    /// Create a render with workflow params (`POST {product}/api/renders`).
    pub fn create(&self, request: &CreateRenderRequest) -> Result<Render, HyperCliError> {
        let url = self.client.product_endpoint("api/renders");
        let data: Value = self.client.send_json(
            "renders.create",
            "POST",
            &url,
            serde_json::to_value(request).ok(),
            self.client
                .http
                .post(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(request),
        )?;
        Render::from_value(&data)
    }

    /// Qwen-Image text-to-image render.
    pub fn text_to_image(&self, request: &TextToImageRequest) -> Result<Render, HyperCliError> {
        self.create_flow("text-to-image", request)
    }

    /// Wan 2.2 14B text-to-video render.
    pub fn text_to_video(&self, request: &TextToVideoRequest) -> Result<Render, HyperCliError> {
        self.create_flow("text-to-video", request)
    }

    /// Wan 2.2 Animate image-to-video render.
    pub fn image_to_video(&self, request: &ImageToVideoRequest) -> Result<Render, HyperCliError> {
        self.create_flow("image-to-video", request)
    }

    /// Qwen Image Edit with 1-3 input images.
    pub fn image_to_image(&self, request: &ImageToImageRequest) -> Result<Render, HyperCliError> {
        self.create_flow("image-to-image", request)
    }

    /// HuMo lip-sync speaking video.
    pub fn speaking_video(&self, request: &SpeakingVideoRequest) -> Result<Render, HyperCliError> {
        self.create_flow("speaking-video", request)
    }

    /// Wan 2.2 first/last-frame video.
    pub fn first_last_frame_video(
        &self,
        request: &FirstLastFrameVideoRequest,
    ) -> Result<Render, HyperCliError> {
        self.create_flow("first-last-frame-video", request)
    }

    /// WhisperX transcription.
    pub fn audio_to_text(&self, request: &AudioToTextRequest) -> Result<Render, HyperCliError> {
        self.create_flow("audio-to-text", request)
    }

    /// Qwen3-TTS speech synthesis.
    pub fn text_to_speech(&self, request: &TextToSpeechRequest) -> Result<Render, HyperCliError> {
        self.create_flow("text-to-speech", request)
    }
}

/// Serialize helper used by tests and debug assertions.
#[cfg(test)]
fn flow_payload<S: Serialize>(payload: &S) -> Value {
    let mut value = serde_json::to_value(payload).unwrap();
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use serde_json::json;
    use url::Url;

    fn auth_me_payload() -> Value {
        json!({
            "user_id": "user-1",
            "auth_type": "api_key",
            "has_active_subscription": false,
            "capabilities": []
        })
    }

    #[test]
    fn credential_without_flow_capability_posts_to_product_flow() {
        let mut server = Server::new();
        let auth = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(auth_me_payload().to_string())
            .expect(1)
            .create();
        let flow = server
            .mock("POST", "/api/flow/text-to-image")
            .match_body(Matcher::Json(json!({
                "prompt": "a cat wearing sunglasses",
                "width": 512
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "render-1", "state": "pending"}).to_string())
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let mut request = TextToImageRequest::new("a cat wearing sunglasses".to_owned());
        request.width = Some(512);
        let render = client.renders().text_to_image(&request).unwrap();

        assert_eq!(render.render_id, "render-1");
        assert_eq!(render.state, "pending");
        auth.assert();
        flow.assert();
    }

    #[test]
    fn flows_capability_routes_to_agents_flow() {
        let mut server = Server::new();
        let auth = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "user_id": "user-1",
                    "auth_type": "api_key",
                    "has_active_subscription": false,
                    "capabilities": ["flows:*"]
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let flow = server
            .mock("POST", "/agents/flow/text-to-video")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"render_id": "render-2", "state": "pending"}).to_string())
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let render = client
            .renders()
            .text_to_video(&TextToVideoRequest::new("waves".to_owned()))
            .unwrap();

        assert_eq!(render.render_id, "render-2");
        auth.assert();
        flow.assert();
    }

    #[test]
    fn agents_flow_falls_back_to_product_flow_on_404() {
        let mut server = Server::new();
        let auth = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "user_id": "user-1",
                    "auth_type": "api_key",
                    "has_active_subscription": false,
                    "capabilities": ["flows:text-to-image"]
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let agents_flow = server
            .mock("POST", "/agents/flow/text-to-image")
            .with_status(404)
            .with_header("content-type", "application/json")
            .with_body(json!({"detail": "unknown flow"}).to_string())
            .expect(1)
            .create();
        let product_flow = server
            .mock("POST", "/api/flow/text-to-image")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "render-3", "state": "pending"}).to_string())
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let render = client
            .renders()
            .text_to_image(&TextToImageRequest::new("a cat".to_owned()))
            .unwrap();

        assert_eq!(render.render_id, "render-3");
        auth.assert();
        agents_flow.assert();
        product_flow.assert();
    }

    #[test]
    fn status_uses_meta_template_fallback_and_reports_progress() {
        let mut server = Server::new();
        let auth = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(auth_me_payload().to_string())
            .expect(1)
            .create();
        let status = server
            .mock("GET", "/api/flow/renders/render-4/status")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "render-4", "state": "running", "progress": 0.5}).to_string())
            .expect(1)
            .create();
        let get = server
            .mock("GET", "/api/flow/renders/render-4")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"id": "render-4", "state": "running", "meta": {"template": "txt2img"}})
                    .to_string(),
            )
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let renders = client.renders();
        assert_eq!(renders.status("render-4").unwrap().progress, Some(0.5));
        assert_eq!(
            renders.get("render-4").unwrap().template.as_deref(),
            Some("txt2img")
        );
        auth.assert();
        status.assert();
        get.assert();
    }

    #[test]
    fn active_user_subscription_without_tags_routes_to_agents_flow() {
        let mut server = Server::new();
        let auth = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "user_id": "user-1",
                    "auth_type": "user",
                    "has_active_subscription": true,
                    "capabilities": []
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let flow = server
            .mock("POST", "/agents/flow/text-to-image")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "render-5", "state": "pending"}).to_string())
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let render = client
            .renders()
            .text_to_image(&TextToImageRequest::new("a cat".to_owned()))
            .unwrap();

        assert_eq!(render.render_id, "render-5");
        auth.assert();
        flow.assert();
    }

    #[test]
    fn tts_serializes_mode_and_language_and_skips_nones() {
        let payload = flow_payload(&TextToSpeechRequest::new("hello"));
        assert_eq!(payload["mode"], "custom");
        assert_eq!(payload["language"], "Auto");
        assert!(payload.get("speaker").is_none());
        assert!(payload.get("use_xvector_only").is_none());
    }
}
