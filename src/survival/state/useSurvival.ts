/**
 * One hook holding the whole client side of the game.
 *
 * Everything a screen needs comes from here, so no view ever talks to a
 * backend directly and no view has to know which backend it is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { survivalBackend } from '../net';
import type { Snapshot } from '../types';

export type View = 'screen' | 'player';

export interface Session {
  gameId: string;
  code: string;
  /** Null on the shared screen, which watches without taking a seat. */
  playerId: string | null;
  isHost: boolean;
  view: View;
}

/**
 * sessionStorage, not localStorage, and the difference matters twice.
 *
 * It is per-tab, so the shared screen can be opened beside a player without
 * one overwriting the other — and under `?net=local`, where several tabs are
 * several people, each tab keeps its own seat. It still survives a refresh,
 * which is the case that actually needs to work mid-question.
 */
const SESSION_KEY = 'survival:session';

const readSession = (): Session | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
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
  openScreen: (code: string) => Promise<void>;
  leave: () => void;
  reveal: () => Promise<void>;
  advance: () => Promise<void>;
  answer: (optionIndex: number) => Promise<void>;
  plea: (text: string) => Promise<void>;
  vote: (targetPlayerId: string) => Promise<void>;
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
    setSession(next);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  }, []);

  /** Every backend call goes through here, so one failure cannot be silent. */
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
        if (saved.view === 'screen') return;
        if (!playerId) {
          remember(null);
          return;
        }
        remember({ ...saved, playerId, isHost });
      } catch {
        if (!cancelled) remember(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, remember]);

  useEffect(() => {
    if (!session) return;
    return backend.subscribe(session.gameId, setSnapshot);
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
        remember({ gameId, code, playerId, isHost: true, view: 'player' });
      }),
    [backend, remember, run],
  );

  const join = useCallback(
    (code: string, name: string) =>
      run(async () => {
        await backend.ready();
        const { gameId, playerId } = await backend.join(code, name);
        remember({
          gameId,
          code: code.trim().toUpperCase(),
          playerId,
          isHost: false,
          view: 'player',
        });
      }),
    [backend, remember, run],
  );

  /** Open the shared screen in a second tab, without taking a seat. */
  const openScreen = useCallback(
    (code: string) =>
      run(async () => {
        await backend.ready();
        const gameId = await backend.resolveCode(code);
        if (!gameId) throw new Error('No game with that code.');
        remember({
          gameId,
          code: code.trim().toUpperCase(),
          playerId: null,
          isHost: false,
          view: 'screen',
        });
      }),
    [backend, remember, run],
  );

  const leave = useCallback(() => {
    remember(null);
    setSnapshot(null);
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

  return {
    session,
    snapshot,
    error,
    busy,
    codeFromUrl,
    create,
    join,
    openScreen,
    leave,
    reveal: act((id) => backend.reveal(id)),
    advance: act((id) => backend.advance(id)),
    answer: (optionIndex: number) => act((id) => backend.answer(id, optionIndex))(),
    plea: (text: string) => act((id) => backend.plea(id, text))(),
    vote: (target: string) => act((id) => backend.vote(id, target))(),
  };
}
