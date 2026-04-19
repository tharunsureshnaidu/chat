use tracing::warn;
use uuid::Uuid;

/// Redis key TTL for processed-message dedup records.
/// 24 hours covers any realistic Kafka re-delivery window.
const DEDUP_TTL_SECS: u64 = 86_400;

pub struct MessageDedup;

impl MessageDedup {
    pub fn new() -> Self {
        Self
    }

    /// Atomically claims this message ID for processing.
    ///
    /// Uses `SET key 1 NX EX ttl` — a single round-trip that both checks and
    /// marks in one atomic command, eliminating the TOCTOU race window that the
    /// old EXISTS → SETEX pair had (two concurrent consumers could both pass the
    /// EXISTS check before either wrote the SETEX, causing double Redis publishes
    /// and duplicate messages appearing in the chat).
    ///
    /// Returns `true`  → this instance claimed the message, proceed with processing.
    /// Returns `false` → another instance already claimed it, skip.
    /// Fails open (returns `true`) on Redis errors so messages are not silently lost.
    pub async fn try_claim(&self, pool: &deadpool_redis::Pool, message_id: Uuid) -> bool {
        let mut conn = match pool.get().await {
            Ok(c) => c,
            Err(e) => {
                warn!("Dedup: pool checkout failed for id={}: {} — failing open", message_id, e);
                return true;
            }
        };
        let key = format!("dedup:msg:{}", message_id);
        let result: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg(&key)
            .arg(1u8)
            .arg("NX")
            .arg("EX")
            .arg(DEDUP_TTL_SECS)
            .query_async(&mut *conn)
            .await;
        match result {
            Ok(Some(_)) => true,  // key was SET — we claimed it
            Ok(None) => false,    // key already existed — duplicate, skip
            Err(e) => {
                warn!("Dedup: SET NX failed for id={}: {} — failing open", message_id, e);
                true  // fail open: process rather than silently drop
            }
        }
    }
}
