//! Account billing product API (`{product}/api/balance`, `{product}/api/tx`).
//!
//! Mirrors the Python SDK's `hypercli/billing.py`.

use secrecy::ExposeSecret;
use serde::Deserialize;

use crate::{HyperCliClient, HyperCliError};

/// Account balance (string amounts, `currency`/`decimals`-annotated).
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Balance {
    #[serde(default, alias = "total_balance")]
    pub total: String,
    #[serde(default, alias = "rewards_balance")]
    pub rewards: String,
    #[serde(default, alias = "balance")]
    pub paid: String,
    #[serde(default, alias = "available_balance")]
    pub available: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_decimals")]
    pub decimals: u32,
}

fn default_currency() -> String {
    "USD".to_owned()
}

const fn default_decimals() -> u32 {
    2
}

/// One balance transaction.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Transaction {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub amount: i64,
    #[serde(default)]
    pub amount_usd: f64,
    #[serde(default)]
    pub transaction_type: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub rewards: bool,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

/// Blocking client for the product billing API, obtained through
/// [`HyperCliClient::billing`].
pub struct BillingClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl BillingClient<'_> {
    /// Get the account balance.
    pub fn balance(&self) -> Result<Balance, HyperCliError> {
        let url = self.client.product_endpoint("api/balance");
        self.client.send_json(
            "billing.balance",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }

    /// List transactions (`limit` maps to the server's `page_size`).
    pub fn transactions(&self, limit: u32, page: u32) -> Result<Vec<Transaction>, HyperCliError> {
        let url = self.client.product_endpoint("api/tx");
        #[derive(Deserialize)]
        struct TransactionPage {
            #[serde(default)]
            transactions: Vec<Transaction>,
        }
        Ok(self
            .client
            .send_json::<TransactionPage>(
                "billing.transactions",
                "GET",
                &url,
                None,
                self.client
                    .http
                    .get(&url)
                    .bearer_auth(self.client.api_key.expose_secret())
                    .query(&[("page", page.to_string()), ("page_size", limit.to_string())]),
            )?
            .transactions)
    }

    /// Get one transaction.
    pub fn get_transaction(&self, transaction_id: &str) -> Result<Transaction, HyperCliError> {
        let url = self
            .client
            .product_endpoint(&format!("api/tx/{transaction_id}"));
        self.client.send_json(
            "billing.get_transaction",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use serde_json::json;
    use url::Url;

    #[test]
    fn balance_and_transactions_round_trip() {
        let mut server = Server::new();
        let balance = server
            .mock("GET", "/api/balance")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "total_balance": "10.00",
                    "rewards_balance": "1.00",
                    "balance": "9.00",
                    "available_balance": "8.00"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let tx = server
            .mock("GET", "/api/tx")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("page".into(), "2".into()),
                Matcher::UrlEncoded("page_size".into(), "25".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"transactions": [{"id": "tx-1", "amount": 500, "amount_usd": 5.0, "transaction_type": "charge", "status": "ok", "rewards": false}]})
                .to_string(),
            )
            .expect(1)
            .create();
        let tx_get = server
            .mock("GET", "/api/tx/tx-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"id": "tx-1", "amount": 500, "transaction_type": "charge", "status": "ok"})
                    .to_string(),
            )
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let billing = client.billing();
        let fetched = billing.balance().unwrap();
        assert_eq!(fetched.total, "10.00");
        assert_eq!(fetched.paid, "9.00");
        assert_eq!(fetched.available, "8.00");
        assert_eq!(fetched.currency, "USD");
        assert_eq!(fetched.decimals, 2);

        let transactions = billing.transactions(25, 2).unwrap();
        assert_eq!(transactions.len(), 1);
        assert_eq!(transactions[0].id, "tx-1");
        assert_eq!(transactions[0].amount, 500);

        assert_eq!(billing.get_transaction("tx-1").unwrap().id, "tx-1");
        balance.assert();
        tx.assert();
        tx_get.assert();
    }
}
