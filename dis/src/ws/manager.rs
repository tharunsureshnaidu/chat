use std::sync::Arc;

use dashmap::{DashMap, DashSet};
use tokio::sync::mpsc;
use tracing::{debug, warn};
use uuid::Uuid;

/// The type used to push outgoing text frames to a connected client.
/// Using `Arc<String>` so `broadcast` can wrap once and clone N times cheaply
/// (atomic refcount increment) instead of allocating N independent Strings.
pub type ClientSender = mpsc::UnboundedSender<Arc<String>>;

/// Thread-safe, cheaply-cloneable registry of all active WebSocket connections.
///
/// Three maps are maintained:
/// * `connections`  — user_id → send-channel (one per connected client)
/// * `channel_subs` — channel_id → set of subscribed user_ids  (used for broadcasting)
/// * `user_channels`— user_id   → set of channel_ids the user is subscribed to
///                    (used for O(subs) cleanup on disconnect instead of O(all_channels))
#[derive(Clone, Default)]
pub struct WsManager {
    connections: Arc<DashMap<Uuid, ClientSender>>,
    channel_subs: Arc<DashMap<Uuid, DashSet<Uuid>>>,
    user_channels: Arc<DashMap<Uuid, DashSet<Uuid>>>,
}

impl WsManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a freshly-upgraded WebSocket connection.
    pub fn connect(&self, user_id: Uuid, sender: ClientSender) {
        debug!("WS connect: user_id={}", user_id);
        self.connections.insert(user_id, sender);
        // Ensure the per-user channel set exists
        self.user_channels.entry(user_id).or_default();
    }

    /// Remove a client and all its subscriptions.  Called on any disconnect.
    pub fn disconnect(&self, user_id: Uuid) {
        debug!("WS disconnect: user_id={}", user_id);
        self.connections.remove(&user_id);

        // Clean up subscriptions using the reverse map (fast path)
        if let Some((_, channels)) = self.user_channels.remove(&user_id) {
            for channel_id in channels.iter() {
                if let Some(subs) = self.channel_subs.get(&*channel_id) {
                    subs.remove(&user_id);
                }
            }
        }
    }

    /// Subscribe `user_id` to `channel_id`.
    /// Returns `false` if the user was already subscribed (idempotent).
    pub fn subscribe(&self, user_id: Uuid, channel_id: Uuid) -> bool {
        let inserted = self
            .channel_subs
            .entry(channel_id)
            .or_default()
            .insert(user_id);

        if inserted {
            self.user_channels
                .entry(user_id)
                .or_default()
                .insert(channel_id);
        }
        inserted
    }

    /// Unsubscribe `user_id` from `channel_id`.
    pub fn unsubscribe(&self, user_id: Uuid, channel_id: Uuid) {
        if let Some(subs) = self.channel_subs.get(&channel_id) {
            subs.remove(&user_id);
        }
        if let Some(channels) = self.user_channels.get(&user_id) {
            channels.remove(&channel_id);
        }
    }

    /// Returns `true` if `user_id` currently has an active subscription to
    /// `channel_id`.  Used as an in-memory fast-path to skip DB membership
    /// checks when the user is already subscribed (subscribe itself enforces
    /// the membership check, so subscription implies membership).
    pub fn is_subscribed(&self, user_id: Uuid, channel_id: Uuid) -> bool {
        self.user_channels
            .get(&user_id)
            .map(|chs| chs.contains(&channel_id))
            .unwrap_or(false)
    }

    /// Broadcast a JSON string to every subscriber of `channel_id`.
    /// Pass `exclude` to skip one user (typically the sender if you want
    /// to avoid duplication — pass `None` to send to everyone).
    ///
    /// The string is wrapped in `Arc` once before the loop so that each
    /// subscriber receives a cheap refcount clone rather than a full heap copy.
    pub fn broadcast(&self, channel_id: Uuid, message: String, exclude: Option<Uuid>) {
        let subs = match self.channel_subs.get(&channel_id) {
            Some(s) => s,
            None => return,
        };

        let message = Arc::new(message);

        for uid in subs.iter() {
            if Some(*uid) == exclude {
                continue;
            }
            if let Some(sender) = self.connections.get(&*uid) {
                if sender.send(Arc::clone(&message)).is_err() {
                    // The receiver is gone; disconnect will be cleaned up by
                    // the connection task when it notices the socket closed.
                    warn!("WS broadcast: dead sender for user_id={}", *uid);
                }
            }
        }
    }

    /// Send a message directly to one specific user (fire-and-forget).
    pub fn send_to(&self, user_id: Uuid, message: String) {
        if let Some(sender) = self.connections.get(&user_id) {
            if sender.send(Arc::new(message)).is_err() {
                warn!("WS send_to: dead sender for user_id={}", user_id);
            }
        }
    }

    /// Number of currently connected clients (useful for metrics / health).
    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }
}
