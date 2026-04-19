use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::config::Config;

pub async fn create_pool(config: &Config) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(config.db_pool_max_connections)
        .min_connections(config.db_pool_min_connections)
        // Fail fast rather than blocking a request for 30 s.
        .acquire_timeout(Duration::from_secs(5))
        // Close idle connections that have been unused for 10 minutes.
        .idle_timeout(Duration::from_secs(600))
        // Hard upper bound on a connection's lifetime (avoids stale connections
        // after a Postgres restart).
        .max_lifetime(Duration::from_secs(1800))
        .connect(&config.database_url)
        .await
}

/// Runs all pending migrations from the `./migrations` directory.
/// In production you may prefer running migrations via the sqlx CLI before deployment.
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
