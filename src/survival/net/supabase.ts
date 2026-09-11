/**
 * Supabase backend — the real one, and the only one where the seal holds.
 *
 * Percentages live in `survival_options`, which has row-level security on, no
 * policy and no grant. Nothing in this file reads it. The only way a figure
 * reaches a browser is `survival_scores`, whose policy hands you your own rows
 * and nobody else's until the tribunal.
 *
 * Note what is NOT imported here: src/survival/sealed.ts. That is enforced by
 * a test, because the day it gets imported is the day the game stops working
 * and nothing visibly breaks.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureSession, isConfigured, supabase } from '../../lib/supabase';
import type {
  Answer,
  Game,
  MyScore,
  Phase,
  Player,
  Plea,
  RevealRow,
  Snapshot,
  Standing,
  Vote,
  Winner,
} from '../types';
import { SurvivalError, type SurvivalBackend } from './types';

interface GameRow {
  id: string;
  code: string;
  host_user_id: string;
  phase: string;
  question_idx: number;
  revealed: boolean;
  created_at: string;
}

const rowToGame = (r: GameRow): Game => ({
  id: r.id,
  code: r.code,
  hostUserId: r.host_user_id,
  phase: r.phase as Phase,
  questionIdx: r.question_idx,
  revealed: r.revealed,
  createdAt: r.created_at,
});

const rowToPlayer = (r: {
  id: string; game_id: string; user_id: string | null; name: string; last_seen: string;
}): Player => ({
  id: r.id,
  gameId: r.game_id,
  userId: r.user_id,
  name: r.name,
  lastSeen: r.last_seen,
});

/** Turns a Postgres error into something worth showing a player. */
function fail(message: string, detail?: string): never {
  throw new SurvivalError(detail ? `${message} (${detail})` : message);
}

export class SupabaseSurvivalBackend implements SurvivalBackend {
  readonly kind = 'supabase' as const;

  private client: SupabaseClient;

  constructor() {
    if (!supabase) throw new SurvivalError('Supabase is not configured.', 'not_configured');
    this.client = supabase;
  }

  /**
   * Prove the database is actually in the state this build expects, before
   * anyone joins — rather than mid-question, when the room is watching.
   */
  async ready() {
    if (!isConfigured) throw new SurvivalError('Supabase is not configured.', 'not_configured');
    await ensureSession();

    const MISSING = '00000000-0000-0000-0000-000000000000';
    const probes: { fn: string; args: Record<string, unknown>; why: string }[] = [
      {
        fn: 'survival_resolve_code',
        args: { p_code: 'ZZZZ' },
        why: 'nobody would be able to join a room',
      },
      {
        fn: 'survival_progress',
        args: { p_game: MISSING },
        why: 'the host could never tell who had answered',
      },
      {
        fn: 'survival_reveal_data',
        args: { p_game: MISSING, p_idx: 0 },
        why: 'the outcomes could never be shown',
      },
    ];

    for (const probe of probes) {
      const { error } = await this.client.rpc(probe.fn, probe.args);
      // A missing row is fine; a missing function is not.
      if (error && /(does not exist|schema cache|not find)/i.test(error.message)) {
        fail(
          `The database is behind this build — ${probe.why}. Apply supabase/migrations/20260912090000_survival.sql.`,
          probe.fn,
        );
      }
    }
  }

  async create(name: string) {
    await ensureSession();
    const { data, error } = await this.client.rpc('survival_create', { p_name: name });
    if (error || !data) fail('Could not open a room.', error?.message);
    const game = rowToGame(data as GameRow);
    const { data: seat } = await this.client.rpc('survival_resume', { p_game: game.id });
    const row = Array.isArray(seat) ? seat[0] : seat;
    return { gameId: game.id, code: game.code, playerId: (row?.player_id as string) ?? '' };
  }

  async join(code: string, name: string) {
    await ensureSession();
    const { data, error } = await this.client.rpc('survival_join', {
      p_code: code.trim().toUpperCase(),
      p_name: name,
    });
    if (error) fail('Could not join that room.', error.message);
    const player = data as { id: string; game_id: string };
    return { gameId: player.game_id, playerId: player.id };
  }

  async resume(gameId: string) {
    await ensureSession();
    const { data } = await this.client.rpc('survival_resume', { p_game: gameId });
    const row = Array.isArray(data) ? data[0] : data;
    return {
      playerId: (row?.player_id as string | null) ?? null,
      isHost: Boolean(row?.is_host),
    };
  }

  async resolveCode(code: string) {
    await ensureSession();
    const { data } = await this.client.rpc('survival_resolve_code', {
      p_code: code.trim().toUpperCase(),
    });
    return (data as string | null) ?? null;
  }

