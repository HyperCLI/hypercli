//! GPU instance catalog: types, regions, and hourly pricing
//! (`{product}/instances/{types,regions,pricing}`) plus the live capacity
//! probe (`{product}/api/jobs/instances/capacity`).
//!
//! Mirrors the Python SDK's `hypercli/instances.py`.

use std::collections::BTreeMap;

use secrecy::ExposeSecret;
use serde::Deserialize;
use serde_json::Value;

use crate::{HyperCliClient, HyperCliError};

/// Configuration for a specific GPU count of a GPU type.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct GpuConfig {
    #[serde(default = "default_gpu_count")]
    pub gpu_count: u32,
    #[serde(default)]
    pub cpu_cores: f64,
    #[serde(default)]
    pub memory_gb: f64,
    #[serde(default)]
    pub storage_gb: f64,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub constraints: Option<BTreeMap<String, String>>,
}

const fn default_gpu_count() -> u32 {
    1
}

/// A GPU type with its per-count configurations.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GpuType {
    pub id: String,
    pub name: String,
    pub description: String,
    pub configs: Vec<GpuConfig>,
}

impl GpuType {
    fn from_wire(id: &str, data: GpuTypeWire) -> Self {
        Self {
            id: id.to_owned(),
            name: if data.name.is_empty() {
                id.to_owned()
            } else {
                data.name
            },
            description: data.description,
            configs: data.configs,
        }
    }

    /// Regions where this GPU is available at the given count.
    pub fn available_regions(&self, gpu_count: u32) -> &[String] {
        self.configs
            .iter()
            .find(|config| config.gpu_count == gpu_count)
            .map_or(&[], |config| config.regions.as_slice())
    }

    /// GPU counts with at least one region.
    pub fn available_counts(&self) -> Vec<u32> {
        self.configs
            .iter()
            .filter(|config| !config.regions.is_empty())
            .map(|config| config.gpu_count)
            .collect()
    }
}

#[derive(Deserialize)]
struct GpuTypeWire {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    configs: Vec<GpuConfig>,
}

/// A datacenter region.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Region {
    pub id: String,
    pub description: String,
    pub country: String,
}

/// Per-region hourly pricing. `interruptible` maps the wire's historical
/// `interruptable` typo (and the corrected spelling).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct PricingTier {
    #[serde(default)]
    pub region: String,
    #[serde(default, rename = "on-demand")]
    pub on_demand: Option<f64>,
    #[serde(default, rename = "interruptible", alias = "interruptable")]
    pub interruptible: Option<f64>,
}

/// Pricing for one GPU configuration. Catalog keys look like `h100_x8`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GpuPricing {
    pub gpu_type: String,
    pub gpu_count: u32,
    pub tiers: Vec<PricingTier>,
}

impl GpuPricing {
    fn from_key(key: &str, tiers: BTreeMap<String, PricingTier>) -> Self {
        let (gpu_type, gpu_count) = match key.rsplit_once("_x") {
            Some((gpu_type, count)) => (gpu_type.to_owned(), count.parse().unwrap_or(1)),
            None => (key.to_owned(), 1),
        };
        Self {
            gpu_type,
            gpu_count,
            tiers: tiers
                .into_iter()
                .map(|(region, mut tier)| {
                    tier.region = region;
                    tier
                })
                .collect(),
        }
    }

    /// Hourly price for one region and tier.
    pub fn price(&self, region: &str, interruptible: bool) -> Option<f64> {
        self.tiers
            .iter()
            .find(|tier| tier.region == region)
            .and_then(|tier| {
                if interruptible {
                    tier.interruptible
                } else {
                    tier.on_demand
                }
            })
    }
}

