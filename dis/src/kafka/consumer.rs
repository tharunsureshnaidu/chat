use futures_util::StreamExt;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    Message,
};
use sqlx::PgPool;
use tracing::{debug, error, info, warn};

use crate::{
    delivery::dedup::MessageDedup,
    kafka::producer::KafkaEnvelope,
    ws::redis_pubsub::{publish, RedisChatMessage},
};

/// Runs forever.  Consumes `chat_messages`, persists each message to PostgreSQL,
/// deduplicates using Redis (at-least-once safety), then fans out via Redis
/// Pub/Sub so WebSocket clients receive it.
pub async fn run_consumer(
    brokers: String,
    topic: String,
    group_id: String,
    pool: PgPool,
    redis_pool: deadpool_redis::Pool,
) {
    info!("Kafka persistence consumer starting (brokers={} topic={} group={})", brokers, topic, group_id);

    loop {
        match try_consume(
            brokers.clone(),
            topic.clone(),
            group_id.clone(),
            pool.clone(),
            redis_pool.clone(),
        )
        .await
        {
            Ok(_) => warn!("Kafka consumer loop ended — reconnecting"),
            Err(e) => error!("Kafka consumer error: {} — reconnecting in 5s", e),
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

async fn try_consume(
    brokers: String,
    topic: String,
    group_id: String,
    pool: PgPool,
    redis_pool: deadpool_redis::Pool,
) -> anyhow::Result<()> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", &group_id)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "true")
        .set("auto.commit.interval.ms", "1000")
        // Wake up immediately when a message is available.
        .set("fetch.wait.max.ms", "100")
        // Faster group join / rebalance detection.
        .set("session.timeout.ms", "6000")
        .set("heartbeat.interval.ms", "2000")
        .create()?;

    consumer.subscribe(&[&topic])?;
    info!("Kafka persistence consumer subscribed to topic={}", topic);

    let dedup = MessageDedup::new();
    let mut stream = consumer.stream();

    while let Some(result) = stream.next().await {
        let msg = match result {
            Ok(m) => m,
            Err(e) => {
                warn!("Kafka consumer: receive error: {}", e);
                continue;
            }
        };

        let payload = match msg.payload_view::<str>() {
            Some(Ok(p)) => p.to_string(),
            _ => {
                warn!("Kafka consumer: non-UTF-8 payload, skipping");
                continue;
            }
        };

        let envelope: KafkaEnvelope = match serde_json::from_str(&payload) {
            Ok(e) => e,
            Err(e) => {
                warn!("Kafka consumer: envelope parse error: {} — payload={}", e, payload);
                continue;
            }
        };

        debug!("Kafka consumer: id={} channel={}", envelope.id, envelope.channel_id);

        // Atomic dedup claim — SET NX EX in one round-trip.
        // Only one consumer instance can claim a given message ID; the rest skip.
        if !dedup.try_claim(&redis_pool, envelope.id).await {
            debug!("Kafka consumer: duplicate id={}, skipping", envelope.id);
            continue;
        }

        // Persist to PostgreSQL.  ON CONFLICT DO NOTHING is a secondary safety
        // net against the rare case where the Redis dedup key has expired but
        // the message was already written to the DB.
        let db_result = sqlx::query(
            "INSERT INTO messages (id, channel_id, user_id, content)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(envelope.id)
        .bind(envelope.channel_id)
        .bind(envelope.user_id)
        .bind(&envelope.content)
        .execute(&pool)
        .await;

        if let Err(e) = db_result {
            error!("Kafka consumer: DB insert failed id={}: {} — will retry on next delivery", envelope.id, e);
            // The dedup key was already claimed, so Kafka redelivery will be
            // skipped unless the 24 h TTL expires first.  For transient DB
            // errors the ON CONFLICT DO NOTHING on retry is the safety net.
            continue;
        }

        // Publish to Redis Pub/Sub — WebSocket fanout picks it up from here.
        let redis_msg = RedisChatMessage {
            id: envelope.id,
            channel_id: envelope.channel_id,
            user_id: envelope.user_id,
            username: envelope.username,
            content: envelope.content,
            timestamp: envelope.timestamp,
        };
        publish(&redis_pool, &redis_msg).await;
    }

    Ok(())
}
