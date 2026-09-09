//! File uploads product API (`{product}/api/files`).
//!
//! Mirrors the Python SDK's `hypercli/files.py`: multipart upload,
//! URL/base64 imports with async backend processing, and `wait_ready`
//! polling.

use std::path::Path;
use std::time::{Duration, Instant};

use secrecy::ExposeSecret;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{HyperCliClient, HyperCliError};

/// Uploaded file metadata. The `url` is an internal `s3://` reference usable
/// only inside the platform (e.g. as a render input); it is not a download
/// link.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct File {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub file_size: u64,
    #[serde(default)]
    pub url: String,
    /// `processing`, `done`, or `failed` for async uploads.
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

impl File {
    /// Whether the upload finished and is usable.
    pub fn is_ready(&self) -> bool {
        self.state.as_deref() == Some("done")
    }

    /// Whether the upload failed.
    pub fn is_failed(&self) -> bool {
        self.state.as_deref() == Some("failed")
    }

    /// Whether the upload is still being processed.
    pub fn is_processing(&self) -> bool {
        self.state.as_deref() == Some("processing")
    }
}

/// Default `wait_ready` timeout, matching the Python SDK.
const WAIT_READY_DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Minimal extension-based content-type guess for the common asset types the
/// files API ingests; anything unrecognized is `application/octet-stream`
/// (the Python SDK uses `mimetypes.guess_type`).
fn guess_content_type(filename: &str) -> String {
    let lower = filename.to_ascii_lowercase();
    let known = [
        (".png", "image/png"),
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".gif", "image/gif"),
        (".webp", "image/webp"),
        (".svg", "image/svg+xml"),
        (".mp4", "video/mp4"),
        (".webm", "video/webm"),
        (".mov", "video/quicktime"),
        (".mp3", "audio/mpeg"),
        (".wav", "audio/wav"),
        (".flac", "audio/flac"),
        (".ogg", "audio/ogg"),
        (".json", "application/json"),
        (".txt", "text/plain"),
        (".md", "text/markdown"),
        (".pdf", "application/pdf"),
        (".zip", "application/zip"),
    ];
    known
        .iter()
        .find(|(extension, _)| lower.ends_with(extension))
        .map(|(_, content_type)| (*content_type).to_owned())
        .unwrap_or_else(|| "application/octet-stream".to_owned())
}

