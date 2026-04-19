/**
 * spike.js  ─  Stage 3: spike test
 *
 * Simulates a sudden burst of connections (e.g. a viral moment or a login
 * storm after a deploy).  The server goes from 0 to MAX_VUS in 10 seconds.
 *
 * What breaks first:
 *   • Tokio thread pool (too many concurrent DB queries)
 *   • PostgreSQL connection pool (sqlx default max_connections = 10 in dev)
 *   • Redis ConnectionManager queue depth
 *   • Kafka producer timeout under write flood
 *
 * HOW TO RUN
 * ──────────
 *   k6 run --env MAX_VUS=1000 load-tests/spike.js
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

const BASE_URL          = __ENV.BASE_URL  || 'http://localhost:3000';
const WS_URL            = __ENV.WS_URL   || 'ws://localhost:3000/ws';
const MAX_VUS           = parseInt(__ENV.MAX_VUS  || '500', 10);
const USERS_PER_CHANNEL = parseInt(__ENV.USERS_PER_CHANNEL || '100', 10);

export const options = {
  stages: [
    { duration: '10s', target: MAX_VUS },  // sudden spike
    { duration: '2m',  target: MAX_VUS },  // sustain
    { duration: '10s', target: 0 },        // drop
  ],
  thresholds: {
    // Spike thresholds are more lenient: we're checking for crashes, not perf
    ws_connect_time: ['p(95)<2000'],
    msg_latency:     ['p(99)<5000'],
    ws_errors:       ['rate<0.05'],
    http_req_failed: ['rate<0.01'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function setup() {
  const channels = [];
  const users    = [];
  const channelCount = Math.ceil(MAX_VUS / USERS_PER_CHANNEL);

  for (let c = 0; c < channelCount; c++) {
    const username = `spike_admin_c${c}`;
    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email: `${username}@lt.invalid`, password: 'LoadTest!123' }),
      { headers: JSON_HEADERS },
    );
    if (reg.status !== 201) fail(`admin register: ${reg.body}`);
    const { token } = reg.json();
    const ch = http.post(
      `${BASE_URL}/api/channels`,
      JSON.stringify({ name: `spike-ch-${c}`, is_public: true }),
      { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } },
    );
    if (ch.status !== 201) fail(`create channel: ${ch.body}`);
    channels.push({ id: ch.json().id });
  }

  for (let i = 0; i < MAX_VUS; i++) {
    const username = `spike_vu_${i}`;
    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email: `${username}@lt.invalid`, password: 'LoadTest!123' }),
      { headers: JSON_HEADERS },
    );
    if (reg.status !== 201) fail(`vu register: ${reg.body}`);
    const { token, user } = reg.json();
    const chId = channels[Math.floor(i / USERS_PER_CHANNEL)].id;
    http.post(
      `${BASE_URL}/api/channels/${chId}/join`,
      null,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    users.push({ token, user, channelId: chId });
  }

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

        socket.setInterval(() => {
          nonce++;
          const content = `spike msg ${nonce}`;
          pendingSends.set(nonce, Date.now());
          socket.send(JSON.stringify({ type: 'send_message', channel_id: channelId, content }));
          msgsSent.add(1);
        }, 5_000);

        socket.setInterval(() => {
          socket.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      });

      socket.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { wsErrors.add(1); return; }
        if (msg.type === 'new_message') {
          msgsReceived.add(1);
          for (const [n, t] of pendingSends.entries()) {
            if (msg.content === `spike msg ${n}`) {
              msgLatency.add(Date.now() - t);
              pendingSends.delete(n);
              break;
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
