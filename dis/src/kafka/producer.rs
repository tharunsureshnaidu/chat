use std::time::Duration;

use rdkafka::{
    config::ClientConfig,
    producer::{FutureProducer, FutureRecord, Producer},
};
use serde::{Deserialize, Serialize};
use tracing::debug;
use uuid::Uuid;

/// The message envelope published to and consumed from Kafka.
/// Contains everything needed to persist and broadcast the message downstream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaEnvelope {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub content: String,
    /// RFC3339 timestamp set at the point of publication.
    pub timestamp: String,
}

/// Thin wrapper around rdkafka `FutureProducer`.  Clone-safe (Arc inside).
#[derive(Clone)]
pub struct KafkaProducer {
    inner: FutureProducer,
    topic: String,
}

impl KafkaProducer {
    pub fn new(brokers: &str, topic: &str) -> anyhow::Result<Self> {
        let inner: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            // Wait for all in-sync replicas to acknowledge before returning.
            .set("acks", "all")
            // Retry up to 3 times on transient failures.
            .set("retries", "3")
            .set("retry.backoff.ms", "200")
            .set("message.timeout.ms", "10000")
            .create()?;

        Ok(Self { inner, topic: topic.to_string() })
    }

    /// Async constructor that verifies broker reachability before returning.
    /// Used during startup so the retry helper can detect an unavailable broker.
    pub async fn create(brokers: &str, topic: &str) -> anyhow::Result<Self> {
        let producer = Self::new(brokers, topic)?;

        // fetch_metadata is a blocking librdkafka call — run it off the async executor.
        let probe = producer.inner.clone();
        tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            probe
                .client()
                .fetch_metadata(None, Duration::from_secs(5))
                .map(|_| ())
                .map_err(|e| anyhow::anyhow!("Kafka broker unreachable: {}", e))
        })
        .await
        .map_err(|e| anyhow::anyhow!("Kafka metadata task panicked: {}", e))??;

        Ok(producer)
    }

    /// Publish an envelope, partitioned by `channel_id` so all messages in the
    /// same channel land on the same partition and are ordered.
    pub async fn publish(&self, envelope: &KafkaEnvelope) -> anyhow::Result<()> {
        let payload = serde_json::to_string(envelope)?;
        let key = envelope.channel_id.to_string();

        self.inner
            .send(
                FutureRecord::to(&self.topic)
                    .key(&key)
                    .payload(&payload),
                Duration::from_secs(10),
            )
            .await
            .map_err(|(e, _msg)| anyhow::anyhow!("Kafka publish failed: {}", e))?;

        debug!("Kafka: published message id={} channel={}", envelope.id, envelope.channel_id);
        Ok(())
    }
}
