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
  Seat,
  SeatPath,
  Snapshot,
  Standing,
  Vote,
} from '../types';
import { seatsFor } from '../types';
import { ruleText, type Rule } from '../puzzles';
import { SurvivalError, type SurvivalBackend } from './types';

interface GameRow {
  id: string;
  code: string;
  host_user_id: string;
  phase: string;
  question_idx: number;
  revealed: boolean;
  created_at: string;
  mode: 'solo' | 'consensus';
}

const rowToGame = (r: GameRow): Game => ({
  id: r.id,
  code: r.code,
  hostUserId: r.host_user_id,
  phase: r.phase as Phase,
  questionIdx: r.question_idx,
  revealed: r.revealed,
  createdAt: r.created_at,
  mode: r.mode,
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
      {
        fn: 'survival_escape',
        args: { p_game: MISSING, p_attempt: '0000' },
        why: 'nobody could try the extraction code',
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
    const { playerId } = await this.resume(game.id);
    if (!playerId) fail('The room opened, but your seat could not be restored. Rejoin using the room code.', game.code);
    return { gameId: game.id, code: game.code, playerId };
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
    const { data, error } = await this.client.rpc('survival_resume', { p_game: gameId });
    if (error) fail('Could not restore your seat.', error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      playerId: (row?.player_id as string | null) ?? null,
      isHost: Boolean(row?.is_host),
    };
  }

  private async fetchSnapshot(gameId: string, seatId: string | null): Promise<Snapshot | null> {
    const { data: gameRow, error: gameError } = await this.client
      .from('survival_games').select('*').eq('id', gameId).maybeSingle();
    if (gameError) fail('Could not refresh the room.', gameError.message);
    if (!gameRow) fail('This room is no longer available. Leave to join another room.');
    const game = rowToGame(gameRow as GameRow);

    const responses = await Promise.all([
        this.client.from('survival_players').select('*').eq('game_id', gameId).order('joined_at'),
        this.client.from('survival_answers').select('*').eq('game_id', gameId),
        this.client.from('survival_scores').select('*').eq('game_id', gameId),
        this.client.from('survival_pleas').select('*').eq('game_id', gameId),
        this.client.from('survival_votes').select('*').eq('game_id', gameId),
        this.client.rpc('survival_progress', { p_game: gameId }),
        // RLS scopes this to 0-or-1 rows: only the round currently in front of
        // the room, and only if it carries a manifest line at all.
        this.client.from('survival_clue_digits').select('*')
          .eq('game_id', gameId).eq('question_idx', game.questionIdx),
        // Every team in the game, not just mine — nobody's roster is a
        // secret, so there is nothing narrower to ask RLS for. Empty in solo
        // mode, and empty before the briefing draws them.
        this.client.from('survival_team_members').select('*').eq('game_id', gameId),
        // Who to ask, on the rounds RLS didn't hand me the digit for.
        this.client.rpc('survival_current_clue_seer', { p_game: gameId }),
        // The berth puzzles. The boards are public and the posts are public;
        // the fragments table returns exactly MY rows and nobody else's,
        // which is the asymmetry the whole Exchange runs on.
        this.client.from('survival_berth_lines').select('*').eq('game_id', gameId).order('line_id'),
        this.client.from('survival_fragments').select('*').eq('game_id', gameId),
        this.client.from('survival_posts').select('*').eq('game_id', gameId).order('created_at'),
        this.client.from('survival_asks').select('*').eq('game_id', gameId),
        this.client.from('survival_solves').select('*').eq('game_id', gameId).order('created_at'),
        // Publishing is what makes a fragment readable by anybody else, so
        // the published ones come back from their own function rather than
        // from the table, which only ever returns mine.
        this.client.rpc('survival_posted_fragments', { p_game: gameId }),
        // And the seals my team has earned — the board is public but the
        // answer is not, so the digit has to be handed over, not derived.
        this.client.rpc('survival_my_digits', { p_game: gameId }),
      ]);

    for (const response of responses) {
      if (response.error) fail('Could not refresh the room.', response.error.message);
    }
    const [{ data: playerRows }, { data: answerRows }, { data: scoreRows },
      { data: pleaRows }, { data: voteRows }, { data: progressRows }, { data: clueRows },
      { data: teamRows }, { data: clueSeerName },
      { data: lineRows }, { data: fragmentRows }, { data: postRows },
      { data: askRows }, { data: solveRows },
      { data: postedRows }, { data: digitRows }] = responses;

    // Everything below has already been filtered by row-level security. The
    // client is not choosing what to hide — it could not see the rest to hide
    // it. That is the whole point of the schema.
    const progress = (Array.isArray(progressRows) ? progressRows[0] : progressRows) as
      {
        answered: string[]; pleaded: string[]; voted: string[]; escaped: string[];
        retry_in_seconds: number; team_attempts: number;
      } | null;

    const clueRow = (clueRows ?? [])[0] as { question_idx: number; digit: number } | undefined;
    const clue = clueRow ? { questionIdx: clueRow.question_idx, digit: clueRow.digit } : null;
    const clueSeer = !clue && clueSeerName ? { name: clueSeerName as string } : null;

    const answers: Answer[] = (answerRows ?? []).map((r) => ({
      playerId: r.player_id,
      questionIdx: r.question_idx,
      optionIndex: r.option_index,
      autoAssigned: r.auto_assigned,
    }));

    const myScores: MyScore[] = (scoreRows ?? [])
      .map((r) => ({ questionIdx: r.question_idx, survivalPct: r.survival_pct, playerId: r.player_id }))
      .filter((s) => s.playerId === seatId)
      .map(({ questionIdx, survivalPct }) => ({ questionIdx, survivalPct }))
      .sort((a, b) => a.questionIdx - b.questionIdx);

    let reveal: RevealRow[] | null = null;
    if (game.phase === 'running' && game.revealed) {
      const { data, error } = await this.client.rpc('survival_reveal_data', {
        p_game: gameId,
        p_idx: game.questionIdx,
      });
      if (error) fail('Could not load the outcomes.', error.message);
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
    let ruthless: Snapshot['ruthless'] = null;
    let seats: Seat[] | null = null;
    let keyReveal: Snapshot['keyReveal'] = null;
    if (game.phase === 'tribunal' || game.phase === 'result') {
      const { data, error } = await this.client.rpc('survival_standings', { p_game: gameId });
      if (error) fail('Could not load the standings.', error.message);
      standings = (data ?? []).map((r: { player_id: string; name: string; rounds: number; average: number }) => ({
        playerId: r.player_id, name: r.name, rounds: r.rounds, average: Number(r.average),
      }));
    }
    if (game.phase === 'result') {
      // Fetched only here, deliberately — NOT alongside standings at
      // tribunal. Opening who's disqualified while the vote is still live
      // would let the room strategically avoid them instead of discovering
      // the bump as a surprise once the seats are decided.
      const { data: ruthlessData, error: ruthlessError } =
        await this.client.rpc('survival_ruthless', { p_game: gameId });
      if (ruthlessError) fail('Could not weigh the room.', ruthlessError.message);
      ruthless = (ruthlessData ?? []).map(
        (r: { player_id: string; name: string; marks: number; disqualified: boolean }) => ({
          playerId: r.player_id, name: r.name, marks: r.marks, disqualified: r.disqualified,
        }),
      );

      const { data, error } = await this.client.rpc('survival_seats', { p_game: gameId });
      if (error) fail('Could not seat the helicopter.', error.message);
      seats = (data ?? []).map(
        (r: {
          player_id: string; name: string; seat: number; path: SeatPath;
          votes: number; average: number; solve_order: number | null; contested: boolean;
        }) => ({
          playerId: r.player_id, name: r.name, seat: r.seat, path: r.path,
          votes: r.votes, average: Number(r.average), solveOrder: r.solve_order, contested: r.contested,
        }),
      );

      const { data: keyData, error: keyError } = await this.client.rpc('survival_key_reveal', { p_game: gameId });
      if (keyError) fail('Could not open the manifest.', keyError.message);
      const keyRow = (Array.isArray(keyData) ? keyData[0] : keyData) as
        { code: string; recipe: string } | null;
      keyReveal = keyRow ? { code: keyRow.code, recipe: keyRow.recipe } : null;
    }

    const myTeamRow = (teamRows ?? []).find((r) => r.player_id === seatId) as
      { team_no: number } | undefined;
    const myTeam = myTeamRow
      ? (teamRows ?? [])
        .filter((r) => r.team_no === myTeamRow.team_no)
        .map((r) => r.player_id as string)
      : null;

    // Every team, not just mine — the host needs the full roster, and team
    // membership was never a secret (nothing here narrows what `teamRows`
    // already granted every member of the game).
    const teamNumbers = [...new Set((teamRows ?? []).map((r) => r.team_no as number))];
    const teams = teamNumbers.length > 0
      ? teamNumbers.map((teamNo) => ({
        id: `team-${teamNo}`,
        memberIds: (teamRows ?? [])
          .filter((r) => r.team_no === teamNo)
          .map((r) => r.player_id as string),
      }))
      : null;


    // The berth puzzles, assembled from five public tables plus the one that
    // is not. `myRule` comes out of survival_fragments, which RLS has
    // already narrowed to this player's own rows — the client is not
    // choosing to hide anybody else's, it never received them.
    type LineRow = {
      berth: number; line_id: number; line_berth: number;
      seal: number; signed_at: number; signer: string;
    };
    const byBerth = new Map<number, LineRow[]>();
    for (const row of (lineRows ?? []) as LineRow[]) {
      byBerth.set(row.berth, [...(byBerth.get(row.berth) ?? []), row]);
    }
    const puzzles: Snapshot['puzzles'] = [...byBerth.entries()]
      .sort(([a], [b]) => a - b)
      .map(([berth, rows]) => {
        const mine = (fragmentRows ?? []).find((f) => f.berth === berth);
        const first = (solveRows ?? []).find((r) => r.berth === berth);
        return {
          berth,
          lines: rows.map((r) => ({
            id: r.line_id, berth: r.line_berth, seal: r.seal,
            signedAt: r.signed_at, signer: r.signer,
          })),
          myRule: mine ? ruleText(mine.rule as Rule) : null,
          myRulePosted: (postRows ?? []).some((p) => p.berth === berth && p.player_id === seatId),
          posted: ((postedRows ?? []) as { berth: number; player_id: string; rule: Rule }[])
            .filter((p) => p.berth === berth)
            .map((p) => ({ playerId: p.player_id, text: ruleText(p.rule) })),
          askingPlayerIds: (askRows ?? []).filter((a) => a.berth === berth).map((a) => a.player_id as string),
          digit: ((digitRows ?? []) as { berth: number; digit: number }[])
            .find((d) => d.berth === berth)?.digit ?? null,
          firstSolvedBy: first
            ? (playerRows ?? []).find((p) => p.id === first.player_id)?.name ?? null
            : null,
        };
      });

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
      seats,
      // Derived from the roster rather than fetched: survival_seats already
      // agrees with seatsFor, and a second round trip for one integer that
      // both sides compute the same way is a round trip that can disagree.
      seatCount: seatsFor((playerRows ?? []).length),
      clue,
      clueSeer,
      escapedPlayerIds: progress?.escaped ?? [],
      retryInSeconds: progress?.retry_in_seconds ?? 0,
      teamAttempts: progress?.team_attempts ?? 0,
      ruthless,
      keyReveal,
      myTeam,
      teams,
      puzzles,
    };
  }

  private refreshers = new Set<() => void>();

  subscribe(gameId: string, onChange: (snapshot: Snapshot) => void,
    onError?: (message: string | null) => void) {
    let stopped = false;
    let waiting = false;
    let seatId: string | null = null;
    let resolved = false;
    let inFlight = false;
    let pending = false;
    let hadError = false;

    // Realtime, polling and local actions share one queue. An older response
    // must never overwrite a newer phase or a just-submitted choice.
    const push = async () => {
      if (stopped) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      try {
        do {
          pending = false;
          if (!resolved) {
            seatId = (await this.resume(gameId)).playerId;
            resolved = true;
          }
          if (stopped) return;
          const snap = await this.fetchSnapshot(gameId, seatId);
          if (!snap || stopped) return;
          waiting = (snap.game.phase === 'running' && !snap.game.revealed)
            || snap.game.phase === 'plea' || snap.game.phase === 'tribunal';
          onChange(snap);
          if (hadError) { onError?.(null); hadError = false; }
        } while (pending && !stopped);
      } catch (error) {
        if (!stopped) {
          hadError = true;
          onError?.(`${error instanceof Error ? error.message : String(error)} Retrying…`);
        }
      } finally {
        inFlight = false;
      }
    };
    this.refreshers.add(push);

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
      this.refreshers.delete(push);
      window.clearTimeout(timer);
      this.client.removeChannel(channel);
    };
  }

  private async call(fn: string, args: Record<string, unknown>, whenItFails: string) {
    const { error } = await this.client.rpc(fn, args);
    if (error) fail(whenItFails, error.message);
    for (const refresh of this.refreshers) refresh();
  }

  /** Same as `call`, but for the rare RPC whose return value the caller actually needs. */
  private async callFor<T>(fn: string, args: Record<string, unknown>, whenItFails: string): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) fail(whenItFails, error.message);
    for (const refresh of this.refreshers) refresh();
    return (Array.isArray(data) ? data[0] : data) as T;
  }

  reveal = (gameId: string) =>
    this.call('survival_reveal', { p_game: gameId }, 'Could not open the outcomes.');

  advance = (gameId: string) =>
    this.call('survival_advance', { p_game: gameId }, 'Could not move the game on.');

  setMode = (gameId: string, mode: 'solo' | 'consensus') =>
    this.call('survival_set_mode', { p_game: gameId, p_mode: mode }, 'Could not change how the room plays.');

  answer = (gameId: string, optionIndex: number) =>
    this.call('survival_answer', { p_game: gameId, p_option: optionIndex },
      'Your choice did not go through.');

  plea = (gameId: string, text: string) =>
    this.call('survival_plea', { p_game: gameId, p_text: text }, 'Your plea did not go through.');

  vote = (gameId: string, targetPlayerId: string) =>
    this.call('survival_vote', { p_game: gameId, p_target: targetPlayerId },
      'Your vote did not go through.');

  postFragment = (gameId: string, berth: number) =>
    this.call('survival_post_fragment', { p_game: gameId, p_berth: berth },
      'Your fragment did not reach the ledger.');

  askForBerth = (gameId: string, berth: number) =>
    this.call('survival_ask_berth', { p_game: gameId, p_berth: berth },
      'Could not put your request on the board.');

  solveBerth = async (gameId: string, berth: number, lineId: number) => {
    const correct = await this.callFor<boolean>(
      'survival_solve_berth', { p_game: gameId, p_berth: berth, p_line: lineId },
      'The terminal did not respond.',
    );
    return { correct: Boolean(correct) };
  };

  escape = async (gameId: string, code: string) => {
    const row = await this.callFor<{ correct: boolean; retry_in_seconds: number }>(
      'survival_escape', { p_game: gameId, p_attempt: code }, 'The keypad did not respond.',
    );
    return { accepted: row.correct, retryInSeconds: row.retry_in_seconds };
  };

  heartbeat(gameId: string) {
    void this.client.rpc('survival_heartbeat', { p_game: gameId });
  }
}
