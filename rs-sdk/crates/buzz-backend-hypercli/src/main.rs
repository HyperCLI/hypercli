use std::io::{Read, Write};

use buzz_backend_hypercli::{
    deploy, map_config_error, provider_info, ErrorResponse, ProviderRequest,
};
use hypercli_sdk::{discover_client_config, HyperCliClient};

const MAX_REQUEST_BYTES: u64 = 1_048_576;

fn main() {
    let response = run().unwrap_or_else(|error| {
        serde_json::to_value(ErrorResponse {
            ok: false,
            error: &error.to_string(),
        })
        .unwrap_or_else(|_| serde_json::json!({"ok":false,"error":"provider failed"}))
    });

    let mut stdout = std::io::stdout().lock();
    if serde_json::to_writer(&mut stdout, &response).is_ok() {
        let _ = stdout.write_all(b"\n");
    }
}

fn run() -> Result<serde_json::Value, buzz_backend_hypercli::ProviderError> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .lock()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| buzz_backend_hypercli::ProviderError::InvalidRequest)?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err(buzz_backend_hypercli::ProviderError::InvalidRequest);
    }
    let request: ProviderRequest = serde_json::from_slice(&bytes)
        .map_err(|_| buzz_backend_hypercli::ProviderError::InvalidRequest)?;

    match request {
        ProviderRequest::Info { request_id } => {
            let _ = request_id;
            serde_json::to_value(provider_info())
                .map_err(|_| buzz_backend_hypercli::ProviderError::InvalidRequest)
        }
        ProviderRequest::Deploy {
            request_id,
            agent,
            provider_config,
        } => {
            let _ = request_id;
            let config = discover_client_config().map_err(map_config_error)?;
            let client =
                HyperCliClient::new(config).map_err(buzz_backend_hypercli::map_client_error)?;
            serde_json::to_value(deploy(&client, *agent, provider_config)?)
                .map_err(|_| buzz_backend_hypercli::ProviderError::HyperCli)
        }
    }
}
