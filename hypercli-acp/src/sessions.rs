use std::collections::HashMap;

use tokio::sync::Mutex;

#[derive(Debug, Default)]
pub struct SessionStore {
    inner: Mutex<HashMap<String, String>>,
}

impl SessionStore {
    pub fn from_bindings(bindings: HashMap<String, String>) -> Self {
        Self {
            inner: Mutex::new(bindings),
        }
    }

    pub async fn get(&self, conversation_key: &str) -> Option<String> {
        self.inner.lock().await.get(conversation_key).cloned()
    }

    pub async fn bind(&self, conversation_key: impl Into<String>, session_id: impl Into<String>) {
        self.inner
            .lock()
            .await
            .insert(conversation_key.into(), session_id.into());
    }

    pub async fn rotate(&self, conversation_key: &str) -> Option<String> {
        self.inner.lock().await.remove(conversation_key)
    }
}
