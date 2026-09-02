//! Shared knowledge workspaces: Markdown-backed file collections.
//!
//! Mirrors the TypeScript SDK's `WorkspacesAPI` (ts-sdk/src/workspaces.ts),
//! including its endpoint paths, snake_case wire payloads, access-snapshot
//! projection, and ensure-with-conflict-recovery semantics. Subject options
//! from the TypeScript SDK are deliberately absent: workspaces identity is
//! resolved from the bearer credential, so there is nothing to pass.

use std::collections::BTreeSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Method, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use url::Url;

use crate::{Nullable, DEFAULT_AGENTS_API_BASE};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// Derive the workspaces API base URL from an agents API base URL.
///
/// Mirrors the TypeScript SDK's `deriveWorkspacesApiBase`: an explicit
/// `HYPER_WORKSPACES_API_BASE` environment override wins, then the given
/// agents base, then the default agents base. A path ending in `/workspaces`
/// is kept; a trailing `/agents` segment is replaced; anything else gets
/// `/workspaces` appended.
pub fn derive_workspaces_api_base(
    agents_api_base: Option<&str>,
) -> Result<Url, WorkspacesApiError> {
    let configured = std::env::var("HYPER_WORKSPACES_API_BASE")
        .ok()
        .filter(|value| !value.trim().is_empty());
    derive_workspaces_api_base_from(configured.as_deref(), agents_api_base)
}

fn derive_workspaces_api_base_from(
    configured: Option<&str>,
    agents_api_base: Option<&str>,
) -> Result<Url, WorkspacesApiError> {
    let raw = configured
        .or(agents_api_base)
        .unwrap_or(DEFAULT_AGENTS_API_BASE)
        .trim_end_matches('/');
    let with_scheme = if raw.contains("://") {
        raw.to_owned()
    } else {
        format!("https://{raw}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| WorkspacesApiError::InvalidBaseUrl)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(WorkspacesApiError::InvalidBaseUrl);
    }
    let path = url.path().trim_end_matches('/').to_owned();
    if !path.ends_with("/workspaces") {
        let stem = path.strip_suffix("/agents").unwrap_or(&path);
        url.set_path(&format!("{stem}/workspaces"));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

#[derive(Debug, Error)]
pub enum WorkspacesApiError {
    #[error("API key required for shared knowledge")]
    MissingApiKey,
    #[error("workspaces base URL must be an http(s) hierarchical URL")]
    InvalidBaseUrl,
    #[error("workspaces request could not be sent: {0}")]
    Transport(String),
    #[error("workspaces returned HTTP {status}: {detail}")]
    Api { status: StatusCode, detail: String },
    #[error("workspaces returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl WorkspacesApiError {
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}

fn de_string_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Workspace {
    #[serde(default, deserialize_with = "de_string_default")]
    pub id: String,
    #[serde(default, deserialize_with = "de_string_default")]
    pub name: String,
    #[serde(default, deserialize_with = "de_string_default")]
    pub slug: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, alias = "displaySlug")]
    pub display_slug: Option<String>,
    #[serde(default, alias = "current_role", alias = "currentRole")]
    pub role: Option<String>,
    #[serde(default, alias = "createdAt")]
    pub created_at: Option<String>,
    #[serde(default, alias = "updatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct WorkspaceGrant {
    #[serde(default, deserialize_with = "de_string_default")]
    pub id: String,
    #[serde(default, alias = "workspaceId", deserialize_with = "de_string_default")]
    pub workspace_id: String,
    #[serde(default, alias = "subjectType")]
    pub subject_type: String,
    #[serde(default, alias = "subjectId")]
    pub subject_id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, alias = "displaySlug")]
    pub display_slug: Option<String>,
    #[serde(default, alias = "isOwner")]
    pub is_owner: bool,
    #[serde(default, alias = "expiresAt")]
    pub expires_at: Option<String>,
    #[serde(default, alias = "revokedAt")]
    pub revoked_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
