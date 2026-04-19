mod config;
mod db;
mod delivery;
mod errors;
mod handlers;
mod kafka;
mod middleware;
mod models;
mod notification;
mod presence;
mod routes;
mod services;
mod ws;

use std::net::SocketAddr;

use axum::extract::DefaultBodyLimit;
use axum::http::{header, Method};
use sqlx::PgPool;
use tower_http::{cors::{AllowOrigin, CorsLayer}, trace::TraceLayer};
use tracing::info;

use crate::{
    config::Config,
    kafka::producer::KafkaProducer,
    ws::manager::WsManager,
};

/// Shared application state cloned into every request handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
    pub ws_manager: WsManager,
    pub redis_pool: deadpool_redis::Pool,
    pub kafka: KafkaProducer,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env (silently ignored if the file doesn't exist)
    dotenvy::dotenv().ok();

    // Structured logging — set RUST_LOG to override (e.g. RUST_LOG=info)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dis=debug,tower_http=debug".into()),
        )
        .init();

    let config = Config::from_env().expect("Missing required environment variables");

    let pool = db::create_pool(&config)
        .await
        .expect("Failed to connect to the database");

    // Run any pending migrations automatically on startup.
    // For production you may prefer `sqlx migrate run` in your CI/CD pipeline.
    db::run_migrations(&pool)
        .await
        .expect("Database migration failed");

    info!("Database connected and migrations applied");

    let redis_pool = ws::redis_pubsub::create_pool(&config.redis_url, config.redis_pool_size)
        .expect("Failed to create Redis connection pool");

    info!("Redis pool created (max={} connections)", config.redis_pool_size);

    let ws_manager = WsManager::new();

    // Spawn the Redis Pub/Sub subscriber — runs for the lifetime of the server.
    tokio::spawn(ws::redis_pubsub::run_subscriber(
        config.redis_url.clone(),
        ws_manager.clone(),
    ));

    let kafka_producer = kafka::producer::KafkaProducer::new(
        &config.kafka_brokers,
        &config.kafka_topic,
    )
    .expect("Failed to create Kafka producer");

    info!("Kafka producer connected (brokers={})", config.kafka_brokers);

    // Spawn Kafka persistence consumer — writes to DB then publishes to Redis.
    tokio::spawn(kafka::consumer::run_consumer(
        config.kafka_brokers.clone(),
        config.kafka_topic.clone(),
        config.kafka_consumer_group.clone(),
        pool.clone(),
        redis_pool.clone(),
    ));

    // Spawn push-notification consumer — separate consumer group, checks presence.
    tokio::spawn(notification::service::run_notification_consumer(
        config.kafka_brokers.clone(),
        config.kafka_topic.clone(),
        config.kafka_notification_group.clone(),
        redis_pool.clone(),
    ));

    let state = AppState {
        pool,
        config: config.clone(),
        ws_manager,
        redis_pool,
        kafka: kafka_producer,
    };

    let app = routes::create_router(state)
        .layer(TraceLayer::new_for_http()
            // Log only the path — query params (like ?token=) must never appear in logs.
            .make_span_with(|request: &axum::http::Request<_>| {
                tracing::info_span!(
                    "request",
                    method = %request.method(),
                    path   = %request.uri().path(),
                )
            })
        )
        // Hard cap on request body size — guards REST endpoints against large-payload DoS.
        // WebSocket upgrade requests have no body so this does not affect WS connections.
        .layer(DefaultBodyLimit::max(config.body_limit_bytes))
        .layer({
            // If ALLOWED_ORIGINS is set in env, restrict to those exact origins.
            // Otherwise fall back to permissive (suitable for local development only).
            if config.allowed_origins.is_empty() {
                CorsLayer::permissive()
            } else {
                let origins: Vec<axum::http::HeaderValue> = config
                    .allowed_origins
                    .split(',')
                    .filter_map(|o| o.trim().parse().ok())
                    .collect();
                CorsLayer::new()
                    .allow_origin(AllowOrigin::list(origins))
                    .allow_methods([
                        Method::GET,
                        Method::POST,
                        Method::PUT,
                        Method::DELETE,
                        Method::OPTIONS,
                    ])
                    .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
                    .allow_credentials(true)
            }
        });

    let addr: SocketAddr = format!("{}:{}", config.server_host, config.server_port)
        .parse()
        .expect("Invalid server address");

    info!("Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Server shut down cleanly");
    Ok(())
}

/// Resolves on Ctrl-C (all platforms) or SIGTERM (Unix).
/// Axum will stop accepting new connections and drain active ones.
async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let sigterm = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let sigterm = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = sigterm => {},
    }

    tracing::info!("Shutdown signal received — draining connections");
}
