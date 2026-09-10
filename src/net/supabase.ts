/**
 * Supabase backend. Every mutation is an RPC — the client never writes game
 * tables directly, which is what makes the scoreboard trustworthy.
 *
 * Reads are plain selects, filtered by the RLS policies in
 * supabase/migrations/20260901120000_init.sql. Submissions and votes come back empty
 * until the round phase opens them; that is the server's decision, not this
 * file's, and the local backend imitates it so tests stay honest.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureSession, isConfigured, supabase } from '../lib/supabase';
import { syncClock } from '../lib/clock';
import type {
  CharacterLook,
  Game,
  Heat,
  Player,
  Round,
  RoundPhase,
  Submission,
  Vote,
} from '../game/types';
import {
  BackendError,
  type Backend,
  type GameSnapshot,
  type Reaction,
  type StartRoundOptions,
  type VoteInput,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const rowToGame = (r: any): Game => ({
  id: r.id,
  code: r.code,
  hostUserId: r.host_user_id,
  deckId: r.deck_id,
  themeId: r.theme_id,
  phase: r.phase,
  roundNo: r.round_no,
  heatCap: r.heat_cap,
  createdAt: r.created_at,
});

const rowToPlayer = (r: any): Player => ({
  id: r.id,
  gameId: r.game_id,
  userId: r.user_id,
  name: r.name,
  look: r.look ?? {},
  isProxy: r.is_proxy,
  controlledBy: r.controlled_by,
  score: r.score,
  passSpent: r.pass_spent,
  lastSeen: r.last_seen,
});

const rowToRound = (r: any): Round => ({
  id: r.id,
  gameId: r.game_id,
  idx: r.idx,
  cardId: r.card_id,
  mechanic: r.mechanic,
  turnPlayerId: r.turn_player_id,
  opponentId: r.opponent_id,
  phase: r.phase,
  deadlineAt: r.deadline_at,
  results: r.results,
});

const rowToSubmission = (r: any): Submission => ({
  id: r.id,
  roundId: r.round_id,
  playerId: r.player_id,
  text: r.text,
  createdAt: r.created_at,
});

const rowToVote = (r: any): Vote => ({
  id: r.id,
  roundId: r.round_id,
  voterId: r.voter_id,
  submissionId: r.submission_id ?? null,
  targetPlayerId: r.target_player_id,
  score: r.score,
  guessPlayerId: r.guess_player_id,
});

function fail(context: string, error: { message: string } | null): never {
  throw new BackendError(`${context}: ${error?.message ?? 'unknown error'}`);
}

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;

  private client: SupabaseClient;
  private reactionHandlers = new Set<(r: Reaction) => void>();
  private myPlayerId: string | null = null;

  constructor() {
    if (!isConfigured || !supabase) {
      throw new BackendError('Supabase is not configured.', 'not_configured');
    }
    this.client = supabase;
  }

  async ready() {
    await ensureSession();
    // Probe the schema, so a missing migration fails here with a clear message
    // rather than as a confusing error on the first game.
    const { error } = await this.client.from('games').select('id').limit(1);
    if (error && /schema cache|does not exist/i.test(error.message)) {
      throw new BackendError(
        'The database schema has not been applied yet. Run supabase/migrations/20260901120000_init.sql in the SQL editor.',
        'not_configured',
      );
    }

    // 0003 is what keeps answers anonymous. Running without it looks fine
    // until the first all-play round quietly names every author, so fail
    // loudly here instead.
    const { error: anonMissing } = await this.client.rpc('round_progress', {
      p_round: '00000000-0000-0000-0000-000000000000',
    });
    if (anonMissing && /does not exist|schema cache/i.test(anonMissing.message)) {
      throw new BackendError(
        'Answers would not be anonymous: run supabase/migrations/20260910150000_anonymity.sql in the SQL editor.',
        'not_configured',
      );
    }
    await syncClock(this.client);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async createGame(deckId: string, themeId: string, hostName: string, look: CharacterLook) {
    const { data, error } = await this.client.rpc('create_game', {
      p_deck: deckId,
      p_theme: themeId,
    });
    if (error || !data) fail('Could not create the game', error);

    const game = rowToGame(Array.isArray(data) ? data[0] : data);
    const { playerId } = await this.joinGame(game.code, hostName, look);
    return { gameId: game.id, code: game.code, playerId };
  }

  async joinGame(code: string, name: string, look: CharacterLook) {
    const { data, error } = await this.client.rpc('join_game', {
      p_code: code.trim().toUpperCase(),
      p_name: name,
      p_look: look,
    });
    if (error || !data) fail('Could not join', error);

    const player = rowToPlayer(Array.isArray(data) ? data[0] : data);
    this.myPlayerId = player.id;
    return { gameId: player.gameId, playerId: player.id };
  }

  async resume(gameId: string) {
    const { data: session } = await this.client.auth.getSession();
    const uid = session.session?.user.id ?? null;
    if (!uid) return { playerId: null, isHost: false };

    const [{ data: player }, { data: game }] = await Promise.all([
      this.client.from('players').select('*').eq('game_id', gameId).eq('user_id', uid).maybeSingle(),
      this.client.from('games').select('host_user_id').eq('id', gameId).maybeSingle(),
    ]);

    this.myPlayerId = player ? player.id : null;
    return { playerId: this.myPlayerId, isHost: game?.host_user_id === uid };
  }

  async resolveCode(code: string) {
    // games_read is member-only, so this succeeds for the host opening the
    // Stage in a second tab (same auth session) and returns null for a stranger.
    const { data } = await this.client
      .from('games')
      .select('id')
      .eq('code', code.trim().toUpperCase())
      .is('ended_at', null)
      .maybeSingle();
    return data?.id ?? null;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  private async fetchSnapshot(gameId: string): Promise<GameSnapshot | null> {
    const [{ data: gameRow }, { data: playerRows }, { data: roundRows }] = await Promise.all([
      this.client.from('games').select('*').eq('id', gameId).maybeSingle(),
      this.client.from('players').select('*').eq('game_id', gameId).order('joined_at'),
      // Every round, newest first: the head is the live one, and the tail is
      // the history the host needs to avoid dealing a card twice.
      this.client.from('rounds').select('*').eq('game_id', gameId).order('idx', { ascending: false }),
    ]);

    if (!gameRow) return null;

    const allRounds = (roundRows ?? []).map(rowToRound);
    const round = allRounds.length > 0 ? allRounds[0] : null;

    // Answers come through an RPC rather than a select, because the rule is
    // about a *column*: the row is visible from the reveal, but its author is
    // not until the round is scored, and a row-level policy cannot express
    // that. Votes are a plain select — for those the whole row stays sealed.
    let submissions: Submission[] = [];
    let votes: Vote[] = [];
    let submittedPlayerIds: string[] = [];
    let votedPlayerIds: string[] = [];

    if (round) {
      const [{ data: subRows }, { data: voteRows }, { data: progress }] = await Promise.all([
        this.client.rpc('round_submissions', { p_round: round.id }),
        this.client.from('votes').select('*').eq('round_id', round.id),
        this.client.rpc('round_progress', { p_round: round.id }),
      ]);
      submissions = (subRows ?? []).map(rowToSubmission);
      votes = (voteRows ?? []).map(rowToVote);

      // Who has acted, so the host knows when the room is done. Never what
      // they said.
      const row = Array.isArray(progress) ? progress[0] : progress;
      submittedPlayerIds = row?.submitted ?? [];
      votedPlayerIds = row?.voted ?? [];
    }

    const players = (playerRows ?? []).map(rowToPlayer);
    const cutoff = Date.now() - 25_000;
    const present = players
      .filter((p) => p.isProxy || new Date(p.lastSeen).getTime() > cutoff)
      .map((p) => p.id);

    return {
      game: rowToGame(gameRow),
      players,
      round,
      submissions,
      votes,
      submittedPlayerIds,
      votedPlayerIds,
      present,
      usedCardIds: allRounds.map((r) => r.cardId),
      playedPlayerIds: allRounds
        .map((r) => r.turnPlayerId)
        .filter((id): id is string => Boolean(id)),
    };
  }

  subscribe(gameId: string, onChange: (snapshot: GameSnapshot) => void) {
    let stopped = false;

    let lastPhase: RoundPhase = 'scored';

    const push = async () => {
      if (stopped) return;
      const snap = await this.fetchSnapshot(gameId);
      if (!snap || stopped) return;
      lastPhase = snap.round?.phase ?? 'scored';
      onChange(snap);
    };

    // Postgres Changes carries the authoritative tables. Submissions and votes
    // are deliberately not published, so we re-read them whenever a round row
    // changes — which is exactly when a phase flip could have unsealed them.
    const channel = this.client
      .channel(`game:${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, push)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, push)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` }, push)
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        for (const h of this.reactionHandlers) h(payload as Reaction);
      })
      .subscribe();

    this.channels.set(gameId, channel);

    // Submissions and votes are deliberately absent from the realtime
    // publication — a sealed answer must never travel early — so the only way
    // to see them arrive is to ask.
    //
    // The rate is not constant. While the room is writing or voting, the host
    // is watching a counter to decide when to move on, and four seconds of lag
    // on "8 of 9" is four seconds of a host wondering whether someone is stuck.
    // Every other phase changes only when the host does something, and that
    // already arrives over realtime.
    let timer = 0;
    const WAITING_ON_PEOPLE: RoundPhase[] = ['submitting', 'voting'];
    let interval = 4000;

    const loop = async () => {
      await push();
      if (stopped) return;
      interval = WAITING_ON_PEOPLE.includes(lastPhase) ? 1200 : 4000;
      timer = window.setTimeout(loop, interval);
    };

    void loop();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      this.client.removeChannel(channel);
      this.channels.delete(gameId);
    };
  }

  private channels = new Map<string, ReturnType<SupabaseClient['channel']>>();

  // ── host actions ─────────────────────────────────────────────────────────

  async addProxy(gameId: string, name: string, look: CharacterLook) {
    const { error } = await this.client.rpc('add_proxy', {
      p_game: gameId,
      p_name: name,
      p_look: look,
    });
    if (error) fail('Could not add that player', error);
  }

  async removePlayer(_gameId: string, playerId: string) {
    const { error } = await this.client.from('players').delete().eq('id', playerId);
    if (error) fail('Could not remove that player', error);
  }

  async setPhase(gameId: string, phase: Game['phase'], heatCap?: Heat) {
    const { error } = await this.client.rpc('set_phase', {
      p_game: gameId,
      p_phase: phase,
      p_heat: heatCap ?? null,
    });
    if (error) fail('Could not change the phase', error);
  }

  async startRound(gameId: string, options: StartRoundOptions) {
    const { data, error } = await this.client.rpc('start_round', {
      p_game: gameId,
      p_card: options.cardId,
      p_mechanic: options.mechanic,
      p_lane: options.lane ?? null,
      p_turn: options.turnPlayerId ?? null,
      p_opponent: options.opponentId ?? null,
      p_phase: options.phase,
      p_secs: options.secs ?? null,
    });
    if (error || !data) fail('Could not start the round', error);
    return (Array.isArray(data) ? data[0] : data).id as string;
  }

  async advanceRound(roundId: string, phase: RoundPhase, secs?: number | null) {
    const { error } = await this.client.rpc('advance_round', {
      p_round: roundId,
      p_phase: phase,
      p_secs: secs ?? null,
    });
    if (error) fail('Could not advance the round', error);
  }

  async scoreRound(roundId: string) {
    const { error } = await this.client.rpc('score_round', { p_round: roundId });
    if (error) fail('Could not score the round', error);
  }

  async awardWhim(playerId: string, points: number) {
    const { error } = await this.client.rpc('award_whim', {
      p_player: playerId,
      p_points: points,
    });
    if (error) fail('Could not award that', error);
  }

  // ── player actions ───────────────────────────────────────────────────────

  async submitAnswer(roundId: string, text: string, playerId?: string) {
    const { error } = await this.client.rpc('submit_answer', {
      p_round: roundId,
      p_text: text,
      p_player: playerId ?? null,
    });
    if (error) fail('Could not save your answer', error);
  }

  async castVote(roundId: string, vote: VoteInput, playerId?: string) {
    const { error } = await this.client.rpc('cast_vote', {
      p_round: roundId,
      p_target: vote.targetPlayerId ?? null,
      p_score: vote.score ?? null,
      p_guess: vote.guessPlayerId ?? null,
      p_voter: playerId ?? null,
      p_submission: vote.submissionId ?? null,
    });
    if (error) fail('Could not record your vote', error);
  }

  async spendPass(gameId: string, playerId?: string) {
    const { error } = await this.client.rpc('spend_pass', {
      p_game: gameId,
      p_player: playerId ?? null,
    });
    if (error) fail('Could not spend the pass', error);
  }

  // ── ephemeral ────────────────────────────────────────────────────────────

  react(gameId: string, emoji: string) {
    const channel = this.channels.get(gameId);
    if (!channel || !this.myPlayerId) return;
    void channel.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { playerId: this.myPlayerId, emoji, at: Date.now() } satisfies Reaction,
    });
  }

  onReaction(handler: (r: Reaction) => void) {
    this.reactionHandlers.add(handler);
    return () => {
      this.reactionHandlers.delete(handler);
    };
  }

  heartbeat(gameId: string) {
    void this.client.rpc('heartbeat', { p_game: gameId });
  }
}