pub enum WorkspaceAccessVisibility {
    #[serde(rename = "all-direct-access")]
    AllDirectAccess,
    #[serde(rename = "current-access-only")]
    CurrentAccessOnly,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceAccessEntry {
    pub workspace_id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub role: String,
    pub display_name: Option<String>,
    pub display_slug: Option<String>,
    pub grants: Vec<WorkspaceGrant>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceAccessSnapshot {
    pub workspace: Workspace,
    pub current_role: Option<String>,
    pub visibility: WorkspaceAccessVisibility,
    pub captured_at: String,
    pub entries: Option<Vec<WorkspaceAccessEntry>>,
    pub grants: Option<Vec<WorkspaceGrant>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceAgentAssociation {
    pub workspace_id: String,
    pub agent_id: String,
    pub role: String,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct WorkspaceFile {
    #[serde(default, deserialize_with = "de_string_default")]
    pub id: String,
    #[serde(default, alias = "workspaceId", deserialize_with = "de_string_default")]
    pub workspace_id: String,
    #[serde(default, deserialize_with = "de_string_default")]
    pub path: String,
    #[serde(default, alias = "displayName", deserialize_with = "de_string_default")]
    pub display_name: String,
    #[serde(default, alias = "currentVersionId")]
    pub current_version_id: Option<String>,
    #[serde(default, alias = "fileState")]
    pub file_state: String,
    #[serde(default, alias = "uploadStatus")]
    pub upload_status: Option<String>,
    #[serde(default, alias = "processingState")]
    pub processing_state: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct WorkspaceFileSearchResult {
    #[serde(flatten)]
    pub file: WorkspaceFile,
    #[serde(default, alias = "matchReasons")]
    pub match_reasons: Vec<String>,
    #[serde(default, alias = "keywordScore")]
    pub keyword_score: f64,
    #[serde(default, alias = "vectorScore")]
    pub vector_score: Option<f64>,
    #[serde(default)]
    pub score: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct WorkspaceManifest {
    #[serde(default, alias = "workspaceId", deserialize_with = "de_string_default")]
    pub workspace_id: String,
    #[serde(default, alias = "workspaceName")]
    pub workspace_name: String,
    #[serde(default, alias = "workspaceSlug")]
    pub workspace_slug: String,
    #[serde(default, alias = "snapshotId")]
    pub snapshot_id: String,
    #[serde(default, alias = "basePath")]
    pub base_path: String,
    #[serde(default, alias = "markdownFiles")]
    pub markdown_files: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct WorkspaceDownloadUrl {
    #[serde(default, alias = "fileId", deserialize_with = "de_string_default")]
    pub file_id: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub version: i64,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default, alias = "downloadCommand")]
    pub download_command: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceFileBytes {
    pub content: Vec<u8>,
    pub path: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceMarkdownFile {
    pub markdown_file: Value,
    pub markdown: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct UpdateWorkspaceRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateWorkspaceGrantRequest {
    pub subject_type: String,
    pub subject_id: String,
    /// Wire default is `viewer` when unset, matching the TypeScript SDK.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Nullable<String>>,
}

impl CreateWorkspaceGrantRequest {
    pub fn new(subject_type: impl Into<String>, subject_id: impl Into<String>) -> Self {
        Self {
            subject_type: subject_type.into(),
            subject_id: subject_id.into(),
            role: None,
            display_name: None,
            display_slug: None,
            expires_at: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct UpdateWorkspaceGrantRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Nullable<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RegisterWorkspaceFileRequest {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
}

impl RegisterWorkspaceFileRequest {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            source_filename: None,
            source_content_type: None,
            source_size_bytes: None,
            source_sha256: None,
            source_etag: None,
            keywords: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct UpdateWorkspaceFileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<Nullable<String>>,
}

#[derive(Clone, Debug, Default)]
pub struct UploadWorkspaceFileOptions {
    pub path: Option<String>,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub source_etag: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WaitUntilProcessedOptions {
    pub timeout: Duration,
    pub poll_interval: Duration,
}

impl Default for WaitUntilProcessedOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(300),
            poll_interval: Duration::from_secs(2),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DownloadWorkspaceFileOptions {
    pub raw: bool,
    pub index: u32,
}

impl Default for DownloadWorkspaceFileOptions {
    fn default() -> Self {
        Self {
            raw: false,
            index: 1,
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EnsureWorkspaceOptions {
    pub name: String,
    pub slug: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EnsureWorkspaceResult {
    pub workspace: Workspace,
    pub created: bool,
}

/// Percent-encode a single path segment, mirroring the TypeScript SDK's
/// `encodeURIComponent`-based `encodeRef` (spaces encode as `%20`).
fn encode_ref(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

/// Percent-encode a file reference segment by segment, mirroring the
/// TypeScript SDK's `encodeFileRef`.
fn encode_file_ref(value: &str) -> String {
    normalize_posix_path(value)
        .trim_start_matches('/')
        .trim_end_matches('/')
        .split('/')
        .map(encode_ref)
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_posix_path(path: &str) -> String {
    let path = path.trim().replace('\\', "/");
    path.strip_prefix("./").map(str::to_owned).unwrap_or(path)
}

fn file_name_from_path(path: &str) -> String {
    let normalized = normalize_posix_path(path);
    let normalized = normalized.trim_start_matches('/').trim_end_matches('/');
    normalized
        .split('/')
        .rfind(|segment| !segment.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if normalized.is_empty() {
                "file".to_owned()
            } else {
                normalized.to_owned()
            }
        })
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = (month as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Parse an RFC 3339 timestamp into epoch milliseconds. Accepts a `Z`
/// designator or an explicit `±HH:MM` offset; anything else is `None`.
fn parse_timestamp_millis(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    if bytes[4] != b'-' || bytes[7] != b'-' || !matches!(bytes[10], b'T' | b't' | b' ') {
        return None;
    }
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let mut rest = &value[19..];
    let mut millis: i64 = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            return None;
        }
        millis = format!("{digits:0<3.3}").parse().ok()?;
        rest = &fraction[digits.len()..];
    }
    let offset_minutes: i64 = match rest {
        "Z" | "z" => 0,
        _ => {
            if rest.len() != 6 {
                return None;
            }
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            if rest.as_bytes()[3] != b':' {
                return None;
            }
            let hours: i64 = rest.get(1..3)?.parse().ok()?;
            let minutes: i64 = rest.get(4..6)?.parse().ok()?;
            sign * (hours * 60 + minutes)
        }
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let local = (((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis;
    Some(local - offset_minutes * 60_000)
}

fn format_timestamp_millis(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let day_secs = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        day_secs / 3600,
        (day_secs / 60) % 60,
        day_secs % 60,
    )
}

fn grant_expiration_timestamp(grant: &WorkspaceGrant) -> Result<i64, WorkspacesApiError> {
    let value = grant.expires_at.as_deref().unwrap_or_default();
    parse_timestamp_millis(value).ok_or_else(|| {
        WorkspacesApiError::InvalidResponse(format!(
            "Invalid expiration timestamp for workspace grant {}: {value}",
            if grant.id.is_empty() {
                "<unknown>"
            } else {
                &grant.id
            },
        ))
    })
}

fn workspace_role_strength(role: &str) -> i32 {
    match role {
        "viewer" => 1,
        "contributor" => 2,
        "admin" => 3,
        _ => 0,
    }
}

fn strongest_workspace_role(grants: &[WorkspaceGrant]) -> String {
    let mut strongest = String::new();
    let mut strongest_value = -1;
    for grant in grants {
        let value = workspace_role_strength(&grant.role);
        if value > strongest_value || (value == strongest_value && grant.role < strongest) {
            strongest = grant.role.clone();
            strongest_value = value;
        }
    }
    strongest
}

fn agreed_non_empty_value<'a>(values: impl Iterator<Item = Option<&'a str>>) -> Option<String> {
    let distinct: BTreeSet<&str> = values.flatten().filter(|value| !value.is_empty()).collect();
    if distinct.len() == 1 {
        distinct.into_iter().next().map(str::to_owned)
    } else {
        None
    }
}

/// Project the raw grant list into per-subject access entries, dropping
/// revoked and expired grants. Mirrors `workspaceAccessEntries` in the
/// TypeScript SDK, including its deterministic sort order.
fn workspace_access_entries(
    grants: &[WorkspaceGrant],
    captured_at_ms: i64,
) -> Result<Vec<WorkspaceAccessEntry>, WorkspacesApiError> {
    let mut keys: Vec<(String, String, String)> = Vec::new();
    let mut groups: Vec<(String, String, String, Vec<WorkspaceGrant>)> = Vec::new();
    for grant in grants {
        if grant.expires_at.is_some() {
            let expires_at_ms = grant_expiration_timestamp(grant)?;
            if expires_at_ms <= captured_at_ms {
                continue;
            }
        }
        if grant.revoked_at.is_some() {
            continue;
        }
        let key = (
            grant.workspace_id.clone(),
            grant.subject_type.clone(),
            grant.subject_id.clone(),
        );
        let index = match keys.iter().position(|existing| existing == &key) {
            Some(index) => index,
            None => {
                keys.push(key.clone());
                groups.push((key.0.clone(), key.1.clone(), key.2.clone(), Vec::new()));
                groups.len() - 1
            }
        };
        groups[index].3.push(grant.clone());
    }
    let mut entries: Vec<WorkspaceAccessEntry> = groups
        .into_iter()
        .map(
            |(workspace_id, subject_type, subject_id, group_grants)| WorkspaceAccessEntry {
                workspace_id,
                subject_type,
                subject_id,
                role: strongest_workspace_role(&group_grants),
                display_name: agreed_non_empty_value(
                    group_grants
                        .iter()
                        .map(|grant| grant.display_name.as_deref()),
                ),
                display_slug: agreed_non_empty_value(
                    group_grants
                        .iter()
                        .map(|grant| grant.display_slug.as_deref()),
                ),
                grants: group_grants,
            },
        )
        .collect();
    entries.sort_by(|left, right| {
        (&left.subject_type, &left.subject_id, &left.workspace_id).cmp(&(
            &right.subject_type,
            &right.subject_id,
            &right.workspace_id,
        ))
    });
    Ok(entries)
}

fn latest_grant_expiration(
    grants: &[WorkspaceGrant],
) -> Result<Option<String>, WorkspacesApiError> {
    if grants.iter().any(|grant| grant.expires_at.is_none()) {
        return Ok(None);
    }
    let mut latest: Option<(i64, String)> = None;
    for grant in grants {
        let value = grant.expires_at.clone().unwrap_or_default();
        let timestamp = grant_expiration_timestamp(grant)?;
        let replace = match &latest {
            None => true,
            Some((latest_timestamp, latest_value)) => {
                timestamp > *latest_timestamp
                    || (timestamp == *latest_timestamp && value > *latest_value)
            }
        };
        if replace {
            latest = Some((timestamp, value));
        }
    }
    Ok(latest.map(|(_, value)| value))
}

fn response_error_detail(status: StatusCode, text: &str) -> String {
    if text.is_empty() {
        return status
            .canonical_reason()
            .unwrap_or("request failed")
            .to_owned();
    }
    if let Ok(payload) = serde_json::from_str::<Value>(text) {
        if let Some(detail) = ["detail", "message", "error"]
            .iter()
            .filter_map(|key| payload.get(key))
            .find(|value| !value.is_null())
        {
            if let Some(detail) = detail.as_str() {
                return detail.to_owned();
            }
            return serde_json::to_string(detail).unwrap_or_else(|_| text.to_owned());
        }
    }
    text.to_owned()
}

async fn handle_response(response: reqwest::Response) -> Result<Value, WorkspacesApiError> {
    let status = response.status();
    if status.as_u16() >= 400 {
        let text = response.text().await.unwrap_or_default();
        return Err(WorkspacesApiError::Api {
            status,
            detail: response_error_detail(status, &text),
        });
    }
    if status == StatusCode::NO_CONTENT || status == StatusCode::RESET_CONTENT {
        return Ok(Value::Null);
    }
    let text = response
        .text()
        .await
        .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text)
        .map_err(|error| WorkspacesApiError::InvalidResponse(error.to_string()))
}

async fn handle_bytes_response(response: reqwest::Response) -> Result<Vec<u8>, WorkspacesApiError> {
    let status = response.status();
    if status.as_u16() >= 400 {
        let text = response.text().await.unwrap_or_default();
        return Err(WorkspacesApiError::Api {
            status,
            detail: response_error_detail(status, &text),
        });
    }
    Ok(response
        .bytes()
        .await
        .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?
        .to_vec())
}

fn find_markdown_file(
    manifest: &WorkspaceManifest,
    file_ref: &str,
) -> Result<Value, WorkspacesApiError> {
    let normalized_ref = normalize_posix_path(file_ref);
    for markdown_file in &manifest.markdown_files {
        let Some(object) = markdown_file.as_object() else {
            continue;
        };
        if file_ref == object.get("file_id").and_then(Value::as_str).unwrap_or("") {
            return Ok(markdown_file.clone());
        }
        let path = object.get("path").and_then(Value::as_str).unwrap_or("");
        if normalized_ref == normalize_posix_path(path) {
            return Ok(markdown_file.clone());
        }
    }
    Err(WorkspacesApiError::InvalidResponse(format!(
        "Shared knowledge Markdown file not found for {file_ref}"
    )))
}

fn workspace_matches_ensure_options(
    workspace: &Workspace,
    options: &EnsureWorkspaceOptions,
    matcher: Option<&dyn Fn(&Workspace) -> bool>,
) -> bool {
    if let Some(matcher) = matcher {
        if matcher(workspace) {
            return true;
        }
    }
    match &options.slug {
        Some(slug) => workspace.slug == *slug,
        None => workspace.name == options.name,
    }
}

/// Async client for the shared knowledge workspaces API.
#[derive(Clone)]
pub struct WorkspacesApiClient {
    api_base: Url,
    api_key: SecretString,
    http: reqwest::Client,
    upload_timeout: Duration,
}

impl WorkspacesApiClient {
    pub fn new(
        api_base: Url,
        api_key: impl Into<SecretString>,
    ) -> Result<Self, WorkspacesApiError> {
        Self::with_timeouts(api_base, api_key, DEFAULT_TIMEOUT, None)
    }

    pub fn with_timeouts(
        api_base: Url,
        api_key: impl Into<SecretString>,
        timeout: Duration,
        upload_timeout: Option<Duration>,
    ) -> Result<Self, WorkspacesApiError> {
        if !matches!(api_base.scheme(), "http" | "https") || api_base.cannot_be_a_base() {
            return Err(WorkspacesApiError::InvalidBaseUrl);
        }
        let api_key = api_key.into();
        if api_key.expose_secret().is_empty() {
            return Err(WorkspacesApiError::MissingApiKey);
        }
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?;
        Ok(Self {
            api_base,
            api_key,
            http,
            upload_timeout: upload_timeout.unwrap_or_else(|| timeout.max(DEFAULT_UPLOAD_TIMEOUT)),
        })
    }

    /// Build a client from an agents API base URL, honoring the
    /// `HYPER_WORKSPACES_API_BASE` environment override.
    pub fn from_agents_api_base(
        agents_api_base: Option<&str>,
        api_key: impl Into<SecretString>,
    ) -> Result<Self, WorkspacesApiError> {
        Self::new(derive_workspaces_api_base(agents_api_base)?, api_key)
    }

    pub fn base_url(&self) -> &Url {
        &self.api_base
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.api_base.as_str().trim_end_matches('/'))
    }

    async fn request<B>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&B>,
    ) -> Result<Value, WorkspacesApiError>
    where
        B: Serialize + ?Sized,
    {
        let mut builder = self
            .http
            .request(method, self.endpoint(path))
            .bearer_auth(self.api_key.expose_secret())
            .query(query);
        if let Some(body) = body {
            builder = builder.json(body);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?;
        handle_response(response).await
    }

    async fn request_bytes<B>(&self, path: &str, body: &B) -> Result<Vec<u8>, WorkspacesApiError>
    where
        B: Serialize + ?Sized,
    {
        let response = self
            .http
            .request(Method::POST, self.endpoint(path))
            .bearer_auth(self.api_key.expose_secret())
            .json(body)
            .send()
            .await
            .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?;
        handle_bytes_response(response).await
    }

    fn decode<T: serde::de::DeserializeOwned>(data: Value) -> Result<T, WorkspacesApiError> {
        serde_json::from_value(data)
            .map_err(|error| WorkspacesApiError::InvalidResponse(error.to_string()))
    }

    fn decode_list<T: serde::de::DeserializeOwned>(
        data: Value,
    ) -> Result<Vec<T>, WorkspacesApiError> {
        match data {
            Value::Null => Ok(Vec::new()),
            Value::Array(_) => Self::decode(data),
            _ => Err(WorkspacesApiError::InvalidResponse(
                "expected an array response".to_owned(),
            )),
        }
    }

    pub async fn list(&self) -> Result<Vec<Workspace>, WorkspacesApiError> {
        let data = self
            .request(Method::GET, "", &[], Option::<&()>::None)
            .await?;
        Self::decode_list(data)
    }

    pub async fn get(&self, workspace_ref: &str) -> Result<Workspace, WorkspacesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!("/{}", encode_ref(workspace_ref)),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode(data)
    }

    pub async fn search(
        &self,
        query: &str,
        vector: Option<bool>,
    ) -> Result<Vec<Workspace>, WorkspacesApiError> {
        let vector = if vector.unwrap_or(true) {
            "true"
        } else {
            "false"
        };
        let data = self
            .request(
                Method::GET,
                "/search",
                &[("q", query), ("vector", vector)],
                Option::<&()>::None,
            )
            .await?;
        Self::decode_list(data)
    }

    pub async fn create(
        &self,
        request: &CreateWorkspaceRequest,
    ) -> Result<Workspace, WorkspacesApiError> {
        let data = self.request(Method::POST, "", &[], Some(request)).await?;
        Self::decode(data)
    }

    pub async fn update(
        &self,
        workspace_ref: &str,
        request: &UpdateWorkspaceRequest,
    ) -> Result<Workspace, WorkspacesApiError> {
        let data = self
            .request(
                Method::PATCH,
                &format!("/{}", encode_ref(workspace_ref)),
                &[],
                Some(request),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn delete(&self, workspace_ref: &str) -> Result<(), WorkspacesApiError> {
        self.request(
            Method::DELETE,
            &format!("/{}", encode_ref(workspace_ref)),
            &[],
            Option::<&()>::None,
        )
        .await?;
        Ok(())
    }

    /// Return the existing workspace matching `options`, creating it when
    /// absent. On a create conflict (HTTP 409) the list is re-read once and a
    /// recovered match is returned instead of the error.
    pub async fn ensure_workspace(
        &self,
        options: &EnsureWorkspaceOptions,
    ) -> Result<EnsureWorkspaceResult, WorkspacesApiError> {
        self.ensure_workspace_inner(options, None).await
    }

    /// Like [`Self::ensure_workspace`], with an additional custom predicate
    /// consulted before the slug and name comparisons.
    pub async fn ensure_workspace_matching(
        &self,
        options: &EnsureWorkspaceOptions,
        matcher: impl Fn(&Workspace) -> bool,
    ) -> Result<EnsureWorkspaceResult, WorkspacesApiError> {
        self.ensure_workspace_inner(options, Some(&matcher)).await
    }

    async fn ensure_workspace_inner(
        &self,
        options: &EnsureWorkspaceOptions,
        matcher: Option<&dyn Fn(&Workspace) -> bool>,
    ) -> Result<EnsureWorkspaceResult, WorkspacesApiError> {
        let listed = self.list().await?;
        if let Some(existing) = listed
            .into_iter()
            .find(|workspace| workspace_matches_ensure_options(workspace, options, matcher))
        {
            return Ok(EnsureWorkspaceResult {
                workspace: existing,
                created: false,
            });
        }
        let create = CreateWorkspaceRequest {
            name: options.name.clone(),
            slug: options.slug.clone(),
            description: options.description.clone(),
        };
        match self.create(&create).await {
            Ok(workspace) => Ok(EnsureWorkspaceResult {
                workspace,
                created: true,
            }),
            Err(error) => {
                if error.status() != Some(StatusCode::CONFLICT) {
                    return Err(error);
                }
                let recovered = self.list().await?;
                if let Some(workspace) = recovered
                    .into_iter()
                    .find(|workspace| workspace_matches_ensure_options(workspace, options, matcher))
                {
                    return Ok(EnsureWorkspaceResult {
                        workspace,
                        created: false,
                    });
                }
                Err(error)
            }
        }
    }

    pub async fn grant(
        &self,
        workspace_ref: &str,
        request: &CreateWorkspaceGrantRequest,
    ) -> Result<WorkspaceGrant, WorkspacesApiError> {
        let mut body = serde_json::to_value(request)
            .map_err(|error| WorkspacesApiError::InvalidResponse(error.to_string()))?;
        if let Some(object) = body.as_object_mut() {
            object
                .entry("role")
                .or_insert_with(|| Value::String("viewer".to_owned()));
        }
        let data = self
            .request(
                Method::POST,
                &format!("/{}/grants", encode_ref(workspace_ref)),
                &[],
                Some(&body),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn list_grants(
        &self,
        workspace_ref: &str,
    ) -> Result<Vec<WorkspaceGrant>, WorkspacesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!("/{}/grants", encode_ref(workspace_ref)),
                &[],
                Option::<&()>::None,
            )
            .await?;
        match data {
            Value::Array(_) => Self::decode(data),
            _ => Err(WorkspacesApiError::InvalidResponse(
                "Workspace grants response must be an array.".to_owned(),
            )),
        }
    }

    pub async fn update_grant(
        &self,
        workspace_ref: &str,
        grant_id: &str,
        request: &UpdateWorkspaceGrantRequest,
    ) -> Result<WorkspaceGrant, WorkspacesApiError> {
        let data = self
            .request(
                Method::PATCH,
                &format!(
                    "/{}/grants/{}",
                    encode_ref(workspace_ref),
                    encode_ref(grant_id)
                ),
                &[],
                Some(request),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn revoke_grant(
        &self,
        workspace_ref: &str,
        grant_id: &str,
    ) -> Result<(), WorkspacesApiError> {
        self.request(
            Method::DELETE,
            &format!(
                "/{}/grants/{}",
                encode_ref(workspace_ref),
                encode_ref(grant_id)
            ),
            &[],
            Option::<&()>::None,
        )
        .await?;
        Ok(())
    }

    pub async fn access_snapshot(
        &self,
        workspace_ref: &str,
    ) -> Result<WorkspaceAccessSnapshot, WorkspacesApiError> {
        self.access_snapshot_at(workspace_ref, SystemTime::now())
            .await
    }

    async fn access_snapshot_at(
        &self,
        workspace_ref: &str,
        captured: SystemTime,
    ) -> Result<WorkspaceAccessSnapshot, WorkspacesApiError> {
        let workspace = self.get(workspace_ref).await?;
        let captured_ms = captured
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        let captured_at = format_timestamp_millis(captured_ms);
        let current_role = workspace.role.clone();
        if current_role.as_deref() != Some("admin") {
            return Ok(WorkspaceAccessSnapshot {
                workspace,
                current_role,
                visibility: WorkspaceAccessVisibility::CurrentAccessOnly,
                captured_at,
                entries: None,
                grants: None,
            });
        }
        let grants = self.list_grants(workspace_ref).await?;
        let entries = workspace_access_entries(&grants, captured_ms)?;
        Ok(WorkspaceAccessSnapshot {
            workspace,
            current_role,
            visibility: WorkspaceAccessVisibility::AllDirectAccess,
            captured_at,
            entries: Some(entries),
            grants: Some(grants),
        })
    }

    /// Project the admin access directory down to agent associations.
    /// Non-admin callers are rejected because the grants route is only
    /// visible to workspace admins.
    pub async fn list_agent_associations(
        &self,
        workspace_ref: &str,
    ) -> Result<Vec<WorkspaceAgentAssociation>, WorkspacesApiError> {
        let snapshot = self.access_snapshot(workspace_ref).await?;
        if snapshot.visibility != WorkspaceAccessVisibility::AllDirectAccess
            || snapshot.entries.is_none()
        {
            return Err(WorkspacesApiError::InvalidResponse(
                "Workspace agent associations are available only to Workspace admins.".to_owned(),
            ));
        }
        let mut associations = Vec::new();
        for entry in snapshot.entries.unwrap_or_default() {
            if entry.subject_type != "agent" {
                continue;
            }
            associations.push(WorkspaceAgentAssociation {
                workspace_id: entry.workspace_id,
                agent_id: entry.subject_id,
                role: entry.role,
                expires_at: latest_grant_expiration(&entry.grants)?,
            });
        }
        Ok(associations)
    }

    pub async fn register_file(
        &self,
        workspace_ref: &str,
        request: &RegisterWorkspaceFileRequest,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let data = self
            .request(
                Method::POST,
                &format!("/{}/files", encode_ref(workspace_ref)),
                &[],
                Some(request),
            )
            .await?;
        Self::decode(data)
    }

    /// Upload raw file bytes as multipart form data to the workspaces upload
    /// endpoint. Uses the client's upload timeout, not the request timeout.
    pub async fn upload_file(
        &self,
        workspace_ref: &str,
        content: Vec<u8>,
        options: &UploadWorkspaceFileOptions,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let filename = options
            .filename
            .clone()
            .filter(|filename| !filename.is_empty())
            .unwrap_or_else(|| "upload".to_owned());
        let mut part = reqwest::multipart::Part::bytes(content).file_name(filename);
        if let Some(content_type) = &options.content_type {
            part = part
                .mime_str(content_type)
                .map_err(|error| WorkspacesApiError::InvalidResponse(error.to_string()))?;
        }
        let mut form = reqwest::multipart::Form::new()
            .text("workspace", workspace_ref.to_owned())
            .part("file", part);
        if let Some(path) = &options.path {
            form = form.text("path", path.clone());
        }
        if let Some(source_etag) = &options.source_etag {
            form = form.text("source_etag", source_etag.clone());
        }
        let response = self
            .http
            .post(self.endpoint("/upload"))
            .bearer_auth(self.api_key.expose_secret())
            .timeout(self.upload_timeout)
            .multipart(form)
            .send()
            .await
            .map_err(|error| WorkspacesApiError::Transport(error.to_string()))?;
        Self::decode(handle_response(response).await?)
    }

    pub async fn get_file(
        &self,
        workspace_ref: &str,
        file_ref: &str,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!(
                    "/{}/files/{}",
                    encode_ref(workspace_ref),
                    encode_file_ref(file_ref)
                ),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode(data)
    }

    pub async fn update_file(
        &self,
        workspace_ref: &str,
        file_ref: &str,
        request: &UpdateWorkspaceFileRequest,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let data = self
            .request(
                Method::PATCH,
                &format!(
                    "/{}/files/{}",
                    encode_ref(workspace_ref),
                    encode_file_ref(file_ref)
                ),
                &[],
                Some(request),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn regenerate_file(
        &self,
        workspace_ref: &str,
        file_ref: &str,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let data = self
            .request(
                Method::POST,
                &format!(
                    "/{}/files/{}/regenerate",
                    encode_ref(workspace_ref),
                    encode_file_ref(file_ref)
                ),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode(data)
    }

    /// Poll `get_file` until the file is processed, fails, or the timeout
    /// elapses. Mirrors the TypeScript SDK's `waitUntilProcessed`.
    pub async fn wait_until_processed(
        &self,
        workspace_ref: &str,
        file_ref: &str,
        options: Option<WaitUntilProcessedOptions>,
    ) -> Result<WorkspaceFile, WorkspacesApiError> {
        let options = options.unwrap_or_default();
        let started = std::time::Instant::now();
        while started.elapsed() < options.timeout {
            let file = self.get_file(workspace_ref, file_ref).await?;
            if file.file_state == "processed"
                && file.processing_state.as_deref() == Some("processed")
            {
                return Ok(file);
            }
            if matches!(file.file_state.as_str(), "failed" | "deleted")
                || matches!(file.processing_state.as_deref(), Some("failed" | "deleted"))
            {
                return Err(WorkspacesApiError::InvalidResponse(format!(
                    "Shared knowledge file {file_ref} is {} with processing {}",
                    file.file_state,
                    file.processing_state.as_deref().unwrap_or("unknown"),
                )));
            }
            tokio::time::sleep(options.poll_interval).await;
        }
        Err(WorkspacesApiError::InvalidResponse(format!(
            "Shared knowledge file {file_ref} did not process within {}ms",
            options.timeout.as_millis(),
        )))
    }

    pub async fn list_files(
        &self,
        workspace_ref: &str,
    ) -> Result<Vec<WorkspaceFile>, WorkspacesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!("/{}/files", encode_ref(workspace_ref)),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode_list(data)
    }

    pub async fn search_files(
        &self,
        workspace_ref: &str,
        query: &str,
        vector: Option<bool>,
    ) -> Result<Vec<WorkspaceFileSearchResult>, WorkspacesApiError> {
        let vector = if vector.unwrap_or(true) {
            "true"
        } else {
            "false"
        };
        let data = self
            .request(
                Method::GET,
                &format!("/{}/files/search", encode_ref(workspace_ref)),
                &[("q", query), ("vector", vector)],
                Option::<&()>::None,
            )
            .await?;
        Self::decode_list(data)
    }

    pub async fn manifest(
        &self,
        workspace_ref: &str,
    ) -> Result<WorkspaceManifest, WorkspacesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!("/{}/manifest", encode_ref(workspace_ref)),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode(data)
    }

    pub async fn download_url(
        &self,
        workspace_ref: &str,
        file_ref: &str,
    ) -> Result<WorkspaceDownloadUrl, WorkspacesApiError> {
        let data = self
            .request(
                Method::POST,
                "/download-url",
                &[],
                Some(&json!({ "workspace": workspace_ref, "path": file_ref })),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn download_file_bytes(
        &self,
        workspace_ref: &str,
        file_ref: &str,
        options: Option<DownloadWorkspaceFileOptions>,
    ) -> Result<WorkspaceFileBytes, WorkspacesApiError> {
        let options = options.unwrap_or_default();
        let content = self
            .request_bytes(
                "/download",
                &json!({
                    "workspace": workspace_ref,
                    "path": file_ref,
                    "raw": options.raw,
                    "index": options.index,
                }),
            )
            .await?;
        Ok(WorkspaceFileBytes {
            content,
            path: file_ref.to_owned(),
            name: file_name_from_path(file_ref),
        })
    }

    pub async fn delete_file(
        &self,
        workspace_ref: &str,
        file_ref: &str,
    ) -> Result<(), WorkspacesApiError> {
        self.request(
            Method::DELETE,
            &format!(
                "/{}/files/{}",
                encode_ref(workspace_ref),
                encode_file_ref(file_ref)
            ),
            &[],
            Option::<&()>::None,
        )
        .await?;
        Ok(())
    }

    /// Render a manifest entry as Markdown through the workspaces `tomd`
    /// endpoint. The file is located by id or by normalized path.
    pub async fn markdown_file(
        &self,
        workspace_ref: &str,
        file_ref: &str,
    ) -> Result<WorkspaceMarkdownFile, WorkspacesApiError> {
        let manifest = self.manifest(workspace_ref).await?;
        let markdown_file = find_markdown_file(&manifest, file_ref)?;
        let path = markdown_file
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .unwrap_or(file_ref);
        let bytes = self
            .request_bytes(
                "/tomd",
                &json!({ "workspace": workspace_ref, "path": path, "index": 1 }),
            )
            .await?;
        Ok(WorkspaceMarkdownFile {
            markdown_file,
            markdown: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const CAPTURED: &str = "2026-07-22T12:00:00.000Z";

    fn captured_time() -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(parse_timestamp_millis(CAPTURED).unwrap() as u64)
    }

    fn client(server: &Server) -> WorkspacesApiClient {
        WorkspacesApiClient::new(Url::parse(&server.url()).unwrap(), "key").unwrap()
    }

    fn json_response(
        server: &mut Server,
        method: &str,
        path: &str,
        status: usize,
        body: Value,
    ) -> mockito::Mock {
        server
            .mock(method, path)
            .with_status(status)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
    }

    #[test]
    fn derives_workspaces_base_from_agents_base() {
        assert_eq!(
            derive_workspaces_api_base_from(
                None,
                Some("https://api.agents.dev.hypercli.com/agents")
            )
            .unwrap()
            .as_str(),
            "https://api.agents.dev.hypercli.com/workspaces"
        );
        assert_eq!(
            derive_workspaces_api_base_from(None, Some("https://example.com/workspaces"))
                .unwrap()
                .as_str(),
            "https://example.com/workspaces"
        );
        assert_eq!(
            derive_workspaces_api_base_from(Some("https://override.example.com/api"), None)
                .unwrap()
                .as_str(),
            "https://override.example.com/api/workspaces"
        );
        assert_eq!(
            derive_workspaces_api_base_from(None, None)
                .unwrap()
                .as_str(),
            "https://api.hypercli.com/workspaces"
        );
    }

    #[test]
    fn parses_and_formats_rfc3339_timestamps() {
        assert_eq!(
            parse_timestamp_millis("2026-07-22T12:00:00.000Z"),
            Some(1_784_721_600_000)
        );
        assert_eq!(
            parse_timestamp_millis("2026-07-22T14:30:00+02:30"),
            parse_timestamp_millis("2026-07-22T12:00:00Z")
        );
        assert_eq!(
            parse_timestamp_millis("2026-07-22T12:00:00.5Z"),
            parse_timestamp_millis("2026-07-22T12:00:00.500Z")
        );
        assert_eq!(parse_timestamp_millis("not-a-timestamp"), None);
        assert_eq!(parse_timestamp_millis("2026-07-22T12:00:00"), None);
        assert_eq!(format_timestamp_millis(1_784_721_600_000), CAPTURED);
    }

    #[test]
    fn encodes_refs_and_file_refs() {
        assert_eq!(encode_ref("team knowledge/#1"), "team%20knowledge%2F%231");
        assert_eq!(
            encode_file_ref("docs/research #1?.md"),
            "docs/research%20%231%3F.md"
        );
        assert_eq!(file_name_from_path("docs/source.md"), "source.md");
        assert_eq!(file_name_from_path("./docs\\source.md"), "source.md");
    }

    #[tokio::test]
    async fn creates_workspaces_with_bearer_auth() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/")
            .match_header("authorization", "Bearer key")
            .match_body(Matcher::Json(
                json!({ "name": "Demo Workspace", "slug": "demo" }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({ "id": "workspace-1", "name": "Demo Workspace", "slug": "demo" })
                    .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let workspace = client(&server)
            .create(&CreateWorkspaceRequest {
                name: "Demo Workspace".to_owned(),
                slug: Some("demo".to_owned()),
                description: None,
            })
            .await
            .unwrap();
        assert_eq!(workspace.slug, "demo");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn gets_workspaces_by_reference_and_normalizes_metadata() {
        let mut server = Server::new_async().await;
        let mock = json_response(
            &mut server,
            "GET",
            "/team%20knowledge",
            200,
            json!({
                "id": "workspace-1",
                "name": "Team Knowledge",
                "slug": "team-knowledge",
                "display_name": "Team Docs",
                "display_slug": "team-docs",
                "description": "Shared runbooks",
                "role": "admin",
                "created_at": "2026-07-20T10:00:00Z",
                "updated_at": "2026-07-21T11:00:00Z"
            }),
        )
        .create_async()
        .await;
        let workspace = client(&server).get("team knowledge").await.unwrap();
        assert_eq!(workspace.display_name.as_deref(), Some("Team Docs"));
        assert_eq!(workspace.display_slug.as_deref(), Some("team-docs"));
        assert_eq!(workspace.role.as_deref(), Some("admin"));
        assert_eq!(
            workspace.created_at.as_deref(),
            Some("2026-07-20T10:00:00Z")
        );
        assert_eq!(
            workspace.updated_at.as_deref(),
            Some("2026-07-21T11:00:00Z")
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn builds_admin_access_directory_from_workspace_and_grants() {
        let mut server = Server::new_async().await;
        let workspace_mock = json_response(
            &mut server,
            "GET",
            "/team%20knowledge%2F%231",
            200,
            json!({ "id": "workspace-1", "name": "Team", "slug": "team", "role": "admin" }),
        )
        .create_async()
        .await;
        let grants_payload = json!([
            { "id": "agent-admin", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "shared-id", "role": "admin", "display_name": "Research Agent", "display_slug": "research-a", "expires_at": "2026-09-01T00:00:00Z", "revoked_at": null },
            { "id": "agent-viewer", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "shared-id", "role": "viewer", "display_name": "", "display_slug": "research-b", "expires_at": "2026-08-01T00:00:00Z", "revoked_at": null },
            { "id": "user-contributor", "workspace_id": "workspace-1", "subject_type": "user", "subject_id": "shared-id", "role": "contributor", "display_name": "Alice", "display_slug": "alice", "expires_at": null, "revoked_at": null },
            { "id": "user-viewer", "workspace_id": "workspace-1", "subject_type": "user", "subject_id": "shared-id", "role": "viewer", "display_name": "Alicia", "display_slug": "alice", "expires_at": "2026-10-01T00:00:00Z", "revoked_at": null },
            { "id": "revoked", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "revoked-agent", "role": "admin", "expires_at": null, "revoked_at": "2026-07-20T00:00:00Z" },
            { "id": "expired", "workspace_id": "workspace-1", "subject_type": "user", "subject_id": "expired-user", "role": "admin", "expires_at": "2026-07-21T00:00:00Z", "revoked_at": null },
            { "id": "boundary", "workspace_id": "workspace-1", "subject_type": "user", "subject_id": "boundary-user", "role": "admin", "expires_at": "2026-07-22T12:00:00.000Z", "revoked_at": null }
        ]);
        let grants_mock = json_response(
            &mut server,
            "GET",
            "/team%20knowledge%2F%231/grants",
            200,
            grants_payload.clone(),
        )
        .create_async()
        .await;

        let snapshot = client(&server)
            .access_snapshot_at("team knowledge/#1", captured_time())
            .await
            .unwrap();

        assert_eq!(
            snapshot.visibility,
            WorkspaceAccessVisibility::AllDirectAccess
        );
        assert_eq!(snapshot.current_role.as_deref(), Some("admin"));
        assert_eq!(snapshot.captured_at, CAPTURED);
        let grants = snapshot.grants.unwrap();
        let expected_ids: Vec<String> = grants_payload
            .as_array()
            .unwrap()
            .iter()
            .map(|grant| grant["id"].as_str().unwrap().to_owned())
            .collect();
        let actual_ids: Vec<String> = grants.iter().map(|grant| grant.id.clone()).collect();
        assert_eq!(actual_ids, expected_ids);
        let entries = snapshot.entries.unwrap();
        let subjects: Vec<(&str, &str)> = entries
            .iter()
            .map(|entry| (entry.subject_type.as_str(), entry.subject_id.as_str()))
            .collect();
        assert_eq!(subjects, [("agent", "shared-id"), ("user", "shared-id")]);
        assert_eq!(entries[0].workspace_id, "workspace-1");
        assert_eq!(entries[0].role, "admin");
        assert_eq!(entries[0].display_name.as_deref(), Some("Research Agent"));
        assert_eq!(entries[0].display_slug, None);
        let entry_grant_ids: Vec<&str> = entries[0]
            .grants
            .iter()
            .map(|grant| grant.id.as_str())
            .collect();
        assert_eq!(entry_grant_ids, ["agent-admin", "agent-viewer"]);
        assert_eq!(entries[1].role, "contributor");
        assert_eq!(entries[1].display_name, None);
        assert_eq!(entries[1].display_slug.as_deref(), Some("alice"));
        workspace_mock.assert_async().await;
        grants_mock.assert_async().await;
    }

    #[tokio::test]
    async fn skips_grants_route_for_non_admin_roles() {
        for role in ["viewer", "contributor"] {
            let mut server = Server::new_async().await;
            let workspace_mock = json_response(
                &mut server,
                "GET",
                "/team",
                200,
                json!({ "id": "workspace-1", "name": "Team", "slug": "team", "role": role }),
            )
            .create_async()
            .await;
            let grants_mock = server
                .mock("GET", "/team/grants")
                .expect(0)
                .create_async()
                .await;

            let snapshot = client(&server)
                .access_snapshot_at("team", captured_time())
                .await
                .unwrap();

            assert_eq!(snapshot.current_role.as_deref(), Some(role));
            assert_eq!(
                snapshot.visibility,
                WorkspaceAccessVisibility::CurrentAccessOnly
            );
            assert_eq!(snapshot.captured_at, CAPTURED);
            assert_eq!(snapshot.entries, None);
            assert_eq!(snapshot.grants, None);
            workspace_mock.assert_async().await;
            grants_mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn rejects_invalid_grant_expiration_timestamps() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/team",
            200,
            json!({ "id": "workspace-1", "name": "Team", "slug": "team", "role": "admin" }),
        )
        .create_async()
        .await;
        json_response(
            &mut server,
            "GET",
            "/team/grants",
            200,
            json!([
                { "id": "invalid-expiration", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-1", "role": "viewer", "expires_at": "not-a-timestamp", "revoked_at": null }
            ]),
        )
        .create_async()
        .await;

        let error = client(&server)
            .access_snapshot_at("team", captured_time())
            .await
            .unwrap_err();
        assert!(matches!(error, WorkspacesApiError::InvalidResponse(_)));
        assert_eq!(
            error.to_string(),
            "workspaces returned an invalid response: Invalid expiration timestamp for workspace grant invalid-expiration: not-a-timestamp"
        );
    }

    #[tokio::test]
    async fn rejects_malformed_grants_payload() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/team",
            200,
            json!({ "id": "workspace-1", "name": "Team", "slug": "team", "role": "admin" }),
        )
        .create_async()
        .await;
        json_response(
            &mut server,
            "GET",
            "/team/grants",
            200,
            json!({ "grants": [] }),
        )
        .create_async()
        .await;

        let error = client(&server)
            .access_snapshot_at("team", captured_time())
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "workspaces returned an invalid response: Workspace grants response must be an array."
        );
    }

    #[tokio::test]
    async fn projects_agent_associations_for_admins() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/team",
            200,
            json!({ "id": "workspace-1", "name": "Team", "slug": "team", "role": "admin" }),
        )
        .create_async()
        .await;
        json_response(
            &mut server,
            "GET",
            "/team/grants",
            200,
            json!([
                { "id": "agent-1-admin", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-1", "role": "admin", "expires_at": "2036-09-01T00:00:00Z", "revoked_at": null },
                { "id": "agent-1-viewer", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-1", "role": "viewer", "expires_at": "2036-08-01T00:00:00Z", "revoked_at": null },
                { "id": "agent-2-viewer", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-2", "role": "viewer", "expires_at": null, "revoked_at": null },
                { "id": "agent-2-contributor", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-2", "role": "contributor", "expires_at": "2036-10-01T00:00:00Z", "revoked_at": null },
                { "id": "user-admin", "workspace_id": "workspace-1", "subject_type": "user", "subject_id": "user-1", "role": "admin", "expires_at": null, "revoked_at": null }
            ]),
        )
        .create_async()
        .await;

        let associations = client(&server)
            .list_agent_associations("team")
            .await
            .unwrap();
        assert_eq!(
            associations,
            vec![
                WorkspaceAgentAssociation {
                    workspace_id: "workspace-1".to_owned(),
                    agent_id: "agent-1".to_owned(),
                    role: "admin".to_owned(),
                    expires_at: Some("2036-09-01T00:00:00Z".to_owned()),
                },
                WorkspaceAgentAssociation {
                    workspace_id: "workspace-1".to_owned(),
                    agent_id: "agent-2".to_owned(),
                    role: "contributor".to_owned(),
                    expires_at: None,
                },
            ]
        );
    }

    #[tokio::test]
    async fn rejects_agent_associations_for_non_admins() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/viewer",
            200,
            json!({ "id": "workspace-2", "name": "Viewer", "slug": "viewer", "role": "viewer" }),
        )
        .create_async()
        .await;
        let grants_mock = server
            .mock("GET", "/viewer/grants")
            .expect(0)
            .create_async()
            .await;

        let error = client(&server)
            .list_agent_associations("viewer")
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "workspaces returned an invalid response: Workspace agent associations are available only to Workspace admins."
        );
        grants_mock.assert_async().await;
    }

    #[tokio::test]
    async fn ensure_workspace_returns_existing_match_without_creating() {
        let mut server = Server::new_async().await;
        let list_mock = json_response(
            &mut server,
            "GET",
            "/",
            200,
            json!([{ "id": "workspace-general", "name": "General", "slug": "general" }]),
        )
        .create_async()
        .await;
        let create_mock = server.mock("POST", "/").expect(0).create_async().await;

        let result = client(&server)
            .ensure_workspace(&EnsureWorkspaceOptions {
                name: "General".to_owned(),
                slug: Some("general".to_owned()),
                description: None,
            })
            .await
            .unwrap();
        assert!(!result.created);
        assert_eq!(result.workspace.id, "workspace-general");
        list_mock.assert_async().await;
        create_mock.assert_async().await;
    }

    #[tokio::test]
    async fn ensure_workspace_creates_when_no_match_exists() {
        let mut server = Server::new_async().await;
        let list_mock = json_response(&mut server, "GET", "/", 200, json!([]))
            .create_async()
            .await;
        let create_mock = server
            .mock("POST", "/")
            .match_body(Matcher::Json(
                json!({ "name": "General", "slug": "general" }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({ "id": "workspace-general", "name": "General", "slug": "general" })
                    .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let result = client(&server)
            .ensure_workspace(&EnsureWorkspaceOptions {
                name: "General".to_owned(),
                slug: Some("general".to_owned()),
                description: None,
            })
            .await
            .unwrap();
        assert!(result.created);
        assert_eq!(result.workspace.id, "workspace-general");
        list_mock.assert_async().await;
        create_mock.assert_async().await;
    }

    #[tokio::test]
    async fn ensure_workspace_recovers_after_create_conflict() {
        let mut server = Server::new_async().await;
        let first_list = json_response(&mut server, "GET", "/", 200, json!([]))
            .create_async()
            .await;
        let create = server
            .mock("POST", "/")
            .with_status(409)
            .with_header("content-type", "application/json")
            .with_body(json!({ "detail": "Workspace slug already exists" }).to_string())
            .expect(1)
            .create_async()
            .await;
        let second_list = json_response(
            &mut server,
            "GET",
            "/",
            200,
            json!([{ "id": "workspace-general", "name": "General", "slug": "general" }]),
        )
        .create_async()
        .await;

        let result = client(&server)
            .ensure_workspace(&EnsureWorkspaceOptions {
                name: "General".to_owned(),
                slug: Some("general".to_owned()),
                description: None,
            })
            .await
            .unwrap();
        assert!(!result.created);
        assert_eq!(result.workspace.id, "workspace-general");
        first_list.assert_async().await;
        create.assert_async().await;
        second_list.assert_async().await;
    }

    #[tokio::test]
    async fn ensure_workspace_reraises_conflict_without_recovered_match() {
        let mut server = Server::new_async().await;
        json_response(&mut server, "GET", "/", 200, json!([]))
            .create_async()
            .await;
        server
            .mock("POST", "/")
            .with_status(409)
            .with_header("content-type", "application/json")
            .with_body(json!({ "detail": "Workspace slug already exists" }).to_string())
            .expect(1)
            .create_async()
            .await;
        json_response(&mut server, "GET", "/", 200, json!([]))
            .create_async()
            .await;

        let error = client(&server)
            .ensure_workspace(&EnsureWorkspaceOptions {
                name: "General".to_owned(),
                slug: Some("general".to_owned()),
                description: None,
            })
            .await
            .unwrap_err();
        match error {
            WorkspacesApiError::Api { status, detail } => {
                assert_eq!(status, StatusCode::CONFLICT);
                assert_eq!(detail, "Workspace slug already exists");
            }
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn preserves_plain_text_and_structured_error_details() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/")
            .with_status(503)
            .with_body("Workspace service unavailable")
            .expect(1)
            .create_async()
            .await;
        let error = client(&server).list().await.unwrap_err();
        match error {
            WorkspacesApiError::Api { status, detail } => {
                assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
                assert_eq!(detail, "Workspace service unavailable");
            }
            other => panic!("{other:?}"),
        }

        let mut server = Server::new_async().await;
        server
            .mock("POST", "/")
            .with_status(422)
            .with_header("content-type", "application/json")
            .with_body(
                json!({ "detail": [{ "loc": ["body", "name"], "msg": "Required" }] }).to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let error = client(&server)
            .create(&CreateWorkspaceRequest {
                name: String::new(),
                slug: None,
                description: None,
            })
            .await
            .unwrap_err();
        match error {
            WorkspacesApiError::Api { status, detail } => {
                assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
                assert_eq!(detail, r#"[{"loc":["body","name"],"msg":"Required"}]"#);
            }
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn searches_workspaces_through_search_endpoint() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/search")
            .match_query(Matcher::Exact("q=launch+handoff&vector=true".into()))
            .match_header("authorization", "Bearer key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{ "id": "workspace-1", "name": "Team Knowledge", "slug": "team-knowledge" }])
                    .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let workspaces = client(&server)
            .search("launch handoff", None)
            .await
            .unwrap();
        assert_eq!(workspaces[0].slug, "team-knowledge");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn searches_files_with_vector_disabled() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/demo/files/search")
            .match_query(Matcher::Exact("q=brief&vector=false".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "path": "docs/brief.md",
                    "display_name": "brief.md",
                    "current_version_id": "version-1",
                    "file_state": "processed",
                    "upload_status": "uploaded",
                    "processing_state": "processed",
                    "match_reasons": ["keyword"],
                    "keyword_score": 0.8,
                    "vector_score": null,
                    "score": 0.8
                }])
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let files = client(&server)
            .search_files("demo", "brief", Some(false))
            .await
            .unwrap();
        assert_eq!(files[0].file.path, "docs/brief.md");
        assert_eq!(files[0].match_reasons, ["keyword"]);
        assert_eq!(files[0].vector_score, None);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn updates_and_deletes_workspaces() {
        let mut server = Server::new_async().await;
        let update_mock = server
            .mock("PATCH", "/demo")
            .match_body(Matcher::Json(
                json!({ "name": "Renamed", "slug": "renamed" }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({ "id": "workspace-1", "name": "Renamed", "slug": "renamed" }).to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let delete_mock = server
            .mock("DELETE", "/renamed")
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        let client = client(&server);
        let workspace = client
            .update(
                "demo",
                &UpdateWorkspaceRequest {
                    name: Some("Renamed".to_owned()),
                    slug: Some("renamed".to_owned()),
                    description: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(workspace.slug, "renamed");
        client.delete("renamed").await.unwrap();
        update_mock.assert_async().await;
        delete_mock.assert_async().await;
    }

    #[tokio::test]
    async fn creates_and_updates_grants_with_display_and_expiry_fields() {
        let mut server = Server::new_async().await;
        let grant_mock = server
            .mock("POST", "/team%20knowledge/grants")
            .match_body(Matcher::Json(json!({
                "subject_type": "agent",
                "subject_id": "agent-1",
                "role": "viewer",
                "display_name": "Research Agent",
                "display_slug": "research-agent",
                "expires_at": "2026-08-01T00:00:00Z"
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "grant-1",
                    "workspace_id": "workspace-1",
                    "subject_type": "agent",
                    "subject_id": "agent-1",
                    "role": "viewer",
                    "display_name": "Research Agent",
                    "display_slug": "research-agent",
                    "is_owner": true,
                    "expires_at": "2026-08-01T00:00:00Z",
                    "revoked_at": null
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let update_mock = server
            .mock("PATCH", "/team%20knowledge/grants/grant%2F%231")
            .match_body(Matcher::Json(
                json!({ "role": "admin", "expires_at": null }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "grant-1",
                    "workspace_id": "workspace-1",
                    "subject_type": "agent",
                    "subject_id": "agent-1",
                    "role": "admin",
                    "display_name": "Research Agent",
                    "display_slug": "research-agent",
                    "is_owner": false,
                    "expires_at": null,
                    "revoked_at": null
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let client = client(&server);
        let created = client
            .grant(
                "team knowledge",
                &CreateWorkspaceGrantRequest {
                    subject_type: "agent".to_owned(),
                    subject_id: "agent-1".to_owned(),
                    role: Some("viewer".to_owned()),
                    display_name: Some("Research Agent".to_owned()),
                    display_slug: Some("research-agent".to_owned()),
                    expires_at: Some(Nullable::Value("2026-08-01T00:00:00Z".to_owned())),
                },
            )
            .await
            .unwrap();
        assert!(created.is_owner);
        assert_eq!(created.expires_at.as_deref(), Some("2026-08-01T00:00:00Z"));
        let updated = client
            .update_grant(
                "team knowledge",
                "grant/#1",
                &UpdateWorkspaceGrantRequest {
                    role: Some("admin".to_owned()),
                    expires_at: Some(Nullable::Null),
                },
            )
            .await
            .unwrap();
        assert_eq!(updated.role, "admin");
        assert!(!updated.is_owner);
        assert_eq!(updated.expires_at, None);
        grant_mock.assert_async().await;
        update_mock.assert_async().await;
    }

    #[tokio::test]
    async fn lists_and_revokes_grants() {
        let mut server = Server::new_async().await;
        let list_mock = json_response(
            &mut server,
            "GET",
            "/demo/grants",
            200,
            json!([{ "id": "grant-1", "workspace_id": "workspace-1", "subject_type": "agent", "subject_id": "agent-1", "role": "viewer" }]),
        )
        .create_async()
        .await;
        let revoke_mock = server
            .mock("DELETE", "/demo/grants/grant-1")
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        let client = client(&server);
        let grants = client.list_grants("demo").await.unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].id, "grant-1");
        client.revoke_grant("demo", "grant-1").await.unwrap();
        list_mock.assert_async().await;
        revoke_mock.assert_async().await;
    }

    #[tokio::test]
    async fn registers_files_and_fetches_manifests() {
        let mut server = Server::new_async().await;
        let register_mock = server
            .mock("POST", "/demo/files")
            .match_body(Matcher::Json(json!({
                "path": "projects/example/report.pdf",
                "source_sha256": "a".repeat(64),
                "keywords": ["handoff"]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "path": "projects/example/report.pdf",
                    "display_name": "report.pdf",
                    "current_version_id": "version-1",
                    "file_state": "uploaded",
                    "upload_status": "uploaded",
                    "processing_state": "pending"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let manifest_mock = json_response(
            &mut server,
            "GET",
            "/demo/manifest",
            200,
            json!({
                "workspace_id": "workspace-1",
                "workspace_name": "Demo Workspace",
                "workspace_slug": "demo",
                "snapshot_id": "snapshot-1",
                "base_path": "/home/node/shared/demo",
                "markdown_files": [{ "file_id": "file-1", "path": "projects/example/report.pdf", "version": 1, "part_count": 1, "state": "processed", "keywords": ["handoff"], "summary": "Report summary." }]
            }),
        )
        .create_async()
        .await;
        let client = client(&server);
        let file = client
            .register_file(
                "demo",
                &RegisterWorkspaceFileRequest {
                    path: "projects/example/report.pdf".to_owned(),
                    source_filename: None,
                    source_content_type: None,
                    source_size_bytes: None,
                    source_sha256: Some("a".repeat(64)),
                    source_etag: None,
                    keywords: Some(vec!["handoff".to_owned()]),
                },
            )
            .await
            .unwrap();
        assert_eq!(file.processing_state.as_deref(), Some("pending"));
        let manifest = client.manifest("demo").await.unwrap();
        assert_eq!(
            manifest.markdown_files[0]["path"],
            json!("projects/example/report.pdf")
        );
        register_mock.assert_async().await;
        manifest_mock.assert_async().await;
    }

    #[tokio::test]
    async fn uploads_files_with_multipart_form_data() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/upload")
            .match_header("authorization", "Bearer key")
            .match_header(
                "content-type",
                Matcher::Regex(r"multipart/form-data; boundary=.*".into()),
            )
            .match_body(Matcher::Regex(
                r#"(?s)name="workspace".*name="file"; filename="source\.md".*name="path""#.into(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "path": "docs/source.md",
                    "display_name": "source.md",
                    "current_version_id": "version-1",
                    "file_state": "uploaded",
                    "upload_status": "uploaded",
                    "processing_state": "pending"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let file = client(&server)
            .upload_file(
                "demo",
                b"hello".to_vec(),
                &UploadWorkspaceFileOptions {
                    path: Some("docs/source.md".to_owned()),
                    filename: Some("source.md".to_owned()),
                    content_type: Some("text/markdown".to_owned()),
                    source_etag: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(file.path, "docs/source.md");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn waits_for_processed_files() {
        let mut server = Server::new_async().await;
        let mock = json_response(
            &mut server,
            "GET",
            "/demo/files/docs/source.md",
            200,
            json!({
                "id": "file-1",
                "workspace_id": "workspace-1",
                "path": "docs/source.md",
                "display_name": "source.md",
                "current_version_id": "version-1",
                "file_state": "processed",
                "upload_status": "uploaded",
                "processing_state": "processed"
            }),
        )
        .create_async()
        .await;
        let file = client(&server)
            .wait_until_processed(
                "demo",
                "docs/source.md",
                Some(WaitUntilProcessedOptions {
                    timeout: Duration::from_millis(100),
                    poll_interval: Duration::ZERO,
                }),
            )
            .await
            .unwrap();
        assert_eq!(file.file_state, "processed");
        assert_eq!(file.processing_state.as_deref(), Some("processed"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fails_wait_for_failed_files() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/demo/files/docs/source.md",
            200,
            json!({
                "id": "file-1",
                "workspace_id": "workspace-1",
                "path": "docs/source.md",
                "display_name": "source.md",
                "file_state": "failed",
                "upload_status": "uploaded",
                "processing_state": "failed"
            }),
        )
        .create_async()
        .await;
        let error = client(&server)
            .wait_until_processed(
                "demo",
                "docs/source.md",
                Some(WaitUntilProcessedOptions {
                    timeout: Duration::from_millis(100),
                    poll_interval: Duration::ZERO,
                }),
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "workspaces returned an invalid response: Shared knowledge file docs/source.md is failed with processing failed"
        );
    }

    #[tokio::test]
    async fn lists_and_deletes_files() {
        let mut server = Server::new_async().await;
        let list_mock = json_response(
            &mut server,
            "GET",
            "/demo/files",
            200,
            json!([{
                "id": "file-1",
                "workspace_id": "workspace-1",
                "path": "docs/source.md",
                "display_name": "source.md",
                "current_version_id": "version-1",
                "file_state": "uploaded",
                "upload_status": "uploaded",
                "processing_state": "pending"
            }]),
        )
        .create_async()
        .await;
        let delete_mock = server
            .mock("DELETE", "/demo/files/docs/source.md")
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        let client = client(&server);
        let files = client.list_files("demo").await.unwrap();
        assert_eq!(files.len(), 1);
        client.delete_file("demo", "docs/source.md").await.unwrap();
        list_mock.assert_async().await;
        delete_mock.assert_async().await;
    }

    #[tokio::test]
    async fn updates_file_metadata_fields() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("PATCH", "/demo/files/docs/source.md")
            .match_body(Matcher::Json(json!({
                "display_name": "customer-pricing-brief.md",
                "keywords": ["pricing", "retention"],
                "summary": "Pricing retention guidance."
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "path": "docs/source.md",
                    "display_name": "customer-pricing-brief.md",
                    "current_version_id": "version-1",
                    "file_state": "processed",
                    "upload_status": "uploaded",
                    "processing_state": "processed",
                    "keywords": ["pricing", "retention"],
                    "summary": "Pricing retention guidance."
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let file = client(&server)
            .update_file(
                "demo",
                "docs/source.md",
                &UpdateWorkspaceFileRequest {
                    display_name: Some("customer-pricing-brief.md".to_owned()),
                    keywords: Some(vec!["pricing".to_owned(), "retention".to_owned()]),
                    summary: Some(Nullable::Value("Pricing retention guidance.".to_owned())),
                },
            )
            .await
            .unwrap();
        assert_eq!(file.keywords, ["pricing", "retention"]);
        assert_eq!(file.summary.as_deref(), Some("Pricing retention guidance."));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn encodes_grant_and_file_path_segments() {
        let mut server = Server::new_async().await;
        let revoke_mock = server
            .mock("DELETE", "/team%20knowledge/grants/grant%2F%231")
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        let delete_mock = server
            .mock(
                "DELETE",
                "/team%20knowledge/files/docs/research%20%231%3F.md",
            )
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        let client = client(&server);
        client
            .revoke_grant("team knowledge", "grant/#1")
            .await
            .unwrap();
        client
            .delete_file("team knowledge", "docs/research #1?.md")
            .await
            .unwrap();
        revoke_mock.assert_async().await;
        delete_mock.assert_async().await;
    }

    #[tokio::test]
    async fn renders_markdown_file_through_tomd() {
        let mut server = Server::new_async().await;
        let manifest_mock = json_response(
            &mut server,
            "GET",
            "/demo/manifest",
            200,
            json!({
                "workspace_id": "workspace-1",
                "workspace_name": "Demo Workspace",
                "workspace_slug": "demo",
                "snapshot_id": "snapshot-1",
                "base_path": "/home/node/shared/demo",
                "markdown_files": [{ "file_id": "file-1", "path": "docs/source.md", "version": 1, "part_count": 1, "keywords": ["handoff", "launch"], "summary": "Launch handoff notes.", "state": "processed" }]
            }),
        )
        .create_async()
        .await;
        let tomd_mock = server
            .mock("POST", "/tomd")
            .match_body(Matcher::Json(json!({
                "workspace": "demo",
                "path": "docs/source.md",
                "index": 1
            })))
            .with_status(200)
            .with_body("---\npath: \"docs/source.md\"\nkeywords: [\"handoff\",\"launch\"]\nsummary: \"Launch handoff notes.\"\ndownload_command: \"hyper workspaces download demo/docs/source.md --raw\"\n---\n\n# Source\n")
            .expect(1)
            .create_async()
            .await;
        let result = client(&server)
            .markdown_file("demo", "docs/source.md")
            .await
            .unwrap();
        assert_eq!(result.markdown_file["path"], json!("docs/source.md"));
        assert!(result.markdown.contains("path: \"docs/source.md\""));
        assert!(result
            .markdown
            .contains("download_command: \"hyper workspaces download demo/docs/source.md --raw\""));
        manifest_mock.assert_async().await;
        tomd_mock.assert_async().await;
    }

    #[tokio::test]
    async fn errors_when_markdown_file_is_not_in_manifest() {
        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/demo/manifest",
            200,
            json!({
                "workspace_id": "workspace-1",
                "workspace_name": "Demo Workspace",
                "workspace_slug": "demo",
                "snapshot_id": "snapshot-1",
                "base_path": "/home/node/shared/demo",
                "markdown_files": []
            }),
        )
        .create_async()
        .await;
        let error = client(&server)
            .markdown_file("demo", "docs/missing.md")
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "workspaces returned an invalid response: Shared knowledge Markdown file not found for docs/missing.md"
        );
    }

    #[tokio::test]
    async fn downloads_file_bytes_through_download_endpoint() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/download")
            .match_body(Matcher::Json(json!({
                "workspace": "demo",
                "path": "docs/source.md",
                "raw": true,
                "index": 1
            })))
            .with_status(200)
            .with_body("# Source")
            .expect(1)
            .create_async()
            .await;
        let result = client(&server)
            .download_file_bytes(
                "demo",
                "docs/source.md",
                Some(DownloadWorkspaceFileOptions {
                    raw: true,
                    index: 1,
                }),
            )
            .await
            .unwrap();
        assert_eq!(result.path, "docs/source.md");
        assert_eq!(result.name, "source.md");
        assert_eq!(result.content, vec![35u8, 32, 83, 111, 117, 114, 99, 101]);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetches_download_urls() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/download-url")
            .match_body(Matcher::Json(
                json!({ "workspace": "demo", "path": "docs/source.md" }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "file_id": "file-1",
                    "path": "docs/source.md",
                    "version": 2,
                    "url": "https://files.example.com/signed",
                    "download_command": "hyper workspaces download demo/docs/source.md"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let download = client(&server)
            .download_url("demo", "docs/source.md")
            .await
            .unwrap();
        assert_eq!(download.file_id, "file-1");
        assert_eq!(download.version, 2);
        assert_eq!(
            download.url.as_deref(),
            Some("https://files.example.com/signed")
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn regenerates_files() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/demo/files/docs/source.md/regenerate")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "file-1",
                    "workspace_id": "workspace-1",
                    "path": "docs/source.md",
                    "display_name": "source.md",
                    "file_state": "uploaded",
                    "processing_state": "pending"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let file = client(&server)
            .regenerate_file("demo", "docs/source.md")
            .await
            .unwrap();
        assert_eq!(file.processing_state.as_deref(), Some("pending"));
        mock.assert_async().await;
    }

    #[test]
    fn rejects_empty_api_key() {
        let result =
            WorkspacesApiClient::new(Url::parse("http://localhost/workspaces").unwrap(), "");
        assert!(matches!(result, Err(WorkspacesApiError::MissingApiKey)));
    }
}
