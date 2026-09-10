/**
 * Server clock offset.
 *
 * Round deadlines are set by Postgres as absolute timestamps. Client clocks
 * drift — a laptop a minute fast would otherwise show a player a minute less
 * time than everyone else, which looks like a bug and feels like cheating. So
 * we measure the offset once at join and render every countdown against it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

let offsetMs = 0;
let synced = false;

export async function syncClock(client: SupabaseClient): Promise<number> {
  const samples: number[] = [];

  // Three samples, keep the one with the shortest round trip — the least
  // polluted by network latency.
  for (let i = 0; i < 3; i += 1) {
    const sentAt = Date.now();
    const { data, error } = await client.rpc('server_now');
    if (error || !data) continue;
    const receivedAt = Date.now();
    const rtt = receivedAt - sentAt;
    const serverMs = new Date(data as string).getTime();
    // Assume the server read its clock halfway through the round trip.
    samples.push(serverMs - (sentAt + rtt / 2));
  }

  if (samples.length > 0) {
    samples.sort((a, b) => a - b);
    offsetMs = samples[Math.floor(samples.length / 2)];
    synced = true;
  }
  return offsetMs;
}

export const isClockSynced = () => synced;

/** Best estimate of the server's current time, in ms. */
export const serverNow = (): number => Date.now() + offsetMs;

/** Whole seconds remaining until an ISO deadline; never negative. */
export function secondsUntil(deadlineIso: string | null | undefined): number {
  if (!deadlineIso) return 0;
  const ms = new Date(deadlineIso).getTime() - serverNow();
  return Math.max(0, Math.ceil(ms / 1000));
}

/** m:ss for display. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
