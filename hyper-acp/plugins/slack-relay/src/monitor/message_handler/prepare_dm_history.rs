//! Slack thread and DM history preparation helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare-dm-history.ts`.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare-thread-context.ts`.
//! - `openclaw-git/extensions/slack/src/monitor/media.ts` for file metadata
//!   hydration before including media references in prompt context.
//!
//! HyperCLI relay mode fetches missing history/file hydration through the relay
//! API proxy with `HYPER_AGENTS_API_KEY`; direct Slack mode uses the shared
//! Slack Web API operation/client boundary in `client.rs`.

use serde_json::Value;

use crate::client::{SlackDirectWebApiClient, SlackWebApiOperation};
use crate::content::SlackFile;
use crate::history::{
    build_files_info_operations, build_files_info_proxy_requests,
    hydrate_slack_thread_starter_media,
};
use crate::monitor::provider::ActiveSlackRelayPolicy;
use crate::relay_source::HYPER_AGENTS_API_KEY_ENV;
use crate::reply::SlackRelayHttpSender;

pub use crate::history::{
    filter_slack_thread_history_for_visibility, format_slack_thread_history_body,
    should_seed_initial_thread_context, SlackContextVisibility, SlackHydratedMedia,
    SlackSessionFreshness, SlackThreadHistoryMessage,
};

/// Active media hydration plan for relay or direct Slack mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveSlackMediaHydrationPlan {
    /// No hydration can be attempted.
    None,
    /// Hydrate via direct Slack bot-token Web API operations.
    Direct(Vec<SlackWebApiOperation>),
    /// Hydrate via HyperCLI relay proxy requests.
    Relay(Vec<crate::reply::SlackRelayApiProxyRequest>),
}

/// Plans active thread-starter media hydration for direct or relay mode.
#[must_use]
pub fn plan_active_thread_starter_media_hydration(
    policy: &ActiveSlackRelayPolicy,
    files: &[SlackFile],
) -> ActiveSlackMediaHydrationPlan {
    if files.is_empty() {
        return ActiveSlackMediaHydrationPlan::None;
    }
    if policy.direct_client_config.is_some() {
        return ActiveSlackMediaHydrationPlan::Direct(build_files_info_operations(files));
    }
    let Some(api_base) = policy.relay_api_base_url.as_deref() else {
        return ActiveSlackMediaHydrationPlan::None;
    };
    let Some(relay_api_key) = std::env::var(HYPER_AGENTS_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return ActiveSlackMediaHydrationPlan::None;
    };
    ActiveSlackMediaHydrationPlan::Relay(build_files_info_proxy_requests(
        api_base,
        &relay_api_key,
        files,
    ))
}

/// Extracts thread history bundled in a relay payload.
#[must_use]
pub fn extract_thread_history(payload: &Value) -> Option<Vec<SlackThreadHistoryMessage>> {
    let raw = payload
        .get("thread_history")
        .or_else(|| payload.get("threadHistory"))?
        .as_array()?;
    let messages = raw
        .iter()
        .filter_map(|value| {
            Some(SlackThreadHistoryMessage {
                text: value
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        let files = value.get("files").and_then(Value::as_array)?;
                        (!files.is_empty()).then(|| {
                            format!(
                                "[attached: {}]",
                                crate::content::format_slack_file_reference_list(
                                    &parse_slack_files(files)
                                )
                            )
                        })
                    })?,
                ts: value
                    .get("ts")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                user_id: value
                    .get("user")
                    .or_else(|| value.get("user_id"))
                    .or_else(|| value.get("userId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                bot_id: value
                    .get("bot_id")
                    .or_else(|| value.get("botId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                sender_name: value
                    .get("sender_name")
                    .or_else(|| value.get("senderName"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                files: value
                    .get("files")
                    .and_then(Value::as_array)
                    .map(|files| parse_slack_files(files))
                    .unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    (!messages.is_empty()).then_some(messages)
}

/// Extracts files from a relay-provided thread starter record.
#[must_use]
pub fn extract_thread_starter_files(payload: &Value) -> Vec<SlackFile> {
    payload
        .get("thread_starter")
        .or_else(|| payload.get("threadStarter"))
        .and_then(|starter| starter.get("files"))
        .and_then(Value::as_array)
        .map(|files| parse_slack_files(files))
        .unwrap_or_default()
}

/// Parses Slack file references from relay JSON values.
#[must_use]
pub fn parse_slack_files(files: &[Value]) -> Vec<SlackFile> {
    files
        .iter()
        .map(|file| SlackFile {
            id: file
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            name: file
                .get("name")
                .or_else(|| file.get("title"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
        .collect()
}

/// Hydrates thread-starter media metadata through the relay proxy.
pub async fn hydrate_active_thread_starter_media(
    policy: &ActiveSlackRelayPolicy,
    files: &[SlackFile],
) -> Option<Vec<SlackHydratedMedia>> {
    let mut responses = Vec::new();
    match plan_active_thread_starter_media_hydration(policy, files) {
        ActiveSlackMediaHydrationPlan::Direct(operations) => {
            let config = policy.direct_client_config.clone()?;
            let sender = SlackDirectWebApiClient::new(config);
            for operation in operations {
                if let Ok(result) = sender.send(&operation).await {
                    responses.push(result.body);
                }
            }
        }
        ActiveSlackMediaHydrationPlan::Relay(requests) => {
            let sender = SlackRelayHttpSender::new();
            for request in requests {
                if let Ok(result) = sender.send(&request).await {
                    responses.push(result.response);
                }
            }
        }
        ActiveSlackMediaHydrationPlan::None => return None,
    }
    Some(hydrate_slack_thread_starter_media(
        files,
        &responses,
        Some(policy.media_max_bytes),
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn extracts_file_only_thread_history_as_visible_context() {
        let history = extract_thread_history(&json!({
            "thread_history": [
                {"ts":"100.000","files":[{"id":"F1","name":"brief.pdf"}]}
            ]
        }))
        .unwrap();
        assert_eq!(history[0].text, "[attached: brief.pdf (fileId: F1)]");
        assert_eq!(history[0].files[0].id.as_deref(), Some("F1"));
    }

    #[test]
    fn active_media_hydration_plans_direct_before_relay() {
        let files = vec![SlackFile {
            id: Some("F1".to_owned()),
            name: Some("doc.txt".to_owned()),
        }];
        let policy = ActiveSlackRelayPolicy {
            direct_client_config: Some(crate::client::SlackDirectClientConfig {
                bot_token: "xoxb-direct".to_owned(),
                api_base_url: "https://slack.example/api".to_owned(),
            }),
            relay_api_base_url: Some("https://relay.example".to_owned()),
            ..ActiveSlackRelayPolicy::default()
        };
        let plan = plan_active_thread_starter_media_hydration(&policy, &files);
        let ActiveSlackMediaHydrationPlan::Direct(operations) = plan else {
            panic!("expected direct hydration operations");
        };
        assert_eq!(operations[0].method(), Some("files.info"));
        assert_eq!(operations[0].body().unwrap()["file"], "F1");
    }
}
