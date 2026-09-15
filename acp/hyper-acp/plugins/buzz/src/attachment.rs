//! Publish-side file attachments: Blossom BUD-02 upload + NIP-92 imeta tags.
//!
//! Pattern-ported from upstream `buzz-cli` (`client.rs::upload_file`,
//! `sign_blossom_upload`, `build_imeta_tag`, and the `messages.rs` append
//! behavior) with deliberate, documented deltas (see PROVENANCE.md):
//!
//! - MIME is resolved from the file extension against a fixed allowlist
//!   instead of `infer` magic-byte sniffing.
//! - The per-attempt retry/backoff machinery is not ported; a failed upload
//!   surfaces to the caller, with a single `/upload` → `/media/upload`
//!   endpoint fallback on 404/405 exactly like upstream.
//! - `filename <basename>` is emitted in the imeta tag (relay-allowlisted);
//!   upstream's optional `thumb`/`duration` fields are not forwarded.
//!
//! Wire format is upstream-identical: `PUT {relay-http-base}/upload` with
//! `Authorization: Nostr <base64url(kind-24242 blossom auth event)>`,
//! `Content-Type: <mime>`, `X-SHA-256: <hex>`, the optional `x-auth-tag`
//! membership header, and the descriptor folded into an imeta tag.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use sha2::{Digest, Sha256};

use crate::publish::{MAX_ATTACHMENT_BYTES, MAX_VIDEO_ATTACHMENT_BYTES};

/// Per-request upload timeout for non-video bodies (upstream parity).
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// Per-request upload timeout for video bodies (upstream parity).
const VIDEO_UPLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// Relay media endpoint context: the HTTP(S) base derived from the
/// configured `ws(s)://` relay URL, the workspace base for agent-relative
/// paths, and the membership credentials shared with the REST client.
#[derive(Clone)]
pub(crate) struct AttachmentContext {
    http_base: String,
    cwd: PathBuf,
    auth_tag_json: Option<String>,
    client: reqwest::Client,
}

impl AttachmentContext {
    pub(crate) fn new(http_base: String, cwd: PathBuf, auth_tag_json: Option<String>) -> Self {
        Self {
            http_base,
            cwd,
            auth_tag_json,
            client: reqwest::Client::new(),
        }
    }
}

/// A successfully uploaded blob, folded from the relay's Blossom
/// BlobDescriptor plus the local basename.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct UploadedMedia {
    pub url: String,
    pub sha256: String,
    pub mime_type: String,
    pub size: u64,
    pub dim: Option<String>,
    pub blurhash: Option<String>,
    pub filename: Option<String>,
}

impl UploadedMedia {
    /// NIP-92 imeta tag vector, matching the relay's allowlisted keys.
    pub(crate) fn imeta_tag(&self) -> Vec<String> {
        let mut tag = vec![
            "imeta".to_string(),
            format!("url {}", self.url),
            format!("m {}", self.mime_type),
            format!("x {}", self.sha256),
            format!("size {}", self.size),
        ];
        if let Some(ref dim) = self.dim {
            tag.push(format!("dim {dim}"));
        }
        if let Some(ref blurhash) = self.blurhash {
            tag.push(format!("blurhash {blurhash}"));
        }
        if let Some(ref filename) = self.filename {
            tag.push(format!("filename {filename}"));
        }
        tag
    }
}

/// Attachment upload failure. Path/type/size problems are caller errors
/// (mapped to `invalid params` at the publish surface); signing, transport,
/// and response problems are relay-side failures.
#[derive(Debug, thiserror::Error)]
pub(crate) enum AttachmentError {
    #[error("cannot read attachment {}: {source}", .path.display())]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("attachment {} is not a regular file", .0.display())]
    NotAFile(PathBuf),
    #[error(
        "unsupported attachment type: {} (allowed: .png, .jpg, .jpeg, .gif, .webp, .mp4, .pdf)",
        .0.display()
    )]
    UnsupportedType(PathBuf),
    #[error("attachment {} is {size} bytes; max is {max}", .path.display())]
    TooLarge { path: PathBuf, size: u64, max: u64 },
    #[error("blossom auth signing failed: {0}")]
    Sign(String),
    #[error("upload request failed: {0}")]
    Request(String),
    #[error("upload rejected by relay (HTTP {status}): {body}")]
    Http { status: u16, body: String },
    #[error("invalid upload response: {0}")]
    Response(String),
}

