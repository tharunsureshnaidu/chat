/**
 * soak.js  ─  Stage 2: sustained load (soak test)
 *
 * Same scenario as baseline but held for 30 minutes.
 * Detects memory leaks (WsManager subscription maps growing without bound),
 * Redis connection pool exhaustion, Kafka consumer lag accumulation, and
 * Postgres connection pool saturation.
 *
 * HOW TO RUN
 * ──────────
 *   k6 run --env VU_COUNT=200 load-tests/soak.js
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

const BASE_URL          = __ENV.BASE_URL          || 'http://localhost:3000';
const WS_URL            = __ENV.WS_URL            || 'ws://localhost:3000/ws';
const VU_COUNT          = parseInt(__ENV.VU_COUNT  || '200', 10);
const USERS_PER_CHANNEL = parseInt(__ENV.USERS_PER_CHANNEL || '50', 10);
const SEND_INTERVAL_MS  = parseInt(__ENV.SEND_INTERVAL_MS  || '5000', 10);
const SOAK_MINUTES      = parseInt(__ENV.SOAK_MINUTES      || '30', 10);

export const options = {
  stages: [
    { duration: '2m',              target: VU_COUNT },
    { duration: `${SOAK_MINUTES}m`, target: VU_COUNT },
    { duration: '1m',              target: 0 },
  ],
  thresholds: {
    ws_connect_time: ['p(95)<500'],
    msg_latency:     ['p(95)<2000'],
    ws_errors:       ['rate<0.02'],
    http_req_failed: ['rate<0.001'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function setup() {
  const RUN_ID   = Date.now();
  const channels = [];
  const users    = [];
  const channelCount = Math.ceil(VU_COUNT / USERS_PER_CHANNEL);

  for (let c = 0; c < channelCount; c++) {
    const username = `soak_admin_c${c}_${RUN_ID}`;
    const email    = `${username}@lt.invalid`;
    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email, password: 'LoadTest!123' }),
      { headers: JSON_HEADERS },
    );
    if (reg.status !== 201) fail(`admin register: ${reg.body}`);
    const { token } = reg.json();
    const ch = http.post(
      `${BASE_URL}/api/channels`,
      JSON.stringify({ name: `soak-ch-${c}-${RUN_ID}`, is_public: true }),
      { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } },
    );
    if (ch.status !== 201) fail(`create channel: ${ch.body}`);
    channels.push({ id: ch.json().id });
  }

  for (let i = 0; i < VU_COUNT; i++) {
    const username = `soak_vu_${i}_${RUN_ID}`;
    const email    = `${username}@lt.invalid`;
    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email, password: 'LoadTest!123' }),
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
          const content = `soak ${nonce} vu${__VU}`;
          pendingSends.set(nonce, Date.now());
          socket.send(JSON.stringify({ type: 'send_message', channel_id: channelId, content }));
          msgsSent.add(1);
        }, SEND_INTERVAL_MS);

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
            if (msg.content === `soak ${n} vu${__VU}`) {
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

      // Stay connected for the entire soak plus ramp-down
      socket.setTimeout(() => socket.close(), (SOAK_MINUTES * 60 + 120) * 1000);
    },
  );

  check(res, { 'ws 101': (r) => r && r.status === 101 });
}