/// Blocking client for the instance catalog, obtained through
/// [`HyperCliClient::instances`].
pub struct InstancesClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl InstancesClient<'_> {
    fn get<T: for<'de> Deserialize<'de>>(
        &self,
        operation: &str,
        url: &str,
        query: &[(String, String)],
    ) -> Result<T, HyperCliError> {
        self.client.send_json(
            operation,
            "GET",
            url,
            None,
            self.client
                .http
                .get(url)
                .bearer_auth(self.client.api_key.expose_secret())
                .query(query),
        )
    }

    /// GPU types keyed by catalog ID.
    pub fn types(&self) -> Result<BTreeMap<String, GpuType>, HyperCliError> {
        let url = self.client.product_endpoint("instances/types");
        let wire: BTreeMap<String, GpuTypeWire> = self.get("instances.types", &url, &[])?;
        Ok(wire
            .into_iter()
            .map(|(id, data)| (id.clone(), GpuType::from_wire(&id, data)))
            .collect())
    }

    /// Regions keyed by region ID.
    pub fn regions(&self) -> Result<BTreeMap<String, Region>, HyperCliError> {
        let url = self.client.product_endpoint("instances/regions");
        #[derive(Deserialize)]
        struct RegionWire {
            #[serde(default)]
            description: String,
            #[serde(default)]
            country: String,
        }
        let wire: BTreeMap<String, RegionWire> = self.get("instances.regions", &url, &[])?;
        Ok(wire
            .into_iter()
            .map(|(id, data)| {
                let description = if data.description.is_empty() {
                    id.clone()
                } else {
                    data.description
                };
                (
                    id.clone(),
                    Region {
                        id,
                        description,
                        country: data.country,
                    },
                )
            })
            .collect())
    }

    /// Hourly pricing keyed by `gpu_type_xcount` catalog keys.
    pub fn pricing(&self) -> Result<BTreeMap<String, GpuPricing>, HyperCliError> {
        let url = self.client.product_endpoint("instances/pricing");
        let wire: BTreeMap<String, BTreeMap<String, PricingTier>> =
            self.get("instances.pricing", &url, &[])?;
        Ok(wire
            .into_iter()
            .map(|(key, tiers)| (key.clone(), GpuPricing::from_key(&key, tiers)))
            .collect())
    }

    /// One GPU type by ID.
    pub fn gpu_type(&self, gpu_type: &str) -> Result<Option<GpuType>, HyperCliError> {
        Ok(self.types()?.remove(gpu_type))
    }

    /// One region by ID.
    pub fn region(&self, region: &str) -> Result<Option<Region>, HyperCliError> {
        Ok(self.regions()?.remove(region))
    }

    /// Hourly price for a specific GPU configuration.
    pub fn price(
        &self,
        gpu_type: &str,
        gpu_count: u32,
        region: &str,
        interruptible: bool,
    ) -> Result<Option<f64>, HyperCliError> {
        let key = format!("{gpu_type}_x{gpu_count}");
        Ok(self
            .pricing()?
            .remove(&key)
            .and_then(|pricing| pricing.price(region, interruptible)))
    }

    /// Real-time GPU capacity by type and region. The shape is backend-owned
    /// (`{"idle": {...}, "launching": {...}}`).
    pub fn capacity(&self, gpu_type: Option<&str>) -> Result<Value, HyperCliError> {
        let url = self.client.product_endpoint("api/jobs/instances/capacity");
        let query: Vec<(String, String)> = gpu_type
            .filter(|gpu_type| !gpu_type.is_empty())
            .map(|gpu_type| vec![("gpu_type".to_owned(), gpu_type.to_owned())])
            .unwrap_or_default();
        self.get("instances.capacity", &url, &query)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    #[test]
    fn types_regions_and_pricing_parse_catalog_maps() {
        let mut server = Server::new();
        let types = server
            .mock("GET", "/instances/types")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "h100": {
                        "name": "H100",
                        "description": "Hopper",
                        "configs": [{"gpu_count": 8, "cpu_cores": 26, "memory_gb": 200, "storage_gb": 1000, "regions": ["oh"]}]
                    }
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let pricing = server
            .mock("GET", "/instances/pricing")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "h100_x8": {"oh": {"on-demand": 40.0, "interruptable": 32.0}}
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let capacity = server
            .mock("GET", "/api/jobs/instances/capacity")
            .match_query(Matcher::UrlEncoded("gpu_type".into(), "h100".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"idle": {"h100": {"oh": 2}}}).to_string())
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: url::Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let instances = client.instances();
        let h100 = instances.gpu_type("h100").unwrap().unwrap();
        assert_eq!(h100.name, "H100");
        assert_eq!(h100.available_regions(8), &["oh"]);
        assert_eq!(h100.available_counts(), vec![8]);

        let price = instances.price("h100", 8, "oh", true).unwrap().unwrap();
        assert_eq!(price, 32.0);

        assert_eq!(
            instances.capacity(Some("h100")).unwrap()["idle"]["h100"]["oh"],
            2
        );
        types.assert();
        pricing.assert();
        capacity.assert();
    }
}
