'use client';

import { useEffect, useState } from 'react';
import { ApiClient } from '@dis/api';

const POLL_INTERVAL_MS = 30_000;

export function usePresence(
  api: ApiClient,
  userIds: readonly string[],
  enabled = true
): Record<string, boolean> {
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  // Use the joined string as a stable cache key so the effect only re-runs
  // when the SET of ids changes, not on every fresh array reference.
  const key = userIds.join('|');

  useEffect(() => {
    if (!enabled || userIds.length === 0) {
      setStatuses({});
      return;
    }

    let cancelled = false;
    const ids = userIds;

    async function poll() {
      const results = await Promise.allSettled(ids.map((id) => api.getPresence(id)));
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[ids[i]!] = r.value.online;
      });
      setStatuses(next);
    }

    poll();
    const handle = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled, key]);

  return statuses;
}
