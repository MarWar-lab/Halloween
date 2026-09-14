import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { client } = vi.hoisted(() => ({ client: {
  rpc: vi.fn(), from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
} }));
vi.mock('../../lib/supabase', () => ({ supabase: client, isConfigured: true, ensureSession: vi.fn() }));
import { SupabaseSurvivalBackend } from './supabase';

let listeners: (() => Promise<void>)[];
let stops: (() => void)[];
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.resetAllMocks();
  listeners = [];
  stops = [];
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((_event, _filter, callback) => { listeners.push(callback); return channel; });
  channel.subscribe.mockReturnValue(channel);
  client.channel.mockReturnValue(channel);
  client.rpc.mockImplementation(async (fn, args) => ({ data:
    fn === 'survival_resume' ? [{ player_id: `seat-${args.p_game}`, is_host: false }]
    : fn === 'survival_progress' ? [{ answered: [], pleaded: [], voted: [] }] : [], error: null,
  }));
  client.from.mockImplementation((table) => {
    let gameId = '';
    const query = {
      select: () => query,
      eq: (_key: string, id: string) => { gameId = id; return query; },
      order: () => query,
      maybeSingle: () => Promise.resolve({ data: {
        id: gameId, code: 'TEST', phase: 'running', question_idx: 0, revealed: false,
      }, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data:
        table === 'survival_scores' ? [{ player_id: `seat-${gameId}`, question_idx: 0, survival_pct: 55 }] : [],
        error: null,
      }).then(resolve),
    };
    return query;
  });
});
afterEach(() => { stops.forEach((stop) => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('resolves the private score for each newly joined room instead of reusing the old seat', async () => {
  const backend = new SupabaseSurvivalBackend();
  const first = vi.fn();
  const second = vi.fn();
  const stop = backend.subscribe('one', first); stops.push(stop);
  await flush(); stop();
  stops.push(backend.subscribe('two', second));
  await flush();
  expect(first.mock.lastCall![0].myScores).toEqual([{ questionIdx: 0, survivalPct: 55 }]);
  expect(second.mock.lastCall![0].myScores).toEqual([{ questionIdx: 0, survivalPct: 55 }]);
  expect(client.rpc).toHaveBeenCalledWith('survival_resume', { p_game: 'two' });
});

it('reports a failed refresh and recovers on the next poll', async () => {
  const backend = new SupabaseSurvivalBackend();
  const onChange = vi.fn(); const onError = vi.fn();
  client.rpc.mockRejectedValueOnce(new Error('Network unavailable'));
  stops.push(backend.subscribe('one', onChange, onError));
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
  expect(onChange).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4000);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenLastCalledWith(null);
});

it('queues realtime updates behind an in-flight refresh and refreshes immediately after a choice', async () => {
  let release!: (value: unknown) => void;
  client.rpc.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const backend = new SupabaseSurvivalBackend(); const onChange = vi.fn();
  stops.push(backend.subscribe('one', onChange));
  await listeners[0](); await listeners[1]();
  expect(client.rpc).toHaveBeenCalledTimes(1);
  release({ data: [{ player_id: 'seat-one' }], error: null });
  await flush();
  expect(onChange).toHaveBeenCalledTimes(2);
  await backend.answer('one', 2); await flush();
  expect(onChange).toHaveBeenCalledTimes(3);
});

it('does not publish empty data when a table read fails', async () => {
  client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: null, error: { message: 'Connection lost' },
  }) }) }) });
  const onChange = vi.fn(); const onError = vi.fn();
  stops.push(new SupabaseSurvivalBackend().subscribe('one', onChange, onError));
  await flush();
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Connection lost'));
});
