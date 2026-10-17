use serde_json::Value;
use std::collections::BTreeMap;

/// Assemble caller-selected standard ACP entries for existing launch env maps.
/// The host owns merging/conflicts; the native peer owns transport support.
/// Does not discover credentials or read this process's environment.
pub fn build_additional_mcp_env(groups: &[&[Value]]) -> BTreeMap<String, String> {
    let servers: Vec<&Value> = groups.iter().flat_map(|group| group.iter()).collect();
    BTreeMap::from([(
        "HYPER_ADDITIONAL_MCP_SERVERS".into(),
        serde_json::to_string(&servers).expect("JSON values serialize"),
    )])
}