/// Blocking client for the files product API, obtained through
/// [`HyperCliClient::files`].
pub struct FilesClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl FilesClient<'_> {
    /// Upload a file from disk for use in renders.
    pub fn upload(&self, file_path: impl AsRef<Path>) -> Result<File, HyperCliError> {
        let file_path = file_path.as_ref();
        let content = std::fs::read(file_path)
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let filename = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_owned();
        let content_type = guess_content_type(&filename);
        self.upload_bytes(&content, &filename, &content_type)
    }

    /// Upload file bytes directly (`POST {product}/api/files/multi`, field
    /// `file`).
    pub fn upload_bytes(
        &self,
        content: &[u8],
        filename: &str,
        content_type: &str,
    ) -> Result<File, HyperCliError> {
        let url = self.client.product_endpoint("api/files/multi");
        let part = reqwest::blocking::multipart::Part::bytes(content.to_vec())
            .file_name(filename.to_owned());
        let part = match part.mime_str(content_type) {
            Ok(part) => part,
            Err(error) => return Err(HyperCliError::InvalidResponse(error.to_string())),
        };
        let form = reqwest::blocking::multipart::Form::new().part("file", part);
        self.client.send_json(
            "files.upload",
            "POST",
            &url,
            Some(json!({
                "filename": filename,
                "content_type": content_type,
                "size": content.len(),
                "content": "<omitted>",
            })),
            self.client
                .http
                .post(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .multipart(form),
        )
    }

    /// Upload a file from a URL (async backend processing; returns
    /// `state: "processing"` immediately — poll with [`Self::wait_ready`]).
    pub fn upload_url(&self, url: &str, path: Option<&str>) -> Result<File, HyperCliError> {
        let endpoint = self.client.product_endpoint("api/files/url");
        let mut payload = json!({ "url": url });
        if let Some(path) = path {
            payload["path"] = json!(path);
        }
        self.client.send_json(
            "files.upload_url",
            "POST",
            &endpoint,
            Some(payload.clone()),
            self.client
                .http
                .post(&endpoint)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(&payload),
        )
    }

    /// Upload base64-encoded data (async backend processing).
    pub fn upload_b64(
        &self,
        data: &str,
        filename: &str,
        content_type: Option<&str>,
        path: Option<&str>,
    ) -> Result<File, HyperCliError> {
        let endpoint = self.client.product_endpoint("api/files/b64");
        let mut payload = json!({ "data": data, "filename": filename });
        if let Some(content_type) = content_type {
            payload["content_type"] = json!(content_type);
        }
        if let Some(path) = path {
            payload["path"] = json!(path);
        }
        self.client.send_json(
            "files.upload_b64",
            "POST",
            &endpoint,
            Some(payload.clone()),
            self.client
                .http
                .post(&endpoint)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(&payload),
        )
    }

    /// Get file metadata and URL.
    pub fn get(&self, file_id: &str) -> Result<File, HyperCliError> {
        let url = self
            .client
            .product_endpoint(&format!("api/files/{file_id}"));
        self.client.send_json(
            "files.get",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }

    /// Delete an uploaded file. Response shape is backend-owned
    /// (`{"status": "deleted", "id": "..."}`).
    pub fn delete(&self, file_id: &str) -> Result<Value, HyperCliError> {
        let url = self
            .client
            .product_endpoint(&format!("api/files/{file_id}"));
        self.client.send_json(
            "files.delete",
            "DELETE",
            &url,
            None,
            self.client
                .http
                .delete(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }

    /// Wait for an async upload to become ready or fail.
    pub fn wait_ready(
        &self,
        file_id: &str,
        timeout: Option<Duration>,
        poll_interval: Option<Duration>,
    ) -> Result<File, HyperCliError> {
        let timeout = timeout.unwrap_or(WAIT_READY_DEFAULT_TIMEOUT);
        let poll_interval = poll_interval.unwrap_or_else(|| Duration::from_secs(1));
        let deadline = Instant::now() + timeout;
        loop {
            let file = self.get(file_id)?;
            if file.is_ready() {
                return Ok(file);
            }
            if file.is_failed() {
                return Err(HyperCliError::InvalidResponse(format!(
                    "File upload failed: {}",
                    file.error.unwrap_or_default()
                )));
            }
            if Instant::now() >= deadline {
                return Err(HyperCliError::Transport(format!(
                    "File {file_id} did not complete within {}s",
                    timeout.as_secs()
                )));
            }
            std::thread::sleep(poll_interval);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use url::Url;

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap()
    }

    #[test]
    fn upload_bytes_posts_multipart_with_file_field() {
        let mut server = Server::new();
        let upload = server
            .mock("POST", "/api/files/multi")
            .match_header("authorization", "Bearer test-credential")
            .match_header("content-type", Matcher::Regex("multipart/form-data".into()))
            .match_body(Matcher::AllOf(vec![
                Matcher::Regex("name=\"file\"".into()),
                Matcher::Regex("filename=\"image.png\"".into()),
                Matcher::Regex("some-bytes".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "file-1",
                    "filename": "image.png",
                    "content_type": "image/png",
                    "file_size": 10,
                    "url": "s3://bucket/file-1",
                    "state": "done"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let client = client(&server);

        let file = client
            .files()
            .upload_bytes(b"some-bytes", "image.png", "image/png")
            .unwrap();

        assert_eq!(file.id, "file-1");
        assert!(file.is_ready());
        assert!(!file.is_processing());
        upload.assert();
    }

    #[test]
    fn upload_url_posts_url_and_optional_path() {
        let mut server = Server::new();
        let upload = server
            .mock("POST", "/api/files/url")
            .match_body(Matcher::Json(json!({
                "url": "https://example.com/image.png",
                "path": "renders"
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "file-2", "state": "processing"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let file = client
            .files()
            .upload_url("https://example.com/image.png", Some("renders"))
            .unwrap();

        assert_eq!(file.id, "file-2");
        assert!(file.is_processing());
        upload.assert();
    }

    #[test]
    fn wait_ready_polls_until_done() {
        let mut server = Server::new();
        let get = server
            .mock("GET", "/api/files/file-3")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"id": "file-3", "state": "done", "url": "s3://bucket/file-3"}).to_string(),
            )
            .expect(1)
            .create();
        let client = client(&server);

        let file = client
            .files()
            .wait_ready("file-3", None, Some(Duration::from_millis(1)))
            .unwrap();
        assert_eq!(file.url, "s3://bucket/file-3");
        get.assert();
    }

    #[test]
    fn wait_ready_fails_fast_on_failed_uploads() {
        let mut server = Server::new();
        let get = server
            .mock("GET", "/api/files/file-4")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "file-4", "state": "failed", "error": "bad image"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let error = client
            .files()
            .wait_ready("file-4", None, Some(Duration::from_millis(1)))
            .unwrap_err();
        assert!(error.to_string().contains("bad image"));
        get.assert();
    }

    #[test]
    fn delete_returns_backend_payload() {
        let mut server = Server::new();
        let delete = server
            .mock("DELETE", "/api/files/file-5")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"status": "deleted", "id": "file-5"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let deleted = client.files().delete("file-5").unwrap();
        assert_eq!(deleted["status"], "deleted");
        delete.assert();
    }
}