/// MIME allowlist keyed by lowercase file extension (no content sniffing).
fn mime_for_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

/// Basename, or `None` when it violates the relay's imeta `filename` rules
/// (1–255 chars, no path separators, no control characters).
fn sanitized_filename(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        return None;
    }
    Some(name.to_string())
}

/// Sign the kind-24242 Blossom upload auth event and format the
/// `Authorization` header value.
///
/// Upstream `sign_blossom_upload` verbatim in shape: `t=upload`, `x=<sha256>`,
/// `expiration` (600s images, 3600s video), `server=<relay authority>` when
/// the base URL has a parseable host, content `"Upload file"`, serialized
/// base64url without padding.
fn sign_blossom_upload(
    keys: &Keys,
    sha256: &str,
    mime: &str,
    http_base: &str,
) -> Result<String, AttachmentError> {
    let now = nostr::Timestamp::now().as_secs();
    let expiry: u64 = if mime.starts_with("video/") {
        3600
    } else {
        600
    };
    let exp_str = (now + expiry).to_string();

    let mut tags = vec![
        Tag::parse(["t", "upload"]).map_err(|e| AttachmentError::Sign(e.to_string()))?,
        Tag::parse(["x", sha256]).map_err(|e| AttachmentError::Sign(e.to_string()))?,
        Tag::parse(["expiration", &exp_str]).map_err(|e| AttachmentError::Sign(e.to_string()))?,
    ];
    let authority = buzz_core::tenant::relay_url_authority(http_base);
    if !authority.is_empty() {
        tags.push(
            Tag::parse(["server", &authority]).map_err(|e| AttachmentError::Sign(e.to_string()))?,
        );
    }

    let auth_event = EventBuilder::new(Kind::from(24242), "Upload file")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| AttachmentError::Sign(e.to_string()))?;

    Ok(format!(
        "Nostr {}",
        URL_SAFE_NO_PAD.encode(auth_event.as_json().as_bytes())
    ))
}

/// Blossom BlobDescriptor response body (BUD-02).
#[derive(Debug, serde::Deserialize)]
struct BlobDescriptor {
    url: String,
    sha256: String,
    size: u64,
    #[serde(rename = "type")]
    mime_type: String,
    dim: Option<String>,
    blurhash: Option<String>,
}

/// PUT one blob to `endpoint` under `ctx.http_base` with a fresh auth event.
async fn put_blob(
    keys: &Keys,
    ctx: &AttachmentContext,
    endpoint: &str,
    mime: &str,
    sha256: &str,
    body: &[u8],
    timeout: Duration,
) -> Result<BlobDescriptor, AttachmentError> {
    let url = format!("{}{endpoint}", ctx.http_base);
    let auth_header = sign_blossom_upload(keys, sha256, mime, &ctx.http_base)?;
    let mut req = ctx
        .client
        .put(&url)
        .timeout(timeout)
        .header("Authorization", auth_header)
        .header("Content-Type", mime)
        .header("X-SHA-256", sha256)
        .body(body.to_vec());
    if let Some(ref tag_json) = ctx.auth_tag_json {
        req = req.header("x-auth-tag", tag_json.clone());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AttachmentError::Request(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AttachmentError::Http {
            status: status.as_u16(),
            body,
        });
    }
    resp.json::<BlobDescriptor>()
        .await
        .map_err(|e| AttachmentError::Response(e.to_string()))
}

