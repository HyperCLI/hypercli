//! Local raw ACP stdio transport.

use std::sync::Arc;

use crate::capabilities::{ClientFrameAction, PodCapabilities};
use crate::frame::validate_frame;
use crate::transport::{AcpFrameObserver, Direction};
use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

/// Run an ACP child process using local newline-delimited stdio.
///
/// Every valid ACP JSON-RPC frame read from this process' stdin is forwarded
/// unchanged to the child. Every valid ACP JSON-RPC frame read from the child is
/// forwarded unchanged to this process' stdout. Newlines are transport
/// delimiters and are not part of the ACP JSON-RPC frame.
///
/// # Errors
///
/// Returns an error when the child process cannot be spawned, a frame is not
/// JSON-RPC 2.0, or either stdio stream fails.
pub async fn run(command: Command) -> Result<()> {
    run_with_observer(command, None).await
}

/// Run an ACP child over local stdio with an optional frame observer.
///
/// # Errors
///
/// Returns an error when the child process cannot be spawned, a frame is not
/// JSON-RPC 2.0, either stdio stream fails, or the observer task stops.
pub async fn run_with_observer(command: Command, observer: Option<AcpFrameObserver>) -> Result<()> {
    let mut child = super::spawn_acp_child(command)?;
    let mut child_stdin = child.stdin.take().context("child stdin unavailable")?;
    let child_stdout = child.stdout.take().context("child stdout unavailable")?;
    let (child_write_tx, mut child_write_rx) = mpsc::channel::<String>(256);
    // Pod-synthesized client-bound responses (re-initialize replay) ride the
    // stdout pump so writes never interleave mid-line.
    let (pod_response_tx, mut pod_response_rx) = mpsc::channel::<String>(16);
    let caps = Arc::new(PodCapabilities::from_env(&child_write_tx));

    let stdin_to_child = {
        let child_write_tx = child_write_tx.clone();
        let observer = observer.clone();
        let caps = Arc::clone(&caps);
        tokio::spawn(async move {
            let mut lines = BufReader::new(tokio::io::stdin()).lines();
            while let Some(line) = lines.next_line().await? {
                validate_frame(&line)?;
                // Pod capability termination: `initialize` capability rewrite
                // (or re-initialize replay) and `session/new` cwd tracking
                // for the per-session fs jail.
                match caps.handle_client_frame(&line).await {
                    ClientFrameAction::Forward(line) => {
                        if let Some(observer) = &observer {
                            observer.observe(Direction::ClientToAgent, &line).await?;
                        }
                        child_write_tx
                            .send(line.into_owned())
                            .await
                            .context("ACP child writer closed")?;
                    }
                    ClientFrameAction::Respond(response) => {
                        pod_response_tx
                            .send(response)
                            .await
                            .context("ACP stdout pump closed")?;
                    }
                }
            }
            anyhow::Ok(())
        })
    };

    drop(child_write_tx);

    let child_writer = tokio::spawn(async move {
        while let Some(line) = child_write_rx.recv().await {
            child_stdin.write_all(line.as_bytes()).await?;
            child_stdin.write_all(b"\n").await?;
        }
        child_stdin.shutdown().await?;
        anyhow::Ok(())
    });

    let stdout_to_client = {
        let observer = observer.clone();
        let caps = Arc::clone(&caps);
        tokio::spawn(async move {
            let mut stdout = tokio::io::stdout();
            let mut lines = BufReader::new(child_stdout).lines();
            let mut pod_response_open = true;
            loop {
                tokio::select! {
                    line = lines.next_line() => {
                        let Some(line) = line? else {
                            break;
                        };
                        validate_frame(&line)?;
                        // Agent→client requests the pod serves (fs, optionally
                        // permission) never reach the client; the hook also binds
                        // session/new cwds to session ids as responses pass through.
                        if caps.handle_agent_frame(&line).await {
                            continue;
                        }
                        if let Some(observer) = &observer {
                            observer.observe(Direction::AgentToClient, &line).await?;
                        }
                        stdout.write_all(line.as_bytes()).await?;
                        stdout.write_all(b"\n").await?;
                        stdout.flush().await?;
                    }
                    response = pod_response_rx.recv(), if pod_response_open => {
                        match response {
                            Some(response) => {
                                if let Some(observer) = &observer {
                                    observer
                                        .observe(Direction::AgentToClient, &response)
                                        .await?;
                                }
                                stdout.write_all(response.as_bytes()).await?;
                                stdout.write_all(b"\n").await?;
                                stdout.flush().await?;
                            }
                            None => pod_response_open = false,
                        }
                    }
                }
            }
            anyhow::Ok(())
        })
    };

    let status = child.wait().await?;
    stdin_to_child.abort();
    child_writer.abort();
    stdout_to_client.await??;
    if !status.success() {
        anyhow::bail!("ACP child exited with {status}");
    }
    Ok(())
}
