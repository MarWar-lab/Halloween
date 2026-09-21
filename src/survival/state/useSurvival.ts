/**
 * One hook holding the whole client side of the game.
 *
 * Everything a screen needs comes from here, so no view ever talks to a
 * backend directly and no view has to know which backend it is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { survivalBackend } from '../net';
import type { Snapshot } from '../types';
import { SurvivalError } from '../net/types';

export interface Session {
  gameId: string;
  code: string;
  playerId: string;
  isHost: boolean;
}

/**
 * sessionStorage, not localStorage.
 *
 * It is per-tab, so under `?net=local` — where several tabs are several
 * people — each tab keeps its own seat rather than overwriting the others'.
 * It still survives a refresh, which is the case that actually needs to work
 * mid-question.
 */
const SESSION_KEY = new URLSearchParams(window.location.search).get('net') === 'local'
  ? 'survival:session:local' : 'survival:session';

const readSession = (): Session | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Session;
    return saved && typeof saved.gameId === 'string' && typeof saved.code === 'string'
      && typeof saved.playerId === 'string' ? saved : null;
  } catch {
    return null;
  }
};

export interface Survival {
  session: Session | null;
  snapshot: Snapshot | null;
  error: string | null;
  busy: boolean;
  /** The code in the URL, so the join box can be filled in already. */
  codeFromUrl: string;
  create: (name: string) => Promise<void>;
  join: (code: string, name: string) => Promise<void>;
  leave: () => void;
  reveal: () => Promise<void>;
  advance: () => Promise<void>;
  setMode: (mode: 'solo' | 'consensus') => Promise<void>;
  answer: (optionIndex: number) => Promise<void>;
  plea: (text: string) => Promise<void>;
  vote: (targetPlayerId: string) => Promise<void>;
  /** Publish the fragment you hold for a berth. Irreversible, and meant to be. */
  postFragment: (berth: number) => Promise<void>;
  /** Put "I need this one" on the board, without having to say it out loud. */
  askForBerth: (berth: number) => Promise<void>;
  /** Name the line you think survives every published rule. Null if the call was dropped. */
  solveBerth: (berth: number, lineId: number) => Promise<{ correct: boolean } | null>;
  /** Null means the call failed or was dropped by the in-flight guard — never confuse that with a wrong-code rejection, which resolves normally. */
  escape: (code: string) => Promise<{ accepted: boolean; retryInSeconds: number } | null>;
}

export function useSurvival(): Survival {
  const backend = useMemo(() => survivalBackend(), []);
  const [session, setSession] = useState<Session | null>(readSession);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const codeFromUrl = (params.get('c') ?? '').toUpperCase();

  // Also held in a ref, so the action callbacks below can stay stable instead
  // of being rebuilt — and re-binding every button — on each snapshot. Synced
  // in an effect rather than during render: the actions only ever fire from an
  // event handler, by which time the effect has run.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const remember = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    setSnapshot(null);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  }, []);

  /** Every backend call goes through here, so one failure cannot be silent. */
  const inFlight = useRef(false);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  // Reconnect after a refresh. The seat is re-read from the backend rather
  // than trusted from localStorage, so a stale entry for a game that has
  // ended drops you back at the door instead of into a broken room.
  useEffect(() => {
    const saved = readSession();
    if (!saved) return;
    let cancelled = false;
    void (async () => {
      try {
        await backend.ready();
        const { playerId, isHost } = await backend.resume(saved.gameId);
        if (cancelled) return;
        if (!playerId) {
          remember(null);
          return;
        }
        remember({ ...saved, playerId, isHost });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SurvivalError && err.code === 'no_such_game') remember(null);
        // The subscription reports connection failures and keeps retrying.
        // Preserve the saved seat across a temporary outage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, remember]);

  useEffect(() => {
    if (!session) return;
    return backend.subscribe(session.gameId, setSnapshot, setError);
  }, [backend, session]);

  useEffect(() => {
    if (!session?.playerId) return;
    const gameId = session.gameId;
    const tick = () => backend.heartbeat(gameId);
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, [backend, session]);

  const create = useCallback(
    (name: string) =>
      run(async () => {
        await backend.ready();
        const { gameId, code, playerId } = await backend.create(name);
        remember({ gameId, code, playerId, isHost: true });
      }),
    [backend, remember, run],
  );

  const join = useCallback(
    (code: string, name: string) =>
      run(async () => {
        await backend.ready();
        const { gameId, playerId } = await backend.join(code, name);
        const { isHost } = await backend.resume(gameId);
        remember({
          gameId,
          code: code.trim().toUpperCase(),
          playerId,
          isHost,
        });
      }),
    [backend, remember, run],
  );

  const leave = useCallback(() => {
    remember(null);
    setError(null);
  }, [remember]);

  const act = useCallback(
    (work: (gameId: string) => Promise<void>) => () =>
      run(async () => {
        const current = sessionRef.current;
        if (!current) return;
        await work(current.gameId);
      }),
    [run],
  );

  /** Same guard and error funnelling as `run`, but for the one call whose result the caller actually needs back. */
  const runFor = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const solveBerth = useCallback(
    (berth: number, lineId: number) =>
      runFor(async () => {
        const current = sessionRef.current;
        if (!current) return { correct: false };
        return backend.solveBerth(current.gameId, berth, lineId);
      }),
    [backend, runFor],
  );

  const escape = useCallback(
    (code: string) =>
      runFor(async () => {
        const current = sessionRef.current;
        if (!current) return { accepted: false, retryInSeconds: 0 };
        return backend.escape(current.gameId, code);
      }),
    [backend, runFor],
  );

  return {
    session,
    snapshot,
    error,
    busy,
    codeFromUrl,
    create,
    join,
    leave,
    reveal: act((id) => backend.reveal(id)),
    advance: act((id) => backend.advance(id)),
    setMode: (mode: 'solo' | 'consensus') => act((id) => backend.setMode(id, mode))(),
    answer: (optionIndex: number) => act((id) => backend.answer(id, optionIndex))(),
    plea: (text: string) => act((id) => backend.plea(id, text))(),
    vote: (target: string) => act((id) => backend.vote(id, target))(),
    postFragment: (berth: number) => act((id) => backend.postFragment(id, berth))(),
    askForBerth: (berth: number) => act((id) => backend.askForBerth(id, berth))(),
    solveBerth,
    escape,
  };
}
