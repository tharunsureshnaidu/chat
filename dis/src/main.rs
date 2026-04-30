//! # dis — Real-time chat backend
//!
//! Boot sequence:
//! 1. Load config from environment (`config/`)
//! 2. Connect PostgreSQL pool + run migrations (`db/`)
//! 3. Connect Redis pool for sessions/pub-sub (`redis/`)
//! 4. Start Kafka producer + consumer (`kafka/`)
//! 5. Spawn presence heartbeat loop (`presence/`)
//! 6. Spawn notification dispatch loop (`notification/`)
//! 7. Build Axum router with REST + WS routes (`routes/`, `handlers/`, `ws/`)
//! 8. Bind to `0.0.0.0:{PORT}` and serve

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
mod redis;
mod retry;
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
    dotenvy::dotenv().ok();
    init_tracing();

    let config = Config::from_env().expect("Missing required environment variables");
    let state = boot_infrastructure(&config).await;

    let app = routes::create_router(state)
        .layer(request_trace_layer())
        .layer(DefaultBodyLimit::max(config.body_limit_bytes))
        .layer(build_cors(&config));

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

// ── Startup helpers ───────────────────────────────────────────────────────────

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dis=debug,tower_http=debug".into()),
        )
        .init();
}

/// Connect to all infrastructure services and spawn background tasks.
/// Returns the fully-initialised `AppState`.
async fn boot_infrastructure(config: &Config) -> AppState {
    // ── PostgreSQL ────────────────────────────────────────────────────────
    let pool = retry::retry(
        || db::create_pool(config),
        "Postgres",
    )
    .await;

    db::run_migrations(&pool)
        .await
        .expect("Database migration failed");

    info!("Database connected and migrations applied");

    // ── Redis ─────────────────────────────────────────────────────────────
    let redis_pool = retry::retry(
        || ws::redis_pubsub::create_and_verify_pool(&config.redis_url, config.redis_pool_size),
        "Redis",
    )
    .await;

    info!("Redis pool ready (max={} connections)", config.redis_pool_size);

    // ── WebSocket manager + Redis subscriber ──────────────────────────────
    let ws_manager = WsManager::new();

    tokio::spawn(ws::redis_pubsub::run_subscriber(
        config.redis_url.clone(),
        ws_manager.clone(),
    ));

    // ── Kafka producer + consumers ────────────────────────────────────────
    let kafka_producer = retry::retry(
        || KafkaProducer::create(&config.kafka_brokers, &config.kafka_topic),
        "Kafka",
    )
    .await;

    info!("Kafka producer ready (brokers={})", config.kafka_brokers);

    tokio::spawn(kafka::consumer::run_consumer(
        config.kafka_brokers.clone(),
        config.kafka_topic.clone(),
        config.kafka_consumer_group.clone(),
        pool.clone(),
        redis_pool.clone(),
    ));

    tokio::spawn(notification::service::run_notification_consumer(
        config.kafka_brokers.clone(),
        config.kafka_topic.clone(),
        config.kafka_notification_group.clone(),
        redis_pool.clone(),
    ));

    AppState {
        pool,
        config: config.clone(),
        ws_manager,
        redis_pool,
        kafka: kafka_producer,
    }
}

/// TraceLayer that logs only the method + path (never query params like ?token=).
fn request_trace_layer(
) -> TraceLayer<
    tower_http::classify::SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    impl Fn(&axum::http::Request<axum::body::Body>) -> tracing::Span + Clone,
> {
    TraceLayer::new_for_http()
        .make_span_with(|request: &axum::http::Request<_>| {
            tracing::info_span!(
                "request",
                method = %request.method(),
                path   = %request.uri().path(),
            )
        })
}

/// Build the CORS layer.  If `ALLOWED_ORIGINS` is set, restrict to those
/// exact origins; otherwise fall back to permissive (local dev only).
fn build_cors(config: &Config) -> CorsLayer {
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
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

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