/// Upload one file to the relay's Blossom endpoint and return the imeta-ready
/// media record.
///
/// Agent-relative paths resolve against the turn workspace (`ctx.cwd`), which
/// is the harness working directory advertised to the session. Size is
/// enforced from file metadata before the body is read (and re-checked on the
/// read buffer), mirroring the upstream caps: [`MAX_ATTACHMENT_BYTES`] for
/// non-video, [`MAX_VIDEO_ATTACHMENT_BYTES`] for video.
pub(crate) async fn upload_file(
    keys: &Keys,
    ctx: &AttachmentContext,
    path: &Path,
) -> Result<UploadedMedia, AttachmentError> {
    let resolved: PathBuf = if path.is_absolute() {
        path.to_path_buf()
    } else {
        ctx.cwd.join(path)
    };

    let metadata =
        tokio::fs::metadata(&resolved)
            .await
            .map_err(|source| AttachmentError::Read {
                path: resolved.clone(),
                source,
            })?;
    if !metadata.is_file() {
        return Err(AttachmentError::NotAFile(resolved));
    }

    let mime = mime_for_extension(&resolved)
        .ok_or_else(|| AttachmentError::UnsupportedType(resolved.clone()))?;

    let (max, timeout) = if mime.starts_with("video/") {
        (MAX_VIDEO_ATTACHMENT_BYTES, VIDEO_UPLOAD_TIMEOUT)
    } else {
        (MAX_ATTACHMENT_BYTES, UPLOAD_TIMEOUT)
    };
    let check_size = |size: u64| {
        if size > max {
            Err(AttachmentError::TooLarge {
                path: resolved.clone(),
                size,
                max,
            })
        } else {
            Ok(())
        }
    };
    check_size(metadata.len())?;

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|source| AttachmentError::Read {
            path: resolved.clone(),
            source,
        })?;
    check_size(bytes.len() as u64)?;

    let sha256 = hex::encode(Sha256::digest(&bytes));
    let filename = sanitized_filename(&resolved);

    // Primary BUD-02 endpoint; a relay that predates it answers 404/405 and
    // the upload is retried once against the legacy `/media/upload` alias.
    let descriptor = match put_blob(keys, ctx, "/upload", mime, &sha256, &bytes, timeout).await {
        Ok(d) => d,
        Err(e) => match e {
            AttachmentError::Http { status, .. } if status == 404 || status == 405 => {
                put_blob(keys, ctx, "/media/upload", mime, &sha256, &bytes, timeout).await?
            }
            other => return Err(other),
        },
    };

    Ok(UploadedMedia {
        url: descriptor.url,
        sha256: descriptor.sha256,
        mime_type: descriptor.mime_type,
        size: descriptor.size,
        dim: descriptor.dim,
        blurhash: descriptor.blurhash,
        filename,
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    //! Minimal single-purpose mock of the relay's Blossom HTTP door: accepts
    //! connections on a loopback listener, records each request, and answers
    //! from a caller-supplied rule. Shared by attachment/publish/bridge tests.
    use tokio::io::AsyncReadExt;
    use tokio::net::{TcpListener, TcpStream};

    #[derive(Debug, Clone)]
    pub(crate) struct RecordedRequest {
        pub method: String,
        pub path: String,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
    }

    impl RecordedRequest {
        pub(crate) fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(n, _)| n.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    pub(crate) struct MockUploadServer {
        pub base: String,
        pub requests: tokio::sync::mpsc::Receiver<RecordedRequest>,
        _accept_task: tokio::task::JoinHandle<()>,
    }

    /// Start a mock whose `rule` maps each request to `(status, json body)`.
    pub(crate) async fn mock_upload_server(
        rule: impl Fn(&RecordedRequest) -> (u16, String) + Send + 'static,
    ) -> MockUploadServer {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind mock");
        let addr = listener.local_addr().expect("mock addr");
        let (tx, requests) = tokio::sync::mpsc::channel(16);
        let accept_task = tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            while let Ok((mut stream, _)) = listener.accept().await {
                let req = read_request(&mut stream).await;
                let (status, body) = rule(&req);
                let _ = tx.send(req).await;
                let reason = if (200..300).contains(&status) {
                    "OK"
                } else {
                    "Error"
                };
                let head = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if stream.write_all(head.as_bytes()).await.is_err() {
                    return;
                }
                if stream.write_all(body.as_bytes()).await.is_err() {
                    return;
                }
            }
        });
        MockUploadServer {
            base: format!("http://{addr}"),
            requests,
            _accept_task: accept_task,
        }
    }

    /// Read one HTTP/1.1 request (head + `Content-Length`-delimited body).
    async fn read_request(stream: &mut TcpStream) -> RecordedRequest {
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8192];
        let header_end = loop {
            let n = stream.read(&mut chunk).await.expect("read request head");
            assert!(n > 0, "connection closed before request head");
            buf.extend_from_slice(&chunk[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos + 4;
            }
        };

        // httparse borrows the parse buffer, so flatten everything to owned
        // values before reading the body.
        let (method, path, headers, content_length) = {
            let mut header_slots = [httparse::EMPTY_HEADER; 32];
            let mut parsed = httparse::Request::new(&mut header_slots);
            let head_status = parsed
                .parse(&buf[..header_end])
                .expect("parse request head");
            assert!(head_status.is_complete(), "request head must be complete");
            let content_length: usize = parsed
                .headers
                .iter()
                .find(|h| h.name.eq_ignore_ascii_case("content-length"))
                .and_then(|h| std::str::from_utf8(h.value).ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            (
                parsed.method.expect("method").to_string(),
                parsed.path.expect("path").to_string(),
                parsed
                    .headers
                    .iter()
                    .map(|h| {
                        (
                            h.name.to_string(),
                            String::from_utf8_lossy(h.value).into_owned(),
                        )
                    })
                    .collect::<Vec<_>>(),
                content_length,
            )
        };
        while buf.len() < header_end + content_length {
            let n = stream.read(&mut chunk).await.expect("read request body");
            assert!(n > 0, "connection closed before full body");
            buf.extend_from_slice(&chunk[..n]);
        }

        RecordedRequest {
            method,
            path,
            headers,
            body: buf[header_end..header_end + content_length].to_vec(),
        }
    }

    /// Canonical 200 response body: relay-shaped BlobDescriptor with the
    /// absolute `/media/<sha>.<ext>` URL the real relay produces.
    pub(crate) fn descriptor_json(
        base: &str,
        sha256: &str,
        mime: &str,
        size: usize,
        extra: &str,
    ) -> String {
        let ext = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "video/mp4" => "mp4",
            "application/pdf" => "pdf",
            other => panic!("no ext mapping for {other}"),
        };
        format!(
            "{{\"url\":\"{base}/media/{sha256}.{ext}\",\"sha256\":\"{sha256}\",\"size\":{size},\
             \"type\":\"{mime}\",\"uploaded\":1750000000{extra}}}"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    fn test_ctx(base: String, cwd: PathBuf) -> AttachmentContext {
        AttachmentContext::new(base, cwd, None)
    }

    fn write_temp_file(dir: &std::path::Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).expect("write temp file");
        path
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("buzz-attach-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn upload_sends_blossom_auth_and_returns_imeta_media() {
        let dir = TempDir::new();
        let png = b"\x89PNG\r\n\x1a\nfake-image-body";
        write_temp_file(&dir.0, "shot.png", png);
        let sha = hex::encode(Sha256::digest(png));

        let expected_sha = sha.clone();
        let mut server = mock_upload_server(move |req| {
            assert_eq!(req.path, "/upload");
            (
                200,
                descriptor_json(
                    "http://placeholder",
                    &expected_sha,
                    "image/png",
                    req.body.len(),
                    ",\"dim\":\"8x4\",\"blurhash\":\"LEHV6nWB2yk8\"",
                ),
            )
        })
        .await;
        let base = server.base.clone();
        // The rule closure captured the placeholder before the address was
        // known; point the context at the real base and fix the URL after.
        let ctx = test_ctx(base.clone(), dir.0.clone());

        let keys = Keys::generate();
        let media = upload_file(&keys, &ctx, Path::new("shot.png"))
            .await
            .expect("upload succeeds");
        let req = server.requests.recv().await.expect("request recorded");

        assert_eq!(req.method, "PUT");
        assert_eq!(req.header("x-sha-256"), Some(sha.as_str()));
        assert_eq!(req.header("content-type"), Some("image/png"));
        assert_eq!(req.body, png, "raw file bytes are the request body");

        // Authorization: `Nostr <base64url(kind-24242 event)>`.
        let authz = req.header("authorization").expect("authorization header");
        let encoded = authz
            .strip_prefix("Nostr ")
            .expect("Nostr auth scheme prefix");
        let event_json = URL_SAFE_NO_PAD.decode(encoded).expect("base64url body");
        let event =
            nostr::Event::from_json(std::str::from_utf8(&event_json).unwrap()).expect("auth event");
        event.verify().expect("auth event signature verifies");
        assert_eq!(event.kind, Kind::from(24242));
        assert_eq!(event.content, "Upload file");
        assert_eq!(event.pubkey, keys.public_key());
        let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert!(tags.contains(&vec!["t".to_string(), "upload".to_string()]));
        assert!(tags.contains(&vec!["x".to_string(), sha.clone()]));
        let authority = buzz_core::tenant::relay_url_authority(&base);
        assert!(
            tags.contains(&vec!["server".to_string(), authority]),
            "server tag must carry the relay authority; tags: {tags:?}"
        );
        let expiration: u64 = tags
            .iter()
            .find(|t| t.first().map(String::as_str) == Some("expiration"))
            .and_then(|t| t.get(1).and_then(|v| v.parse().ok()))
            .expect("expiration tag");
        let now = nostr::Timestamp::now().as_secs();
        assert!(
            expiration > now && expiration <= now + 600,
            "image auth expires within the 600s window: {expiration}"
        );

        assert_eq!(media.sha256, sha);
        assert_eq!(media.mime_type, "image/png");
        assert_eq!(media.size, png.len() as u64);
        assert_eq!(
            media.url,
            format!("http://placeholder/media/{sha}.png"),
            "descriptor URL is passed through verbatim"
        );
        assert_eq!(
            media.imeta_tag(),
            vec![
                "imeta".to_string(),
                format!("url http://placeholder/media/{sha}.png"),
                "m image/png".to_string(),
                format!("x {sha}"),
                format!("size {}", png.len()),
                "dim 8x4".to_string(),
                "blurhash LEHV6nWB2yk8".to_string(),
                "filename shot.png".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn upload_falls_back_to_legacy_media_upload_on_404() {
        let dir = TempDir::new();
        let body = b"%PDF-1.7 fake";
        write_temp_file(&dir.0, "doc.pdf", body);
        let sha = hex::encode(Sha256::digest(body));

        let expected_sha = sha.clone();
        let mut server = mock_upload_server(move |req| match req.path.as_str() {
            "/upload" => (404, "{\"error\":\"no such route\"}".to_string()),
            "/media/upload" => (
                200,
                descriptor_json("http://x", &expected_sha, "application/pdf", body.len(), ""),
            ),
            other => panic!("unexpected path {other}"),
        })
        .await;
        let ctx = test_ctx(server.base.clone(), dir.0.clone());

        let media = upload_file(&Keys::generate(), &ctx, Path::new("doc.pdf"))
            .await
            .expect("legacy fallback succeeds");
        assert_eq!(media.mime_type, "application/pdf");
        assert_eq!(media.url, format!("http://x/media/{sha}.pdf"));

        let first = server.requests.recv().await.expect("primary request");
        let second = server.requests.recv().await.expect("fallback request");
        assert_eq!(first.path, "/upload");
        assert_eq!(second.path, "/media/upload");
        // Fresh auth per attempt: both carry the same x but independently
        // signed events.
        for req in [&first, &second] {
            assert_eq!(req.header("x-sha-256"), Some(sha.as_str()));
        }
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            server.requests.recv(),
        )
        .await
        .expect_err("exactly two attempts");
    }

    #[tokio::test]
    async fn upload_errors_on_missing_directory_and_unsupported_files() {
        let dir = TempDir::new();
        let ctx = test_ctx("http://127.0.0.1:1".to_string(), dir.0.clone());
        let keys = Keys::generate();

        let err = upload_file(&keys, &ctx, Path::new("gone.png"))
            .await
            .unwrap_err();
        assert!(
            matches!(err, AttachmentError::Read { .. }),
            "missing file must be a read error, got {err:?}"
        );
        assert!(
            err.to_string().contains("gone.png"),
            "error names the path: {err}"
        );

        let err = upload_file(&keys, &ctx, Path::new("")).await.unwrap_err();
        assert!(
            matches!(err, AttachmentError::NotAFile(_)),
            "the workspace dir itself is not a file, got {err:?}"
        );

        write_temp_file(&dir.0, "notes.txt", b"hello");
        let err = upload_file(&keys, &ctx, Path::new("notes.txt"))
            .await
            .unwrap_err();
        assert!(
            matches!(err, AttachmentError::UnsupportedType(_)),
            "unsupported extension, got {err:?}"
        );
    }

    #[tokio::test]
    async fn upload_rejects_oversize_before_reading() {
        let dir = TempDir::new();
        let path = dir.0.join("huge.png");
        let file = std::fs::File::create(&path).expect("create sparse file");
        file.set_len(MAX_ATTACHMENT_BYTES + 1)
            .expect("extend sparse file");

        let ctx = test_ctx("http://127.0.0.1:1".to_string(), dir.0.clone());
        let err = upload_file(&Keys::generate(), &ctx, &path)
            .await
            .unwrap_err();
        assert!(
            matches!(
                err,
                AttachmentError::TooLarge { max, .. } if max == MAX_ATTACHMENT_BYTES
            ),
            "50MB+1 image must exceed the image cap, got {err:?}"
        );
    }

    #[test]
    fn video_auth_gets_the_longer_expiry_window() {
        let keys = Keys::generate();
        let sha = "a".repeat(64);
        let header = sign_blossom_upload(&keys, &sha, "video/mp4", "http://relay.example").unwrap();
        let encoded = header.strip_prefix("Nostr ").unwrap();
        let json = URL_SAFE_NO_PAD.decode(encoded).unwrap();
        let event = nostr::Event::from_json(std::str::from_utf8(&json).unwrap()).unwrap();
        let expiration: u64 = event
            .tags
            .iter()
            .find(|t| t.as_slice().first().map(String::as_str) == Some("expiration"))
            .and_then(|t| t.as_slice().get(1).and_then(|v| v.parse().ok()))
            .unwrap();
        let now = nostr::Timestamp::now().as_secs();
        assert!(
            expiration > now + 600 && expiration <= now + 3600,
            "video auth expires within the 3600s window: {expiration}"
        );
    }

    #[test]
    fn filename_sanitization_matches_relay_rules() {
        assert_eq!(
            sanitized_filename(Path::new("/tmp/a/report.pdf")),
            Some("report.pdf".to_string())
        );
        assert_eq!(sanitized_filename(Path::new("/")), None);
        assert_eq!(sanitized_filename(Path::new("back\\slash.png")), None);
        assert_eq!(
            sanitized_filename(Path::new(&format!("{}.png", "x".repeat(300)))),
            None
        );
        assert_eq!(sanitized_filename(Path::new("with\u{7}control.png")), None);
    }
}
