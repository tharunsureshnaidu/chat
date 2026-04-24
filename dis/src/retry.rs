//! Generic async retry helper with exponential back-off.
//!
//! Usage:
//! ```ignore
//! let pool = retry(|| db::create_pool(&config), "Postgres").await;
//! ```

use std::time::Duration;
use tokio::time::sleep;

/// Call `f` up to 10 times, doubling the delay after each failure (1 s → 2 s
/// → 4 s … capped at 30 s).  Panics if every attempt fails.
pub async fn retry<F, Fut, T, E>(mut f: F, name: &str) -> T
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Debug,
{
    let mut delay = 1u64;

    for attempt in 1..=10 {
        match f().await {
            Ok(val) => {
                tracing::info!("✅ {} connected (attempt {})", name, attempt);
                return val;
            }
            Err(err) => {
                tracing::warn!(
                    "❌ {} not ready (attempt {}/10): {:?} — retrying in {}s",
                    name, attempt, err, delay
                );
                sleep(Duration::from_secs(delay)).await;
                delay = (delay * 2).min(30);
            }
        }
    }

    panic!("🚨 {} failed to become ready after 10 attempts — aborting", name);
}
