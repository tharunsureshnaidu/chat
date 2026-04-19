use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
    pub server_host: String,
    pub server_port: u16,
    /// Comma-separated list of allowed CORS origins, e.g.
    /// "http://localhost:3001,https://app.example.com".
    /// Empty string means permissive (dev-only default).
    pub allowed_origins: String,
    /// Maximum HTTP request body size in bytes (default 512 KiB).
    /// Protects against large-payload DoS on REST endpoints.
    pub body_limit_bytes: usize,
    /// How often (in seconds) a connected user's presence TTL is refreshed.
    pub presence_heartbeat_secs: u64,
    /// TTL (in seconds) for a presence key in Redis.
    pub presence_ttl_secs: u64,
    /// Maximum connections in the SQLx PostgreSQL pool.
    pub db_pool_max_connections: u32,
    /// Minimum idle connections kept warm in the pool.
    pub db_pool_min_connections: u32,
    /// Maximum connections in the deadpool-redis pool.
    pub redis_pool_size: usize,
    /// Kafka broker list (comma-separated), e.g. "localhost:9092"
    pub kafka_brokers: String,
    /// Kafka topic for chat messages.
    pub kafka_topic: String,
    /// Consumer group for the message-persistence consumer.
    pub kafka_consumer_group: String,
    /// Consumer group for the push-notification consumer (separate offset tracking).
    pub kafka_notification_group: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Config {
            database_url: env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?,
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: env::var("JWT_SECRET")
                .map_err(|_| anyhow::anyhow!("JWT_SECRET must be set"))?,
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".into())
                .parse()
                .unwrap_or(24),
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()
                .unwrap_or(3000),
            allowed_origins: env::var("ALLOWED_ORIGINS").unwrap_or_default(),
            body_limit_bytes: env::var("BODY_LIMIT_BYTES")
                .unwrap_or_else(|_| "524288".into()) // 512 KiB
                .parse()
                .unwrap_or(524_288),
            presence_heartbeat_secs: env::var("PRESENCE_HEARTBEAT_SECS")
                .unwrap_or_else(|_| "30".into())
                .parse()
                .unwrap_or(30),
            presence_ttl_secs: env::var("PRESENCE_TTL_SECS")
                .unwrap_or_else(|_| "60".into())
                .parse()
                .unwrap_or(60),
            db_pool_max_connections: env::var("DB_POOL_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "100".into())
                .parse()
                .unwrap_or(100),
            db_pool_min_connections: env::var("DB_POOL_MIN_CONNECTIONS")
                .unwrap_or_else(|_| "5".into())
                .parse()
                .unwrap_or(5),
            redis_pool_size: env::var("REDIS_POOL_SIZE")
                .unwrap_or_else(|_| "20".into())
                .parse()
                .unwrap_or(20),
            kafka_brokers: env::var("KAFKA_BROKERS")
                .unwrap_or_else(|_| "localhost:9092".into()),
            kafka_topic: env::var("KAFKA_TOPIC")
                .unwrap_or_else(|_| "chat_messages".into()),
            kafka_consumer_group: env::var("KAFKA_CONSUMER_GROUP")
                .unwrap_or_else(|_| "dis-persistence".into()),
            kafka_notification_group: env::var("KAFKA_NOTIFICATION_GROUP")
                .unwrap_or_else(|_| "dis-notifications".into()),
        })
    }
}
