#![allow(
    clippy::doc_markdown,
    clippy::exhaustive_enums,
    clippy::exhaustive_structs,
    clippy::missing_panics_doc,
    clippy::multiple_crate_versions,
    clippy::too_many_lines
)]
#![doc = "Hyper ACP is a thin host layer over the canonical Agent Client Protocol schema."]
#![doc = ""]
#![doc = "License: Apache-2.0. Protocol types are provided by the upstream"]
#![doc = "`agent-client-protocol-schema` crate copied in this repository; this crate"]
#![doc = "does not redefine or reduce ACP request, response, notification, or batch shapes."]

pub mod capabilities;
pub mod frame;
pub mod transport;

pub use agent_client_protocol_schema as schema;
