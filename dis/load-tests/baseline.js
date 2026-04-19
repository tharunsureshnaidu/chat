/**
 * baseline.js  ─  Stage 1: local baseline
 *
 * WHAT THIS TESTS
 * ───────────────
 * Each VU:  connect WS → authenticate → subscribe → chat loop
 *   • Sends a message every SEND_INTERVAL_MS milliseconds
 *   • Receives echoed messages from the server
 *   • Measures connect time, message delivery latency, error rate
 *
 * THRESHOLDS (what "pass" looks like for a well-tuned local box)
 * ───────────────────────────────────────────────────────────────
 * ws_connect_time    p95 < 200 ms   (WebSocket handshake + auth)
 * msg_latency        p95 < 1 000 ms (send → echo received)
 * ws_errors          < 1 %          (abnormal closes / parse errors)
 * http_req_failed    < 0.1 %        (REST failures during setup)
 *
 * HOW TO RUN (after `cargo run` is up)
 * ──────────────────────────────────────
 *   # 100 VUs baseline (default)
 *   k6 run load-tests/baseline.js
 *
 *   # 500 VUs, custom URL
 *   k6 run --env VU_COUNT=500 --env BASE_URL=http://localhost:3000 load-tests/baseline.js
 *
 *   # Output results to JSON for later analysis
 *   k6 run --out json=load-tests/results/baseline-$(date +%s).json load-tests/baseline.js
 */

import ws     from 'k6/ws';
import http   from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const connectTime  = new Trend('ws_connect_time',  true);  // ms, true = percentiles
const msgLatency   = new Trend('msg_latency',      true);  // ms, send → receipt
const wsErrors     = new Rate('ws_errors');                // ratio
const msgsSent     = new Counter('messages_sent');
const msgsReceived = new Counter('messages_received');

// ── Config from env ───────────────────────────────────────────────────────────
const BASE_URL           = __ENV.BASE_URL           || 'http://localhost:3000';
const WS_URL             = __ENV.WS_URL             || 'ws://localhost:3000/ws';
const VU_COUNT           = parseInt(__ENV.VU_COUNT  || '100', 10);
const USERS_PER_CHANNEL  = parseInt(__ENV.USERS_PER_CHANNEL || '50', 10);
const SEND_INTERVAL_MS   = parseInt(__ENV.SEND_INTERVAL_MS  || '3000', 10);
const TEST_DURATION_SECS = parseInt(__ENV.TEST_DURATION_SECS || '60', 10);

// ── k6 options ────────────────────────────────────────────────────────────────
export const options = {
  // Ramp up, sustain, ramp down
  stages: [
    { duration: '20s', target: VU_COUNT },         // ramp up
    { duration: `${TEST_DURATION_SECS}s`, target: VU_COUNT }, // sustain
    { duration: '10s', target: 0 },                // ramp down
  ],

  thresholds: {
    // WebSocket handshake (including auth) must be fast
    ws_connect_time:  ['p(95)<200'],
    // Message round-trip (send → server echo) under 1 second p95
    msg_latency:      ['p(95)<1000'],
    // Less than 1% of WS connections should error
    ws_errors:        ['rate<0.01'],
    // Less than 0.1% of HTTP calls (setup) should fail
    http_req_failed:  ['rate<0.001'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ── Setup — runs ONCE before all VUs ─────────────────────────────────────────
export function setup() {
  const channels = [];
  const users    = [];
  const channelCount = Math.ceil(VU_COUNT / USERS_PER_CHANNEL);

  for (let c = 0; c < channelCount; c++) {
    const username = `lt_admin_c${c}_${__ITER}`;
    const email    = `${username}@lt.invalid`;
    const password = 'LoadTest!123';

    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email, password }),
      { headers: JSON_HEADERS },
    );
    if (reg.status !== 201) fail(`Admin register failed: ${reg.body}`);
    const admin = reg.json();

    const ch = http.post(
      `${BASE_URL}/api/channels`,
      JSON.stringify({ name: `lt-ch-${c}-${__ITER}`, is_public: true }),
      { headers: { ...JSON_HEADERS, Authorization: `Bearer ${admin.token}` } },
    );
    if (ch.status !== 201) fail(`Channel create failed: ${ch.body}`);
    channels.push({ id: ch.json().id });
  }

  for (let i = 0; i < VU_COUNT; i++) {
    const username = `lt_vu_${i}_${__ITER}`;
    const email    = `${username}@lt.invalid`;
    const password = 'LoadTest!123';

    const reg = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ username, email, password }),
      { headers: JSON_HEADERS },
    );
    if (reg.status !== 201) fail(`VU register failed: ${reg.body}`);
    const { token, user } = reg.json();

    const chIdx = Math.floor(i / USERS_PER_CHANNEL);
    const chId  = channels[chIdx].id;

    http.post(
      `${BASE_URL}/api/channels/${chId}/join`,
      null,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    users.push({ token, user, channelId: chId });
  }

  console.log(`Setup: ${users.length} VUs seeded across ${channels.length} channels`);
  return { users };
}

// ── Main VU scenario ──────────────────────────────────────────────────────────
export default function scenario({ users }) {
  // Each VU picks its own pre-seeded credentials
  const { token, user, channelId } = users[__VU - 1] ?? users[0];

  const connectStart = Date.now();
  const url          = `${WS_URL}?token=${encodeURIComponent(token)}`;

  // Outbound message timestamps keyed by a nonce so we can compute RTT
  const pendingSends = new Map();   // nonce → sentAt (ms)
  let   nonce        = 0;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      connectTime.add(Date.now() - connectStart);

      // Subscribe to the assigned channel
      socket.send(JSON.stringify({ type: 'subscribe', channel_id: channelId }));

      // Periodic message sender
      socket.setInterval(() => {
        nonce++;
        const content = `ping ${nonce} from ${user.username}`;
        pendingSends.set(nonce, Date.now());
        socket.send(JSON.stringify({ type: 'send_message', channel_id: channelId, content }));
        msgsSent.add(1);
      }, SEND_INTERVAL_MS);

      // Heartbeat ping to keep the connection alive & measure pong RTT
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        wsErrors.add(1);
        return;
      }

      if (msg.type === 'new_message') {
        msgsReceived.add(1);
        // If this is the echo of our own send, record the latency
        // The server echoes back the exact content so we can match.
        // We match to the FIRST pending send whose content matches.
        for (const [n, sentAt] of pendingSends.entries()) {
          const expected = `ping ${n} from ${user.username}`;
          if (msg.content === expected) {
            msgLatency.add(Date.now() - sentAt);
            pendingSends.delete(n);
            break;
          }
        }
      } else if (msg.type === 'error') {
        wsErrors.add(1);
        console.warn(`VU ${__VU}: server error: ${msg.message}`);
      }
    });

    socket.on('error', (e) => {
      wsErrors.add(1);
      console.error(`VU ${__VU}: ws error: ${e}`);
    });

    socket.on('close', (code) => {
      if (code !== 1000 && code !== 1001) {
        // Abnormal close (1000 = normal, 1001 = going away)
        wsErrors.add(1);
        console.warn(`VU ${__VU}: abnormal close code=${code}`);
      }
    });

    // Keep the socket alive for the whole test duration
    socket.setTimeout(() => {
      socket.close();
    }, (TEST_DURATION_SECS + 40) * 1000);
  });

  check(res, { 'ws connect status 101': (r) => r && r.status === 101 });
}