  private async fetchSnapshot(gameId: string): Promise<Snapshot | null> {
    const { data: gameRow } = await this.client
      .from('survival_games').select('*').eq('id', gameId).maybeSingle();
    if (!gameRow) return null;
    const game = rowToGame(gameRow as GameRow);

    const [{ data: playerRows }, { data: answerRows }, { data: scoreRows },
           { data: pleaRows }, { data: voteRows }, { data: progressRows }] =
      await Promise.all([
        this.client.from('survival_players').select('*').eq('game_id', gameId).order('joined_at'),
        this.client.from('survival_answers').select('*').eq('game_id', gameId),
        this.client.from('survival_scores').select('*').eq('game_id', gameId),
        this.client.from('survival_pleas').select('*').eq('game_id', gameId),
        this.client.from('survival_votes').select('*').eq('game_id', gameId),
        this.client.rpc('survival_progress', { p_game: gameId }),
      ]);

    // Everything below has already been filtered by row-level security. The
    // client is not choosing what to hide — it could not see the rest to hide
    // it. That is the whole point of the schema.
    const progress = (Array.isArray(progressRows) ? progressRows[0] : progressRows) as
      { answered: string[]; pleaded: string[]; voted: string[] } | null;

    const answers: Answer[] = (answerRows ?? []).map((r) => ({
      playerId: r.player_id,
      questionIdx: r.question_idx,
      optionIndex: r.option_index,
      autoAssigned: r.auto_assigned,
    }));

    const myScores: MyScore[] = (scoreRows ?? [])
      .map((r) => ({ questionIdx: r.question_idx, survivalPct: r.survival_pct, playerId: r.player_id }))
      .filter((s) => s.playerId === this.seatId)
      .map(({ questionIdx, survivalPct }) => ({ questionIdx, survivalPct }))
      .sort((a, b) => a.questionIdx - b.questionIdx);

    let reveal: RevealRow[] | null = null;
    if (game.phase === 'running' && game.revealed) {
      const { data } = await this.client.rpc('survival_reveal_data', {
        p_game: gameId,
        p_idx: game.questionIdx,
      });
      reveal = (data ?? []).map((r: { option_index: number; label: string; outcome: string; takers: number }) => ({
        optionIndex: r.option_index,
        label: r.label,
        outcome: r.outcome,
        takers: r.takers,
      }));
    }

    // Refused before the tribunal, deliberately and loudly. A null here means
    // "the seal is still on", not "something went wrong".
    let standings: Standing[] | null = null;
    let winner: Winner[] | null = null;
    if (game.phase === 'tribunal' || game.phase === 'result') {
      const { data } = await this.client.rpc('survival_standings', { p_game: gameId });
      standings = (data ?? []).map((r: { player_id: string; name: string; rounds: number; average: number }) => ({
        playerId: r.player_id, name: r.name, rounds: r.rounds, average: Number(r.average),
      }));
    }
    if (game.phase === 'result') {
      const { data } = await this.client.rpc('survival_winner', { p_game: gameId });
      winner = (data ?? []).map((r: { player_id: string; name: string; votes: number; average: number }) => ({
        playerId: r.player_id, name: r.name, votes: r.votes, average: Number(r.average),
      }));
    }

    return {
      game,
      players: (playerRows ?? []).map(rowToPlayer),
      answers,
      myScores,
      pleas: (pleaRows ?? []).map((r): Plea => ({ playerId: r.player_id, text: r.text })),
      votes: (voteRows ?? []).map((r): Vote => ({
        voterId: r.voter_id, targetPlayerId: r.target_player_id,
      })),
      answeredPlayerIds: progress?.answered ?? [],
      pleadedPlayerIds: progress?.pleaded ?? [],
      votedPlayerIds: progress?.voted ?? [],
      reveal,
      standings,
      winner,
    };
  }

  /** Which seat this browser holds, so its own score rows can be told apart. */
  private seatId: string | null = null;

  subscribe(gameId: string, onChange: (snapshot: Snapshot) => void) {
    let stopped = false;
    let waiting = false;

    const push = async () => {
      if (stopped) return;
      if (!this.seatId) this.seatId = (await this.resume(gameId)).playerId;
      const snap = await this.fetchSnapshot(gameId);
      if (!snap || stopped) return;
      // While the room is choosing, the host is watching a counter to decide
      // when to open the question. Lag there is a host wondering if someone is
      // stuck; everywhere else the only changes come from the host and those
      // already arrive over realtime.
      waiting = snap.game.phase === 'running' && !snap.game.revealed;
      onChange(snap);
    };

    const channel = this.client
      .channel(`survival:${gameId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'survival_games', filter: `id=eq.${gameId}` }, push)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'survival_players', filter: `game_id=eq.${gameId}` }, push)
      .subscribe();

    // Answers, scores, pleas and votes are deliberately absent from the
    // realtime publication, so the only way to see them arrive is to ask.
    let timer = 0;
    const loop = async () => {
      await push();
      if (stopped) return;
      timer = window.setTimeout(loop, waiting ? 1200 : 4000);
    };
    void loop();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      this.client.removeChannel(channel);
    };
  }

  private async call(fn: string, args: Record<string, unknown>, whenItFails: string) {
    const { error } = await this.client.rpc(fn, args);
    if (error) fail(whenItFails, error.message);
  }

  reveal = (gameId: string) =>
    this.call('survival_reveal', { p_game: gameId }, 'Could not open the outcomes.');

  advance = (gameId: string) =>
    this.call('survival_advance', { p_game: gameId }, 'Could not move the game on.');

  answer = (gameId: string, optionIndex: number) =>
    this.call('survival_answer', { p_game: gameId, p_option: optionIndex },
      'Your choice did not go through.');

  plea = (gameId: string, text: string) =>
    this.call('survival_plea', { p_game: gameId, p_text: text }, 'Your plea did not go through.');

  vote = (gameId: string, targetPlayerId: string) =>
    this.call('survival_vote', { p_game: gameId, p_target: targetPlayerId },
      'Your vote did not go through.');

  heartbeat(gameId: string) {
    void this.client.rpc('survival_heartbeat', { p_game: gameId });
  }
}
