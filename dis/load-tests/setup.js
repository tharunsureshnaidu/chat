/**
 * setup.js  — k6 setup phase
 *
 * Runs ONCE before any VUs start.  Creates the shared test channel and seeds
 * N test accounts (one per VU).  Returns data that every VU receives.
 *
 * Run order:  setup()  →  default() [per VU]  →  teardown()
 */

import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL  = __ENV.BASE_URL  || 'http://localhost:3000';
export const WS_URL    = __ENV.WS_URL    || 'ws://localhost:3000/ws';
export const VU_COUNT  = parseInt(__ENV.VU_COUNT  || '100', 10);
// How many VUs share each channel (avoids creating VU_COUNT separate channels)
export const USERS_PER_CHANNEL = parseInt(__ENV.USERS_PER_CHANNEL || '50', 10);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Register a single user and return { token, user, channelId } */
export function registerUser(suffix) {
  const username = `loadtest_${suffix}_${Date.now()}`;
  const email    = `${username}@loadtest.invalid`;
  const password = 'LoadTest!123';

  const res = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ username, email, password }),
    { headers: JSON_HEADERS },
  );
  check(res, { 'register 201': (r) => r.status === 201 });
  if (res.status !== 201) {
    fail(`register failed for ${username}: ${res.status} ${res.body}`);
  }
  const body = res.json();
  return { token: body.token, user: body.user };
}

/** Create a public channel and return its id */
export function createChannel(token, suffix) {
  const res = http.post(
    `${BASE_URL}/api/channels`,
    JSON.stringify({
      name:      `loadtest-${suffix}-${Date.now()}`,
      is_public: true,
    }),
    { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } },
  );
  check(res, { 'create channel 201': (r) => r.status === 201 });
  if (res.status !== 201) {
    fail(`create channel failed: ${res.status} ${res.body}`);
  }
  return res.json().id;
}

/** Join an existing channel */
export function joinChannel(token, channelId) {
  const res = http.post(
    `${BASE_URL}/api/channels/${channelId}/join`,
    null,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // 204 = joined, 409 = already member — both are fine
  check(res, { 'join channel OK': (r) => r.status === 204 || r.status === 409 });
}

export default function setup() {
  const channels = [];
  const users    = [];

  // Create ceil(VU_COUNT / USERS_PER_CHANNEL) channels, each owned by its
  // own admin account so no single user is a bottleneck.
  const channelCount = Math.ceil(VU_COUNT / USERS_PER_CHANNEL);
  for (let c = 0; c < channelCount; c++) {
    const admin = registerUser(`admin_ch${c}`);
    const chId  = createChannel(admin.token, `ch${c}`);
    channels.push({ id: chId, adminToken: admin.token });
  }

  // Create one account per VU and join its assigned channel.
  for (let i = 0; i < VU_COUNT; i++) {
    const u   = registerUser(`vu${i}`);
    const chIdx = Math.floor(i / USERS_PER_CHANNEL);
    const ch    = channels[chIdx];
    joinChannel(u.token, ch.id);
    users.push({ token: u.token, user: u.user, channelId: ch.id });
  }

  console.log(`Setup complete: ${users.length} users across ${channels.length} channels`);
  return { users };
}
