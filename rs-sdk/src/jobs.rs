//! GPU jobs product API (`{product}/api/jobs`).
//!
//! Mirrors the Python SDK's `hypercli/jobs.py` (contract authority): tolerant
//! job projections, base64 command encoding, tag normalization, runtime
//! `elapsed`/`time_left` derivation, and the `find_job` helper.

use std::collections::BTreeMap;

use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{HyperCliClient, HyperCliError};

/// Job states after which the job will not consume more runtime.
pub const TERMINAL_JOB_STATES: [&str; 5] =
    ["succeeded", "failed", "terminated", "canceled", "cancelled"];

/// Job tags as either a key/value map or a list of `"key=value"` strings.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum JobTags {
    Map(BTreeMap<String, String>),
    List(Vec<String>),
}

impl JobTags {
    /// Normalize to the wire form used by the API: `"key=value"` strings.
    /// Non-conforming list entries (no `=`) are dropped, matching the Python
    /// SDK.
    pub fn to_list(&self) -> Vec<String> {
        match self {
            Self::Map(tags) => tags
                .iter()
                .map(|(key, value)| format!("{key}={value}"))
                .collect(),
            Self::List(tags) => tags
                .iter()
                .filter(|tag| tag.contains('='))
                .cloned()
                .collect(),
        }
    }

    /// Normalize to a key/value map.
    pub fn to_map(&self) -> BTreeMap<String, String> {
        match self {
            Self::Map(tags) => tags
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            Self::List(tags) => tags
                .iter()
                .filter_map(|tag| tag.split_once('='))
                .map(|(key, value)| (key.to_owned(), value.to_owned()))
                .collect(),
        }
    }
}

fn sys_time_unix_seconds() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

/// Accept a timestamp as a fractional-seconds number, a numeric string, or an
/// ISO/RFC 3339 datetime; anything else becomes `None`.
fn parse_flexible_timestamp(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            if let Ok(parsed) = text.parse::<f64>() {
                return Some(parsed);
            }
            parse_iso_timestamp_seconds(text)
        }
        _ => None,
    }
}

/// Minimal ISO 8601 (`YYYY-MM-DDTHH:MM:SS[.frac][Z|±HH:MM]`) parser, good
/// enough for the server's UTC timestamps.
fn parse_iso_timestamp_seconds(value: &str) -> Option<f64> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    let mut rest = &value[19..];
    let mut fraction = 0.0;
    if let Some(frac) = rest.strip_prefix('.') {
        let digits: String = frac.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            return None;
        }
        fraction = format!("0.{digits}").parse().ok()?;
        rest = &frac[digits.len()..];
    }
    let offset_seconds: i64 = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            if rest.len() != 6 || rest.as_bytes()[3] != b':' {
                return None;
            }
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let hours: i64 = rest.get(1..3)?.parse().ok()?;
            let minutes: i64 = rest.get(4..6)?.parse().ok()?;
            sign * (hours * 3600 + minutes * 60)
        }
    };
    let days = days_from_civil(year, month, day);
    Some((((days * 24 + hour) * 60 + minute) * 60 + second - offset_seconds) as f64 + fraction)
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

/// Compute `elapsed` and `time_left` from the runtime budget and lifecycle
/// timestamps, mirroring the Python SDK's `_derive_runtime_fields`.
fn derive_runtime_fields(
    runtime_seconds: u64,
    state: &str,
    created_at: Option<f64>,
    started_at: Option<f64>,
    completed_at: Option<f64>,
    now: f64,
) -> (u64, u64) {
    if runtime_seconds == 0 {
        return (0, 0);
    }
    let state = state.trim().to_ascii_lowercase();
    if state == "dry_run" {
        return (0, runtime_seconds);
    }
    let terminal = TERMINAL_JOB_STATES.contains(&state.as_str());
    let anchor = started_at.or_else(|| {
        (state == "running" || completed_at.is_some() || terminal)
            .then_some(created_at)
            .flatten()
    });
    let Some(anchor) = anchor else {
        return (0, runtime_seconds);
    };
    let end = completed_at.unwrap_or(now);
    let elapsed = (end - anchor).max(0.0) as u64;
    if completed_at.is_some() || terminal {
        (elapsed, 0)
    } else {
        (elapsed, runtime_seconds.saturating_sub(elapsed))
    }
}

