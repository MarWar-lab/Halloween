import { useCallback, useEffect, useRef, useState } from 'react';
import { connect, type Backend, type Connection, type GameSnapshot } from '../net';
import type { CharacterLook } from '../game/types';
import { lookFromSeed } from '../scene/character';

export type ViewMode = 'host' | 'player' | 'stage';

export interface Session {
  gameId: string;
  code: string;
  /** Null on the Stage, which watches without taking a seat. */
  playerId: string | null;
  isHost: boolean;
  view: ViewMode;
}

/** Per tab, not per browser — that is what lets one machine run the Stage and
 *  several players side by side. */
const SESSION_KEY = 'campfire:session';

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* Private mode. The game still works for this tab's lifetime. */
  }
}

export interface Campfire {
  connection: Connection | null;
  backend: Backend | null;
  session: Session | null;
  snapshot: GameSnapshot | null;
  error: string | null;
  busy: boolean;
  createGame(name: string, look: CharacterLook, deckId: string, themeId: string): Promise<void>;
  joinGame(code: string, name: string, look: CharacterLook): Promise<void>;
  watchStage(code: string): Promise<void>;
  leave(): void;
  clearError(): void;
}

export function useCampfire(): Campfire {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const backendRef = useRef<Backend | null>(null);

  useEffect(() => {
    let cancelled = false;
    void connect().then((c) => {
      if (cancelled) return;
      backendRef.current = c.backend;
      setConnection(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-attach to an existing game after a refresh. Score, character and seat
  // all survive, because none of them live in this tab.
  useEffect(() => {
    const backend = connection?.backend;
    if (!backend || !session) return;

    let cancelled = false;
    void backend.resume(session.gameId).then((r) => {
      if (cancelled || session.view === 'stage') return;
      if (r.playerId && r.playerId !== session.playerId) {
        setSession((s) => (s ? { ...s, playerId: r.playerId, isHost: r.isHost } : s));
      }
    });
    return () => {
      cancelled = true;
    };
    // Only when the game changes — not on every session field update.
  }, [connection, session?.gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const backend = connection?.backend;
    if (!backend || !session) return;
    return backend.subscribe(session.gameId, setSnapshot);
  }, [connection, session?.gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const backend = connection?.backend;
    if (!backend || !session?.playerId) return;
    backend.heartbeat(session.gameId);
    const tick = window.setInterval(() => backend.heartbeat(session.gameId), 8000);
    return () => window.clearInterval(tick);
  }, [connection, session?.gameId, session?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, []);

  const createGame = useCallback(
    (name: string, look: CharacterLook, deckId: string, themeId: string) =>
      guard(async () => {
        const backend = backendRef.current;
        if (!backend) throw new Error('Still connecting — try again in a moment.');
        const { gameId, code, playerId } = await backend.createGame(deckId, themeId, name, look);
        setSession({ gameId, code, playerId, isHost: true, view: 'host' });
      }),
    [guard],
  );

  const joinGame = useCallback(
    (code: string, name: string, look: CharacterLook) =>
      guard(async () => {
        const backend = backendRef.current;
        if (!backend) throw new Error('Still connecting — try again in a moment.');
        const { gameId, playerId } = await backend.joinGame(code, name, look);
        const { isHost } = await backend.resume(gameId);
        setSession({
          gameId,
          code: code.trim().toUpperCase(),
          playerId,
          isHost,
          view: isHost ? 'host' : 'player',
        });
      }),
    [guard],
  );

  const watchStage = useCallback(
    (code: string) =>
      guard(async () => {
        const backend = backendRef.current;
        if (!backend) throw new Error('Still connecting — try again in a moment.');
        const gameId = await backend.resolveCode(code);
        if (!gameId) throw new Error(`No live game with the code ${code.toUpperCase()}.`);
        setSession({
          gameId,
          code: code.trim().toUpperCase(),
          playerId: null,
          isHost: false,
          view: 'stage',
        });
      }),
    [guard],
  );

  const leave = useCallback(() => {
    setSession(null);
    setSnapshot(null);
  }, []);

  // A `?c=CODE&v=stage` link opens the Stage on its own. This has to wait for
  // the backend to finish connecting — doing it on mount races `connect()` and
  // fails silently on a screen that has nowhere to show the error.
  useEffect(() => {
    if (!connection || session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('v') !== 'stage') return;
    const code = params.get('c');
    if (code) void watchStage(code);
  }, [connection, session, watchStage]);

  return {
    connection,
    backend: connection?.backend ?? null,
    session,
    snapshot,
    error,
    busy,
    createGame,
    joinGame,
    watchStage,
    leave,
    clearError: () => setError(null),
  };
}

/** A sensible starting character, so nobody faces an empty customiser. */
export const defaultLook = (seed: string): CharacterLook => lookFromSeed(seed || 'campfire');
