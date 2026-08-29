use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::Utc;
use serde_json::Value;
use tokio::sync::{broadcast, Mutex};

use crate::types::{ActivityFrame, ActivityKind};

const DEFAULT_REPLAY_CAPACITY: usize = 1024;

#[derive(Debug)]
pub struct ActivitySubscription {
    pub replay: Vec<ActivityFrame>,
    pub next_seq: u64,
    pub live: broadcast::Receiver<ActivityFrame>,
}

#[derive(Clone)]
pub struct ActivityBus {
    inner: Arc<ActivityBusInner>,
}

struct ActivityBusInner {
    seq: AtomicU64,
    capacity: usize,
    replay: Mutex<VecDeque<ActivityFrame>>,
    tx: broadcast::Sender<ActivityFrame>,
}

impl Default for ActivityBus {
    fn default() -> Self {
        Self::new(DEFAULT_REPLAY_CAPACITY)
    }
}

impl ActivityBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity.max(16));
        Self {
            inner: Arc::new(ActivityBusInner {
                seq: AtomicU64::new(0),
                capacity: capacity.max(1),
                replay: Mutex::new(VecDeque::with_capacity(capacity.max(1))),
                tx,
            }),
        }
    }

    pub async fn emit(&self, mut frame: ActivityFrame) -> ActivityFrame {
        frame.seq = self.inner.seq.fetch_add(1, Ordering::Relaxed) + 1;
        if frame.timestamp.timestamp() == 0 {
            frame.timestamp = Utc::now();
        }
        {
            let mut replay = self.inner.replay.lock().await;
            if replay.len() == self.inner.capacity {
                replay.pop_front();
            }
            replay.push_back(frame.clone());
        }
        let _ = self.inner.tx.send(frame.clone());
        frame
    }

    pub async fn emit_kind(
        &self,
        kind: ActivityKind,
        conversation_key: Option<String>,
        turn_id: Option<String>,
        payload: Option<Value>,
    ) -> ActivityFrame {
        self.emit(ActivityFrame {
            seq: 0,
            timestamp: Utc::now(),
            kind,
            connector: None,
            conversation_key,
            session_id: None,
            turn_id,
            started_at: None,
            payload,
        })
        .await
    }

    pub async fn subscribe(&self) -> ActivitySubscription {
        let replay = self.inner.replay.lock().await;
        let live = self.inner.tx.subscribe();
        let next_seq = replay.back().map(|frame| frame.seq + 1).unwrap_or(1);
        let replay: Vec<ActivityFrame> = replay.iter().cloned().collect();
        ActivitySubscription {
            next_seq,
            replay,
            live,
        }
    }

    pub async fn snapshot(&self) -> Vec<ActivityFrame> {
        self.inner.replay.lock().await.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ActivityKind;

    #[tokio::test]
    async fn activity_bus_replays_bounded_frames() {
        let bus = ActivityBus::new(2);
        for kind in [
            ActivityKind::RuntimeStarted,
            ActivityKind::TurnQueued,
            ActivityKind::TurnStarted,
        ] {
            bus.emit_kind(kind, None, None, None).await;
        }

        let snapshot = bus.snapshot().await;
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].kind, ActivityKind::TurnQueued);
        assert_eq!(snapshot[1].kind, ActivityKind::TurnStarted);
    }

    #[tokio::test]
    async fn subscription_boundary_reports_next_replay_sequence() {
        let bus = ActivityBus::new(4);
        bus.emit_kind(ActivityKind::RuntimeStarted, None, None, None)
            .await;
        bus.emit_kind(ActivityKind::TurnQueued, None, None, None)
            .await;

        let sub = bus.subscribe().await;

        assert_eq!(sub.replay.len(), 2);
        assert_eq!(sub.next_seq, 3);
    }
}
