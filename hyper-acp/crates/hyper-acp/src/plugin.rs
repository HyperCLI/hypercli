//! Plugin interfaces for observers around canonical ACP traffic.
//!
//! Plugins see parsed envelope metadata only. They are not an alternate ACP
//! adapter API and are not advertised by this crate unless an external package
//! registers a real implementation.

use crate::frame::FrameMetadata;

/// Observes canonical ACP JSON-RPC frames crossing the host transport.
pub trait AcpPlugin: Send + Sync {
    /// Stable plugin name for logs and diagnostics.
    fn name(&self) -> &'static str;

    /// Observe frame metadata without changing the raw ACP frame.
    ///
    /// Implementations must not rely on this callback for routing semantics;
    /// it is observational only.
    fn observe_frame(&self, metadata: &FrameMetadata) {
        let _ = metadata;
    }
}

/// Collection of registered ACP observer plugins.
#[derive(Default)]
pub struct PluginRegistry {
    plugins: Vec<Box<dyn AcpPlugin>>,
}

impl std::fmt::Debug for PluginRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PluginRegistry")
            .field("plugins", &self.plugins.len())
            .finish()
    }
}

impl PluginRegistry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a concrete ACP observer plugin.
    pub fn register(&mut self, plugin: impl AcpPlugin + 'static) {
        self.plugins.push(Box::new(plugin));
    }

    /// Observe metadata with all registered plugins.
    pub fn observe(&self, metadata: &FrameMetadata) {
        for plugin in &self.plugins {
            plugin.observe_frame(metadata);
        }
    }

    /// Return true when no plugins are registered.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }
}
