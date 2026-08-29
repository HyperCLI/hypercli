use std::collections::{HashMap, VecDeque};

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;

use crate::types::{NormalizedTurn, TurnAccepted, TurnAdmissionStatus};

#[derive(Debug, Clone)]
pub struct QueuedTurn {
    pub turn: NormalizedTurn,
    pub turn_id: String,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct TurnAdmission {
    pub accepted: TurnAccepted,
    pub dispatch: Option<QueuedTurn>,
}

#[derive(Default)]
pub struct TurnQueue {
    inner: Mutex<TurnQueueInner>,
}

#[derive(Default)]
struct TurnQueueInner {
    conversations: HashMap<String, ConversationQueue>,
    idempotency: HashMap<String, TurnAccepted>,
}

#[derive(Default)]
struct ConversationQueue {
    pending: VecDeque<QueuedTurn>,
    in_flight: Option<QueuedTurn>,
}

impl TurnQueue {
    pub async fn admit(
        &self,
        mut turn: NormalizedTurn,
        turn_id: String,
        queued_at: DateTime<Utc>,
    ) -> TurnAdmission {
        let mut inner = self.inner.lock().await;
        if let Some(previous) = inner.idempotency.get(&turn.idempotency_key) {
            let mut accepted = previous.clone();
            accepted.request_id = turn.request_id.clone();
            accepted.status = TurnAdmissionStatus::Duplicate;
            return TurnAdmission {
                accepted,
                dispatch: None,
            };
        }

        turn.turn_id = Some(turn_id.clone());
        let conversation_key = turn.conversation_key.clone();
        let idempotency_key = turn.idempotency_key.clone();
        let queued_turn = QueuedTurn {
            turn,
            turn_id: turn_id.clone(),
            queued_at,
        };
        let conversation = inner
            .conversations
            .entry(conversation_key.clone())
            .or_default();
        let status = if conversation.in_flight.is_some() || !conversation.pending.is_empty() {
            conversation.pending.push_back(queued_turn.clone());
            TurnAdmissionStatus::Queued
        } else {
            conversation.in_flight = Some(queued_turn.clone());
            TurnAdmissionStatus::Accepted
        };
        let accepted = TurnAccepted {
            request_id: queued_turn.turn.request_id.clone(),
            turn_id,
            conversation_key,
            status,
            queued_at,
        };
        inner.idempotency.insert(idempotency_key, accepted.clone());
        TurnAdmission {
            accepted,
            dispatch: (status == TurnAdmissionStatus::Accepted).then_some(queued_turn),
        }
    }

    pub async fn complete(&self, conversation_key: &str, turn_id: &str) -> Option<QueuedTurn> {
        let mut inner = self.inner.lock().await;
        let conversation = inner.conversations.get_mut(conversation_key)?;
        if conversation
            .in_flight
            .as_ref()
            .map(|queued| queued.turn_id.as_str())
            == Some(turn_id)
        {
            conversation.in_flight = None;
        }
        let next = conversation.pending.pop_front();
        if let Some(next) = next.clone() {
            conversation.in_flight = Some(next);
        }
        next
    }

    pub async fn cancel(&self, conversation_key: &str, turn_id: Option<&str>) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(conversation) = inner.conversations.get_mut(conversation_key) else {
            return false;
        };

        let found = conversation
            .in_flight
            .as_ref()
            .map(|queued| {
                turn_id
                    .map(|target| queued.turn_id.as_str() == target)
                    .unwrap_or(true)
            })
            .unwrap_or(false);
        let before = conversation.pending.len();
        conversation.pending.retain(|queued| {
            turn_id
                .map(|target| queued.turn_id.as_str() != target)
                .unwrap_or(false)
        });
        found || before != conversation.pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Actor, ActorKind, Message, ReplyTarget, TurnContext};

    fn turn(idempotency_key: &str) -> NormalizedTurn {
        NormalizedTurn {
            turn_id: None,
            request_id: Some("req".to_string()),
            idempotency_key: idempotency_key.to_string(),
            connector: "web".to_string(),
            conversation_key: "web:thread".to_string(),
            sender: Actor {
                id: "u".to_string(),
                display: None,
                kind: ActorKind::Human,
                role: None,
            },
            message: Message {
                text: "hello".to_string(),
                attachments: vec![],
            },
            reply_target: ReplyTarget::None,
            context: TurnContext::default(),
            require_reply: None,
        }
    }

    #[tokio::test]
    async fn queue_dedupes_by_idempotency_key() {
        let queue = TurnQueue::default();
        let first = queue
            .admit(turn("idem"), "turn_1".to_string(), Utc::now())
            .await;
        let second = queue
            .admit(turn("idem"), "turn_2".to_string(), Utc::now())
            .await;

        assert_eq!(first.accepted.status, TurnAdmissionStatus::Accepted);
        assert_eq!(second.accepted.status, TurnAdmissionStatus::Duplicate);
        assert_eq!(first.accepted.turn_id, second.accepted.turn_id);
    }

    #[tokio::test]
    async fn complete_dispatches_next_pending_turn() {
        let queue = TurnQueue::default();
        queue
            .admit(turn("a"), "turn_a".to_string(), Utc::now())
            .await;
        let second = queue
            .admit(turn("b"), "turn_b".to_string(), Utc::now())
            .await;

        assert_eq!(second.accepted.status, TurnAdmissionStatus::Queued);
        let next = queue.complete("web:thread", "turn_a").await.expect("next");
        assert_eq!(next.turn_id, "turn_b");
    }
}
