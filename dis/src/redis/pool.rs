/// Create a deadpool-redis connection pool for use across all async tasks.
/// Each pool checkout is a zero-copy Arc clone; true concurrent Redis use.
pub fn create_pool(redis_url: &str, max_size: usize) -> anyhow::Result<deadpool_redis::Pool> {
    let mut cfg = deadpool_redis::Config::from_url(redis_url);
    cfg.pool = Some(deadpool_redis::PoolConfig { max_size, ..Default::default() });
    cfg.create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .map_err(|e| anyhow::anyhow!("Failed to create Redis connection pool: {}", e))
}

/// Build the pool **and** verify connectivity with a PING.
/// Returns an error if Redis is not yet reachable — suitable for use with the
/// startup retry helper.
pub async fn create_and_verify_pool(
    redis_url: &str,
    max_size: usize,
) -> anyhow::Result<deadpool_redis::Pool> {
    let pool = create_pool(redis_url, max_size)?;
    let mut conn = pool
        .get()
        .await
        .map_err(|e| anyhow::anyhow!("Redis pool checkout failed: {}", e))?;
    redis::cmd("PING")
        .query_async::<String>(&mut *conn)
        .await
        .map_err(|e| anyhow::anyhow!("Redis PING failed: {}", e))?;
    Ok(pool)
}

/// Ping Redis — used by the health endpoint to verify connectivity.
pub async fn ping(pool: &deadpool_redis::Pool) -> bool {
    match pool.get().await {
        Ok(mut conn) => redis::cmd("PING")
            .query_async::<String>(&mut *conn)
            .await
            .is_ok(),
        Err(_) => false,
    }
}
