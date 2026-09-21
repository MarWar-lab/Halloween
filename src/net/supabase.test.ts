import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { client } = vi.hoisted(() => ({ client: {
  rpc: vi.fn(), from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
} }));
vi.mock('../lib/supabase', () => ({ supabase: client, isConfigured: true, ensureSession: vi.fn() }));
vi.mock('../lib/clock', () => ({ syncClock: vi.fn() }));
import { SupabaseBackend } from './supabase';

let stops: (() => void)[];
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.resetAllMocks();
  stops = [];
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation(() => channel);
  channel.subscribe.mockReturnValue(channel);
  client.channel.mockReturnValue(channel);
  client.rpc.mockResolvedValue({ data: [], error: null });
  client.from.mockImplementation((table) => {
    let gameId = '';
    const query = {
      select: () => query,
      eq: (_key: string, id: string) => { gameId = id; return query; },
      order: () => query,
      maybeSingle: () => Promise.resolve({ data: {
        id: gameId, code: 'TEST', phase: 'scored', round_no: 0,
      }, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({
        data: table === 'games' ? { id: gameId, code: 'TEST', phase: 'scored', round_no: 0 } : [],
        error: null,
      }).then(resolve),
    };
    return query;
  });
});
afterEach(() => { stops.forEach((stop) => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('survives a dropped connection and keeps polling instead of dying silently', async () => {
  const backend = new SupabaseBackend();
  const onChange = vi.fn(); const onError = vi.fn();
  client.from.mockImplementationOnce(() => { throw new Error('Failed to fetch'); });
  stops.push(backend.subscribe('one', onChange, onError));
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
  expect(onChange).not.toHaveBeenCalled();

  // The next scheduled poll must still fire — this is exactly what a WiFi
  // hand-off or a brief network blip looks like: one failed round-trip,
  // then a recovered connection. Before this fix, an uncaught rejection here
  // would have stopped the setTimeout chain from ever rescheduling itself.
  await vi.advanceTimersByTimeAsync(4000);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenLastCalledWith(null);
});