/// Decode the base64 wire form of a job command. Undecodable payloads are
/// exposed verbatim, matching the Python SDK.
fn decode_command(wire: Option<&str>) -> Option<String> {
    use base64::Engine;
    let wire = wire?.trim();
    if wire.is_empty() {
        return None;
    }
    match base64::engine::general_purpose::STANDARD.decode(wire) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(decoded) => Some(decoded),
            Err(_) => Some(wire.to_owned()),
        },
        Err(_) => Some(wire.to_owned()),
    }
}

/// Job projection returned by the jobs API.
#[derive(Clone, Debug)]
pub struct Job {
    pub job_id: String,
    pub job_key: String,
    pub state: String,
    pub gpu_type: String,
    pub gpu_count: u32,
    pub region: String,
    pub constraints: Option<BTreeMap<String, String>>,
    pub interruptible: bool,
    pub price_per_hour: f64,
    pub price_per_second: f64,
    pub docker_image: String,
    /// Decoded command (the wire form is base64), when the job has one.
    pub command: Option<String>,
    pub env_vars: Option<BTreeMap<String, String>>,
    /// Raw tags as returned by the API (`"key=value"` list or map).
    pub tags: Option<JobTags>,
    pub runtime: u64,
    pub elapsed: u64,
    pub time_left: u64,
    pub hostname: Option<String>,
    pub cold_boot: bool,
    /// Lifecycle timestamps as fractional unix seconds.
    pub created_at: Option<f64>,
    pub started_at: Option<f64>,
    pub completed_at: Option<f64>,
}

impl Job {
    /// Deserialize from the JSON wire projection tolerantly.
    pub fn from_value(data: &Value) -> Result<Self, HyperCliError> {
        Self::from_value_at(data, sys_time_unix_seconds())
    }

