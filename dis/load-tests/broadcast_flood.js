/**
 * broadcast_flood.js  ─  Stage 4: fan-out stress test
 *
 * Worst-case scenario: one channel with ALL VUs subscribed.
 * Every VU sends one message → server must deliver it to ALL others.
 * This stresses the WsManager.broadcast() path and tests whether
 * Arc<String> + DashMap holds up under high subscriber counts.
 *
 * Expected bottlenecks:
 *   • DashMap read lock contention on channel_subs (all senders hit it)
 *   • mpsc::UnboundedSender back-pressure (slow clients lag behind)
 *   • Kafka partition throughput (all messages on same channel = same partition)
 *
 * HOW TO RUN
 * ──────────
 *   k6 run --env VU_COUNT=300 load-tests/broadcast_flood.js
 */

import ws   from 'k6/ws';
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const connectTime  = new Trend('ws_connect_time', true);
const msgLatency   = new Trend('msg_latency',     true);
const wsErrors     = new Rate('ws_errors');
const msgsSent     = new Counter('messages_sent');
const msgsReceived = new Counter('messages_received');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL   = __ENV.WS_URL   || 'ws://localhost:3000/ws';
const VU_COUNT = parseInt(__ENV.VU_COUNT || '200', 10);

export const options = {
  stages: [
    { duration: '30s', target: VU_COUNT },
    { duration: '2m',  target: VU_COUNT },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    ws_connect_time: ['p(95)<500'],
    // Fan-out latency is expected to be higher—O(subscribers) work per message
    msg_latency:     ['p(95)<3000'],
    ws_errors:       ['rate<0.02'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** One shared channel for all VUs — maximum fan-out */
export function setup() {
  const adminUsername = `flood_admin_${Date.now()}`;
  const reg = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ username: adminUsername, email: `${adminUsername}@lt.invalid`, password: 'LoadTest!123' }),
    { headers: JSON_HEADERS },
  );
  if (reg.status !== 201) fail(`admin register: ${reg.body}`);
  const { token: adminToken } = reg.json();

  const ch = http.post(
    `${BASE_URL}/api/channels`,
    JSON.stringify({ name: `flood-ch-${Date.now()}`, is_public: true }),
    { headers: { ...JSON_HEADERS, Authorization: `Bearer ${adminToken}` } },
  );
  if (ch.status !== 201) fail(`create channel: ${ch.body}`);
  const channelId = ch.json().id;

  const users = [];
  for (let i = 0; i < VU_COUNT; i++) {
    const username = `flood_vu_${i}`;
    const reg2 = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email: `${username}@lt.invalid`, password: 'LoadTest!123' }),
      { headers: JSON_HEADERS },
    );
    if (reg2.status !== 201) fail(`vu register: ${reg2.body}`);
    const { token, user } = reg2.json();
    http.post(
      `${BASE_URL}/api/channels/${channelId}/join`,
      null,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    users.push({ token, user, channelId });
  }

  console.log(`Flood setup: ${users.length} VUs → single channel ${channelId}`);
  return { users };
}

export default function scenario({ users }) {
  const { token, user, channelId } = users[__VU - 1] ?? users[0];
  const connectStart = Date.now();
  const pendingSends = new Map();
  let nonce = 0;

  const res = ws.connect(
    `${WS_URL}?token=${encodeURIComponent(token)}`,
    {},
    function (socket) {
      socket.on('open', () => {
        connectTime.add(Date.now() - connectStart);
        socket.send(JSON.stringify({ type: 'subscribe', channel_id: channelId }));

        // Send one message every 2 seconds — all VUs sending simultaneously
        // creates VU_COUNT * (1000/2000) = VU_COUNT/2 messages per second
        socket.setInterval(() => {
          nonce++;
          const content = `flood ${nonce} vu${__VU}`;
          pendingSends.set(nonce, Date.now());
          socket.send(JSON.stringify({ type: 'send_message', channel_id: channelId, content }));
          msgsSent.add(1);
        }, 2_000);

        socket.setInterval(() => {
          socket.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      });

      socket.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { wsErrors.add(1); return; }

        if (msg.type === 'new_message') {
          msgsReceived.add(1);
          // Only measure latency of our own messages
          if (msg.user_id === user.id) {
            for (const [n, t] of pendingSends.entries()) {
              if (msg.content === `flood ${n} vu${__VU}`) {
                msgLatency.add(Date.now() - t);
                pendingSends.delete(n);
                break;
              }
            }
          }
        } else if (msg.type === 'error') {
          wsErrors.add(1);
        }
      });

      socket.on('error', () => wsErrors.add(1));
      socket.on('close', (code) => {
        if (code !== 1000 && code !== 1001) wsErrors.add(1);
      });

      socket.setTimeout(() => socket.close(), 200_000);
    },
  );

  check(res, { 'ws 101': (r) => r && r.status === 101 });
}
