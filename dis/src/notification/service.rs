use futures_util::StreamExt;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    Message,
};
use tracing::{debug, error, info, warn};

use crate::{
    kafka::producer::KafkaEnvelope,
    presence::service as presence,
};

/// Runs forever on a separate consumer group so it has independent offset
/// tracking from the persistence consumer.  Checks sender presence and logs
/// push notification intent — wire up FCM/APNs here when ready.
pub async fn run_notification_consumer(
    brokers: String,
    topic: String,
    group_id: String,
    redis_pool: deadpool_redis::Pool,
) {
    info!("Notification consumer starting (group={})", group_id);

    loop {
        match try_notify(
            brokers.clone(),
            topic.clone(),
            group_id.clone(),
            redis_pool.clone(),
        )
        .await
        {
            Ok(_) => warn!("Notification consumer loop ended — reconnecting"),
            Err(e) => error!("Notification consumer error: {} — reconnecting in 5s", e),
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

async fn try_notify(
    brokers: String,
    topic: String,
    group_id: String,
    redis_pool: deadpool_redis::Pool,
) -> anyhow::Result<()> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", &group_id)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "true")
        .set("fetch.wait.max.ms", "100")
        .set("session.timeout.ms", "6000")
        .set("heartbeat.interval.ms", "2000")
        .create()?;

    consumer.subscribe(&[&topic])?;
    info!("Notification consumer subscribed to topic={}", topic);

    let mut stream = consumer.stream();

    while let Some(result) = stream.next().await {
        let msg = match result {
            Ok(m) => m,
            Err(e) => {
                warn!("Notification consumer: receive error: {}", e);
                continue;
            }
        };

        let payload = match msg.payload_view::<str>() {
            Some(Ok(p)) => p.to_string(),
            _ => continue,
        };

        let envelope: KafkaEnvelope = match serde_json::from_str(&payload) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Check whether the sender is currently online.
        // In a real implementation you would query channel subscribers from the
        // database and send push notifications to any who are offline.
        let sender_online = presence::is_online(&redis_pool, envelope.user_id).await;

        if !sender_online {
            // TODO: look up FCM/APNs device tokens for offline subscribers and
            //       call the push notification API.
            debug!(
                "Notification: sender user_id={} is offline — would push FCM for message id={}",
                envelope.user_id, envelope.id
            );
        } else {
            debug!(
                "Notification: sender user_id={} is online — no push for message id={}",
                envelope.user_id, envelope.id
            );
        }
    }

    Ok(())
}