    fn from_value_at(data: &Value, now: f64) -> Result<Self, HyperCliError> {
        let object = data
            .as_object()
            .ok_or_else(|| HyperCliError::InvalidResponse("job must be an object".into()))?;
        let str_field = |key: &str| {
            object
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let tags = match object.get("tags") {
            Some(Value::Array(_)) => serde_json::from_value(object["tags"].clone())
                .ok()
                .map(JobTags::List),
            Some(Value::Object(_)) => serde_json::from_value(object["tags"].clone())
                .ok()
                .map(JobTags::Map),
            _ => None,
        };
        let created_at = object.get("created_at").and_then(parse_flexible_timestamp);
        let started_at = object.get("started_at").and_then(parse_flexible_timestamp);
        let completed_at = object
            .get("completed_at")
            .and_then(parse_flexible_timestamp);
        let runtime = object
            .get("runtime")
            .and_then(parse_flexible_timestamp)
            .map_or(0, |value| value.max(0.0) as u64);
        let state = str_field("state");
        let (elapsed, time_left) =
            derive_runtime_fields(runtime, &state, created_at, started_at, completed_at, now);
        Ok(Self {
            job_id: str_field("job_id"),
            job_key: str_field("job_key"),
            state,
            gpu_type: str_field("gpu_type"),
            gpu_count: object.get("gpu_count").and_then(Value::as_u64).unwrap_or(1) as u32,
            region: str_field("region"),
            constraints: object
                .get("constraints")
                .and_then(|value| serde_json::from_value(value.clone()).ok()),
            interruptible: object
                .get("interruptible")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            price_per_hour: object
                .get("price_per_hour")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            price_per_second: object
                .get("price_per_second")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            docker_image: str_field("docker_image"),
            command: decode_command(object.get("command").and_then(Value::as_str)),
            env_vars: object
                .get("env_vars")
                .and_then(|value| serde_json::from_value(value.clone()).ok()),
            tags,
            runtime,
            elapsed,
            time_left,
            hostname: object
                .get("hostname")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            cold_boot: object
                .get("cold_boot")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            created_at,
            started_at,
            completed_at,
        })
    }

    /// Normalized key/value tag map.
    pub fn tag_map(&self) -> BTreeMap<String, String> {
        self.tags.as_ref().map(JobTags::to_map).unwrap_or_default()
    }

    /// Whether the job carries every required tag.
    pub fn has_tags(&self, required: &JobTags) -> bool {
        let required = required.to_map();
        if required.is_empty() {
            return true;
        }
        let tags = self.tag_map();
        required
            .iter()
            .all(|(key, value)| tags.get(key) == Some(value))
    }
}

/// One page of jobs plus backend pagination metadata
/// (`{jobs, total_count, page, page_size}`).
#[derive(Clone, Debug, Default)]
pub struct JobListPage {
    pub jobs: Vec<Job>,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
}

impl JobListPage {
    fn from_value(data: &Value) -> Result<Self, HyperCliError> {
        match data {
            Value::Array(items) => {
                let jobs = items
                    .iter()
                    .map(Job::from_value)
                    .collect::<Result<Vec<_>, _>>()?;
                let count = jobs.len() as u64;
                Ok(Self {
                    jobs,
                    total_count: count,
                    page: 1,
                    page_size: count.max(50).min(u32::MAX as u64) as u32,
                })
            }
            Value::Object(object) => {
                let items = object.get("jobs").and_then(Value::as_array);
                let jobs = items
                    .map(|items| {
                        items
                            .iter()
                            .map(Job::from_value)
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .transpose()?
                    .unwrap_or_default();
                let item_count = jobs.len() as u64;
                let number = |key: &str, fallback: u64| {
                    object.get(key).and_then(Value::as_u64).unwrap_or(fallback)
                };
                Ok(Self {
                    jobs,
                    total_count: number("total_count", item_count),
                    page: number("page", 1) as u32,
                    page_size: number("page_size", item_count.max(50)) as u32,
                })
            }
            _ => Err(HyperCliError::InvalidResponse(
                "job list must be an object or array".into(),
            )),
        }
    }
}

/// Filters for [`JobsClient::list_page`].
#[derive(Clone, Debug, Default)]
pub struct JobListFilters {
    pub state: Option<String>,
    pub tags: Option<JobTags>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

impl JobListFilters {
    fn query(&self) -> Vec<(String, String)> {
        let mut query = Vec::new();
        if let Some(state) = self.state.as_deref().filter(|state| !state.is_empty()) {
            query.push(("state".to_owned(), state.to_owned()));
        }
        if let Some(tags) = self.tags.as_ref() {
            query.extend(
                tags.to_list()
                    .into_iter()
                    .map(|tag| ("tag".to_owned(), tag)),
            );
        }
        if let Some(page) = self.page {
            query.push(("page".to_owned(), page.to_string()));
        }
        if let Some(page_size) = self.page_size {
            query.push(("page_size".to_owned(), page_size.to_string()));
        }
        query
    }
}

/// Options for [`JobsClient::create`].
#[derive(Clone, Debug)]
pub struct CreateJobOptions {
    pub image: String,
    pub command: Option<String>,
    pub gpu_type: String,
    pub gpu_count: u32,
    pub region: Option<String>,
    pub constraints: Option<BTreeMap<String, String>>,
    pub runtime: Option<u64>,
    pub interruptible: bool,
    pub env: Option<BTreeMap<String, String>>,
    pub ports: Option<BTreeMap<String, u16>>,
    /// Enable bearer auth on the load balancer (use with a `{"lb": port}`
    /// port mapping).
    pub auth: bool,
    pub registry_auth: Option<BTreeMap<String, String>>,
    pub tags: Option<JobTags>,
    pub dockerfile: Option<String>,
    /// Validate everything but create no job and reserve no funds.
    pub dry_run: bool,
}

impl CreateJobOptions {
    pub fn new(image: impl Into<String>) -> Self {
        Self {
            image: image.into(),
            command: None,
            gpu_type: "l40s".to_owned(),
            gpu_count: 1,
            region: None,
            constraints: None,
            runtime: None,
            interruptible: true,
            env: None,
            ports: None,
            auth: false,
            registry_auth: None,
            tags: None,
            dockerfile: None,
            dry_run: false,
        }
    }

    fn to_payload(&self) -> Value {
        use base64::Engine;
        let mut payload = Map::new();
        payload.insert("docker_image".to_owned(), json!(self.image));
        payload.insert("gpu_type".to_owned(), json!(self.gpu_type));
        payload.insert("gpu_count".to_owned(), json!(self.gpu_count));
        payload.insert("interruptible".to_owned(), json!(self.interruptible));
        payload.insert(
            "command".to_owned(),
            json!(base64::engine::general_purpose::STANDARD
                .encode(self.command.as_deref().unwrap_or(""))),
        );
        if let Some(region) = &self.region {
            payload.insert("region".to_owned(), json!(region));
        }
        if let Some(constraints) = &self.constraints {
            payload.insert("constraints".to_owned(), json!(constraints));
        }
        if let Some(runtime) = self.runtime {
            payload.insert("runtime".to_owned(), json!(runtime));
        }
        if let Some(env) = &self.env {
            payload.insert("env_vars".to_owned(), json!(env));
        }
        if let Some(ports) = &self.ports {
            payload.insert("ports".to_owned(), json!(ports));
        }
        if self.auth {
            payload.insert("auth".to_owned(), json!(true));
        }
        if let Some(registry_auth) = &self.registry_auth {
            payload.insert("registry_auth".to_owned(), json!(registry_auth));
        }
        if let Some(tags) = &self.tags {
            let tags = tags.to_list();
            if !tags.is_empty() {
                payload.insert("tags".to_owned(), json!(tags));
            }
        }
        if let Some(dockerfile) = &self.dockerfile {
            payload.insert("dockerfile".to_owned(), json!(dockerfile));
        }
        if self.dry_run {
            payload.insert("dry_run".to_owned(), json!(true));
        }
        Value::Object(payload)
    }
}

/// Result of a non-interactive exec on a running job container.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
pub struct JobExecResult {
    #[serde(default)]
    pub job_id: String,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
    #[serde(default)]
    pub exit_code: i64,
}

/// Check if a string looks like a UUID (direct job ID), matching the Python
/// heuristic (`"-" in s and len(s) > 30`).
pub fn is_uuid(value: &str) -> bool {
    value.contains('-') && value.len() > 30
}

/// Blocking client for the jobs product API.
///
/// Obtained through [`HyperCliClient::jobs`]; borrows the client so it shares
/// retry, timeout, and trace behavior.
pub struct JobsClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl JobsClient<'_> {
    fn url(&self, path: &str) -> String {
        self.client.product_endpoint(&format!("api/jobs{path}"))
    }

    fn get_value<T: serde::de::DeserializeOwned>(
        &self,
        operation: &str,
        url: &str,
        query: &[(String, String)],
    ) -> Result<T, HyperCliError> {
        let builder = self
            .client
            .http
            .get(url)
            .bearer_auth(self.client.api_key.expose_secret())
            .query(query);
        self.client.send_json(operation, "GET", url, None, builder)
    }

    /// Create a job, including dry-run validation support.
    pub fn create(&self, options: &CreateJobOptions) -> Result<Job, HyperCliError> {
        let url = self.url("");
        let payload = options.to_payload();
        let data: Value = self.client.send_json(
            "jobs.create",
            "POST",
            &url,
            Some(payload.clone()),
            self.client
                .http
                .post(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(&payload),
        )?;
        Job::from_value(&data)
    }

    /// Get one job by UUID.
    pub fn get(&self, job_id: &str) -> Result<Job, HyperCliError> {
        let url = self.url(&format!("/{job_id}"));
        let data: Value = self.get_value("jobs.get", &url, &[])?;
        Job::from_value(&data)
    }

    /// List jobs with backend pagination metadata.
    pub fn list_page(&self, filters: &JobListFilters) -> Result<JobListPage, HyperCliError> {
        let url = self.url("");
        let query = filters.query();
        let data: Value = self.get_value("jobs.list", &url, &query)?;
        JobListPage::from_value(&data)
    }

    /// List jobs; use [`Self::list_page`] when pagination metadata is needed.
    pub fn list(&self, filters: &JobListFilters) -> Result<Vec<Job>, HyperCliError> {
        Ok(self.list_page(filters)?.jobs)
    }

    /// Cancel a job. The response shape is backend-owned.
    pub fn cancel(&self, job_id: &str) -> Result<Value, HyperCliError> {
        let url = self.url(&format!("/{job_id}"));
        self.client.send_json(
            "jobs.cancel",
            "DELETE",
            &url,
            None,
            self.client
                .http
                .delete(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }

    /// Extend a job's runtime budget.
    pub fn extend(&self, job_id: &str, runtime: u64) -> Result<Job, HyperCliError> {
        let url = self.url(&format!("/{job_id}"));
        let request = json!({ "runtime": runtime });
        let data: Value = self.client.send_json(
            "jobs.extend",
            "PATCH",
            &url,
            Some(request.clone()),
            self.client
                .http
                .patch(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(&request),
        )?;
        Job::from_value(&data)
    }

    /// Get a job's logs.
    pub fn logs(&self, job_id: &str) -> Result<String, HyperCliError> {
        let url = self.url(&format!("/{job_id}/logs"));
        #[derive(Deserialize)]
        struct LogsResponse {
            #[serde(default)]
            logs: String,
        }
        Ok(self.get_value::<LogsResponse>("jobs.logs", &url, &[])?.logs)
    }

    /// Get a job's auth token.
    pub fn token(&self, job_id: &str) -> Result<String, HyperCliError> {
        let url = self.url(&format!("/{job_id}/token"));
        #[derive(Deserialize)]
        struct TokenResponse {
            #[serde(default)]
            token: String,
        }
        Ok(self
            .get_value::<TokenResponse>("jobs.token", &url, &[])?
            .token)
    }

    /// Execute an argv command non-interactively on a running job container.
    ///
    /// Validation mirrors the Python SDK: the argv list must be nonempty with
    /// a nonempty executable, contain no NUL bytes, total at most 65536 UTF-8
    /// bytes, and pass a timeout of 1-300 seconds.
    pub fn exec(
        &self,
        job_id: &str,
        command: &[String],
        timeout: u32,
    ) -> Result<JobExecResult, HyperCliError> {
        if command.is_empty()
            || command[0].is_empty()
            || command.iter().any(|argument| argument.contains('\0'))
            || command.iter().map(|argument| argument.len()).sum::<usize>() > 65_536
        {
            return Err(HyperCliError::InvalidResponse(
                "command must be a nonempty argv list of strings with a nonempty executable, at most 65536 UTF-8 bytes, and no NUL".into(),
            ));
        }
        if !(1..=300).contains(&timeout) {
            return Err(HyperCliError::InvalidResponse(
                "timeout must be an integer from 1 through 300".into(),
            ));
        }
        let url = self.url(&format!("/{job_id}/exec"));
        let request = json!({ "command": command, "timeout": timeout });
        self.client.send_json(
            "jobs.exec",
            "POST",
            &url,
            Some(request.clone()),
            self.client
                .http
                .post(&url)
                .bearer_auth(self.client.api_key.expose_secret())
                .json(&request),
        )
    }

    /// Find a job by UUID, hostname (exact or prefix), or IP address.
    ///
    /// UUID lookups go straight to the API; hostname/IP matches list jobs and
    /// compare locally (IP matching resolves hostnames via DNS).
    pub fn find_job(
        &self,
        identifier: &str,
        state: Option<&str>,
    ) -> Result<Option<Job>, HyperCliError> {
        if is_uuid(identifier) {
            return Ok(self.get(identifier).ok());
        }
        let filters = JobListFilters {
            state: state.map(ToOwned::to_owned),
            ..JobListFilters::default()
        };
        let jobs = self.list(&filters)?;
        if let Some(job) = jobs
            .iter()
            .find(|job| {
                job.hostname.as_deref().is_some_and(|hostname| {
                    hostname == identifier || hostname.starts_with(identifier)
                })
            })
            .map(|job| Job { ..job.clone() })
        {
            return Ok(Some(job));
        }
        Ok(find_by_ip(jobs, identifier))
    }
}

/// First job whose hostname equals or starts with `hostname`.
pub fn find_by_hostname(jobs: &[Job], hostname: &str) -> Option<Job> {
    jobs.iter()
        .find(|job| {
            job.hostname
                .as_deref()
                .is_some_and(|value| value == hostname || value.starts_with(hostname))
        })
        .cloned()
}

/// First job whose hostname resolves to `ip` (requires a DNS lookup per job).
pub fn find_by_ip(jobs: Vec<Job>, ip: &str) -> Option<Job> {
    use std::net::ToSocketAddrs;
    jobs.into_iter().find(|job| {
        job.hostname.as_deref().is_some_and(|hostname| {
            (hostname, 0)
                .to_socket_addrs()
                .is_ok_and(|mut addrs| addrs.any(|addr| addr.ip().to_string() == ip))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use url::Url;

    fn product_client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap()
    }

    fn job_payload() -> Value {
        json!({
            "job_id": "job-1",
            "job_key": "key-1",
            "state": "running",
            "gpu_type": "l40s",
            "gpu_count": 2,
            "region": "oh",
            "interruptible": false,
            "price_per_hour": 1.2,
            "price_per_second": 0.0003,
            "docker_image": "nvidia/cuda:12.0",
            "command": "cHl0aG9uIHRyYWluLnB5",
            "runtime": 600,
            "hostname": "job-1.hypercli.app",
            "created_at": 1_000_000.0,
            "started_at": 1_000_100.0,
            "tags": ["team=core"]
        })
    }

    #[test]
    fn command_is_base64_decoded_and_runtime_fields_derived_for_running_jobs() {
        let job = Job::from_value_at(&job_payload(), 1_000_400.0).unwrap();
        assert_eq!(job.command.as_deref(), Some("python train.py"));
        assert_eq!(job.elapsed, 300);
        assert_eq!(job.time_left, 300);
        assert_eq!(job.gpu_count, 2);
        assert!(!job.interruptible);
        assert!(job.cold_boot);
        assert_eq!(job.tag_map()["team"], "core");
        assert!(job.has_tags(&JobTags::Map(BTreeMap::from([(
            "team".into(),
            "core".into()
        )]))));
    }

    #[test]
    fn terminal_jobs_report_full_elapsed_and_no_time_left() {
        let mut value = job_payload();
        value["state"] = json!("succeeded");
        value["completed_at"] = json!(1_000_700.0);
        let job = Job::from_value_at(&value, 1_000_900.0).unwrap();
        assert_eq!(job.elapsed, 600);
        assert_eq!(job.time_left, 0);
    }

    #[test]
    fn list_page_parses_the_envelope() {
        let jobs = JobListPage::from_value(&json!({
            "jobs": [job_payload()],
            "total_count": 40,
            "page": 2,
            "page_size": 10
        }))
        .unwrap();
        assert_eq!(jobs.jobs.len(), 1);
        assert_eq!(jobs.total_count, 40);
        assert_eq!(jobs.page, 2);
        assert_eq!(jobs.page_size, 10);
    }

    #[test]
    fn exec_validation_rejects_bad_command_and_timeout() {
        let mut server = Server::new();
        let exec = server
            .mock("POST", "/api/jobs/job-1/exec")
            .expect(0)
            .create();
        let client = product_client(&server);

        let jobs = client.jobs();
        assert!(jobs.exec("job-1", &[], 30).is_err());
        assert!(jobs.exec("job-1", &["".to_owned()], 30).is_err());
        assert!(jobs
            .exec("job-1", &["a".to_owned(), "b\0c".to_owned()], 30)
            .is_err());
        assert!(jobs.exec("job-1", &["a".to_owned()], 0).is_err());
        assert!(jobs.exec("job-1", &["a".to_owned()], 301).is_err());
        exec.assert();
    }

    #[test]
    fn create_sends_base64_command_and_dry_run() {
        let mut server = Server::new();
        let create = server
            .mock("POST", "/api/jobs")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::Json(json!({
                "docker_image": "nvidia/cuda:12.0",
                "gpu_type": "l40s",
                "gpu_count": 1,
                "interruptible": true,
                "command": "cHl0aG9uIHRyYWluLnB5",
                "dry_run": true
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "job_id": "job-dry",
                    "job_key": "",
                    "state": "dry_run",
                    "gpu_type": "l40s",
                    "docker_image": "nvidia/cuda:12.0",
                    "runtime": 120
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let client = product_client(&server);

        let mut options = CreateJobOptions::new("nvidia/cuda:12.0");
        options.command = Some("python train.py".to_owned());
        options.dry_run = true;
        let job = client.jobs().create(&options).unwrap();

        assert_eq!(job.job_id, "job-dry");
        assert_eq!(job.state, "dry_run");
        assert_eq!(job.elapsed, 0);
        assert_eq!(job.time_left, 120);
        create.assert();
    }

    #[test]
    fn list_page_sends_state_tag_and_pagination_params() {
        let mut server = Server::new();
        let list = server
            .mock("GET", "/api/jobs")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("state".into(), "running".into()),
                Matcher::UrlEncoded("tag".into(), "team=core".into()),
                Matcher::UrlEncoded("page".into(), "2".into()),
                Matcher::UrlEncoded("page_size".into(), "25".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"jobs": [job_payload()], "total_count": 30, "page": 2, "page_size": 25})
                    .to_string(),
            )
            .expect(1)
            .create();
        let client = product_client(&server);

        let page = client
            .jobs()
            .list_page(&JobListFilters {
                state: Some("running".to_owned()),
                tags: Some(JobTags::Map(BTreeMap::from([(
                    "team".to_owned(),
                    "core".to_owned(),
                )]))),
                page: Some(2),
                page_size: Some(25),
            })
            .unwrap();

        assert_eq!(page.total_count, 30);
        assert_eq!(page.jobs.len(), 1);
        list.assert();
    }

    #[test]
    fn extend_patches_the_runtime_and_returns_the_job() {
        let mut server = Server::new();
        let patch = server
            .mock("PATCH", "/api/jobs/job-1")
            .match_body(Matcher::Json(json!({"runtime": 900})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(job_payload().to_string())
            .expect(1)
            .create();
        let client = product_client(&server);

        let job = client.jobs().extend("job-1", 900).unwrap();
        assert_eq!(job.job_id, "job-1");
        patch.assert();
    }

    #[test]
    fn logs_and_token_return_their_string_fields() {
        let mut server = Server::new();
        let logs = server
            .mock("GET", "/api/jobs/job-1/logs")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"logs": "line1\nline2"}).to_string())
            .expect(1)
            .create();
        let token = server
            .mock("GET", "/api/jobs/job-1/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "job-token"}).to_string())
            .expect(1)
            .create();
        let client = product_client(&server);

        assert_eq!(client.jobs().logs("job-1").unwrap(), "line1\nline2");
        assert_eq!(client.jobs().token("job-1").unwrap(), "job-token");
        logs.assert();
        token.assert();
    }

    #[test]
    fn cancel_deletes_the_job() {
        let mut server = Server::new();
        let cancel = server
            .mock("DELETE", "/api/jobs/job-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"status": "canceled"}).to_string())
            .expect(1)
            .create();
        let client = product_client(&server);

        let result = client.jobs().cancel("job-1").unwrap();
        assert_eq!(result["status"], "canceled");
        cancel.assert();
    }

    #[test]
    fn find_job_matches_hostname_prefix_from_the_listing() {
        let mut server = Server::new();
        let list = server
            .mock("GET", "/api/jobs")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"jobs": [job_payload()]}).to_string())
            .expect(1)
            .create();
        let client = product_client(&server);

        let job = client
            .jobs()
            .find_job("job-1.hypercli", None)
            .unwrap()
            .unwrap();
        assert_eq!(job.job_id, "job-1");
        list.assert();
    }
}
