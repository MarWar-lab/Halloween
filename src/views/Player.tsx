import { useEffect, useState } from 'react';
import { themeById } from '../game/themes';
import { turnFor } from '../game/turn';
import type { Submission } from '../game/types';
import { CampfireScene } from '../scene/Campfire';
import type { Campfire } from '../state/useCampfire';
import type { GameSnapshot, VoteInput } from '../net';
import { CardPanel, Countdown, HowToPlay, Leaderboard, ReactionBar, cardFor } from './shared';
import { Glyph } from '../ui/Glyph';

/**
 * The player's own device. Phone-first, and built on one rule: the screen
 * shows the single thing you are being asked for, and nothing else.
 *
 * What is on screen is decided by `turnFor`, not by conditionals scattered
 * through this file — see src/game/turn.ts for why.
 */
export function Player({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const backend = campfire.backend;
  const myId = campfire.session?.playerId ?? null;

  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const round = snap?.round ?? null;

  // A new round means a new answer box.
  useEffect(() => {
    setDraft('');
    setProblem(null);
  }, [round?.id]);

  if (!snap || !backend || !myId) return <main className="player">Connecting…</main>;

  const theme = themeById(snap.game.themeId);
  const me = snap.players.find((p) => p.id === myId);
  const card = cardFor(snap.game.deckId, round?.cardId);

  const turn = turnFor({
    round,
    card,
    me,
    submissions: snap.submissions,
    submittedPlayerIds: snap.submittedPlayerIds,
    votedPlayerIds: snap.votedPlayerIds,
    players: snap.players,
    theme,
    inLobby: snap.game.phase === 'lobby',
  });

  const act = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  const vote = (v: VoteInput) => void act(() => backend.castVote(round!.id, v));
  const spotlight = turn.task.kind === 'perform' || turn.task.kind === 'brace';

  return (
    <main className={`player ${spotlight ? 'player-lit' : ''}`}>
      <header className="player-head">
        <div className="player-who">
          <span className="eyebrow">{snap.game.code}</span>
          <strong>{me?.name ?? 'You'}</strong>
        </div>
        <div className="player-score">
          {me?.score ?? 0}
          <span>{theme.vocab.points}</span>
        </div>
      </header>

      {problem && <p className="form-error">{problem}</p>}

      {/* The instruction is the loudest thing on the screen, above the card.
          On a phone, held under a desk, mid-call, it is often the only thing
          that gets read. */}
      <section className="player-body" aria-live="polite">
        <div className="task">
          <h2 className="task-head">{turn.headline}</h2>
          {turn.detail && <p className="task-detail">{turn.detail}</p>}
          <Countdown round={round} big />
        </div>

        {snap.game.phase === 'lobby' && me && (
          <CampfireScene
            characters={[{ id: myId, name: me.name, look: me.look, state: 'idle' }]}
            theme={theme}
            zoom={1.8}
            showFire={false}
            showNames={false}
            className="player-canvas"
          />
        )}

        {card && round && <CardPanel card={card} theme={theme} />}

        {turn.task.kind === 'write' && (
          <div className="answer">
            <label className="field">
              <span>{turn.task.hint}</span>
              <textarea
                rows={4}
                value={draft}
                maxLength={600}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Nobody sees this until the reveal."
                autoFocus
              />
            </label>
            <button
              className="btn btn-primary btn-block"
              disabled={!draft.trim()}
              onClick={() => void act(() => backend.submitAnswer(round!.id, draft.trim()))}
            >
              {snap.submittedPlayerIds.includes(myId) ? 'Update my answer' : 'Seal it'}
            </button>
          </div>
        )}

        {turn.task.kind === 'rate' && (
          <div className="rate">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`score-btn ${myScore(snap, myId) === n ? 'chosen' : ''}`}
                onClick={() => vote({ score: n })}
              >
                {n}
              </button>
            ))}
            <span className="rate-legend">
              <span>barely tried</span>
              <span>fully committed</span>
            </span>
          </div>
        )}

        {turn.task.kind === 'sideWithOne' && round && (
          <div className="pick-list">
            {[round.turnPlayerId, round.opponentId]
              .filter((id): id is string => Boolean(id))
              .map((id) => (
                <button
                  key={id}
                  className={`pick ${votedFor(snap, myId) === id ? 'chosen' : ''}`}
                  onClick={() => vote({ targetPlayerId: id })}
                >
                  {snap.players.find((p) => p.id === id)?.name ?? 'Someone'}
                </button>
              ))}
          </div>
        )}

        {turn.task.kind === 'pick' && (
          <div className="pick-list">
            {theirs(snap, myId).map((s, i) => (
              <button
                key={s.id}
                className={`pick pick-answer ${votedForSubmission(snap, myId) === s.id ? 'chosen' : ''}`}
                onClick={() => vote({ submissionId: s.id })}
              >
                <span className="reveal-num">{i + 1}</span>
                <span className="pick-text">{s.text}</span>
              </button>
            ))}
            {theirs(snap, myId).length === 0 && (
              <p className="muted">Nothing to vote on — nobody else answered.</p>
            )}
          </div>
        )}

        {turn.task.kind === 'guess' && (
          <ul className="guess-list">
            {theirs(snap, myId).map((s, i) => (
              <li key={s.id}>
                <span className="reveal-num">{i + 1}</span>
                <span className="pick-text">{s.text}</span>
                <select
                  value={guessFor(snap, myId, s.id) ?? ''}
                  onChange={(e) =>
                    e.target.value && vote({ submissionId: s.id, guessPlayerId: e.target.value })
                  }
                >
                  <option value="" disabled>
                    Who wrote it?
                  </option>
                  {snap.players
                    .filter((p) => p.id !== myId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
        )}

        {turn.task.kind === 'result' && round && (
          <div className="my-result">
            <h2>
              {round.results?.points[myId]
                ? `+${round.results.points[myId]} to you`
                : 'No points that round'}
            </h2>
            {round.results?.notes?.[myId] && <p className="muted">{round.results.notes[myId]}</p>}
          </div>
        )}

        {/* Nothing to press means nothing is shown. The reaction bar below is
            always there, so a spectating player is never fully mute. This
            hint is for the audience only — telling the person who is *up* to
            watch the shared screen is the last thing they need. */}
        {turn.task.kind === 'idle' && <p className="idle-hint muted">Watch the shared screen.</p>}
      </section>

      <footer className="player-foot">
        <ReactionBar onReact={(emoji) => backend.react(snap.game.id, emoji)} />

        {turn.canPass && (
          <button
            className="btn btn-pass"
            onClick={() => void act(() => backend.spendPass(snap.game.id))}
          >
            <span className="btn-pass-line">
              <Glyph name="cape" size={16} />
              Use my {theme.vocab.pass}
            </span>
            <span>Ends this card. Costs you nothing.</span>
          </button>
        )}

        <div className="player-drawers">
          <details className="player-scores">
            <summary>Standing</summary>
            <Leaderboard players={snap.players} present={snap.present} />
          </details>
          <HowToPlay theme={theme} />
        </div>
      </footer>
    </main>
  );
}

/** Everyone else's answers, in a stable order, never including your own. */
const theirs = (snap: GameSnapshot, myId: string): Submission[] =>
  snap.submissions.filter((s) => s.playerId !== myId);

const myVotes = (snap: GameSnapshot, myId: string) =>
  snap.votes.filter((v) => v.voterId === myId);

const myScore = (snap: GameSnapshot, myId: string) => myVotes(snap, myId)[0]?.score ?? null;

const votedFor = (snap: GameSnapshot, myId: string) =>
  myVotes(snap, myId)[0]?.targetPlayerId ?? null;

const votedForSubmission = (snap: GameSnapshot, myId: string) =>
  myVotes(snap, myId)[0]?.submissionId ?? null;

const guessFor = (snap: GameSnapshot, myId: string, submissionId: string) =>
  myVotes(snap, myId).find((v) => v.submissionId === submissionId)?.guessPlayerId ?? null;
