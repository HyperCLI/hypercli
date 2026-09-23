//! Runner placement must be constructible by downstream SDK consumers.

use hypercli_sdk::{CreateDeploymentRequest, ManagedRuntime, RunnerTargetSpec};
use serde_json::json;

#[test]
fn public_runner_target_can_be_attached_to_deployment_request() {
    let target = RunnerTargetSpec {
        tags: vec!["linux".to_owned()],
        runner_id: Some("63d39d8b-df70-4aee-b045-b3812a58991a".to_owned()),
    };
    let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
    request.runner = Some(target.clone());

    let body = serde_json::to_value(&request).expect("serialize deployment request");
    assert_eq!(
        body["runner"],
        json!({"tags": ["linux"], "runner_id": "63d39d8b-df70-4aee-b045-b3812a58991a"})
    );
    let decoded: RunnerTargetSpec =
        serde_json::from_value(body["runner"].clone()).expect("deserialize runner target");
    assert_eq!(decoded, target);
}
