import { useEffect, useState } from 'react';
import { themeById } from '../game/themes';
import { hasSomethingToDo, turnFor } from '../game/turn';
import { choicesFor, myBallot } from '../game/ballot';
import { CampfireScene } from '../scene/Campfire';
import { castFrom, fireScaleFor } from '../scene/cast';
import type { Campfire } from '../state/useCampfire';
import type { VoteInput } from '../net';
import { Countdown, HowToPlay, Leaderboard, Progress, ReactionBar, cardFor } from './shared';
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
  const ballot = myBallot(snap.votes, myId);
  const spotlight = turn.task.kind === 'perform' || turn.task.kind === 'brace';
  // How much room the controls need. A player with nothing to do gets the
  // fire, not a panel.
  const sheet = hasSomethingToDo(turn.task) ? 'full' : 'peek';

  return (
    // The fire is the screen, not a thumbnail on it. Everything else floats.
    <main className={`player ${spotlight ? 'player-lit' : ''}`} data-sheet={sheet}>
      <div className="player-world">
        <CampfireScene
          characters={castFrom(snap)}
          theme={theme}
          fireScale={fireScaleFor(snap.game.phase)}
          zoom={1.15}
          showNames={false}
          spotlightId={myId}
          className="player-canvas"
        />
      </div>

      <div className="player-hud">
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

      <Progress
        game={snap.game}
        players={snap.players}
        usedCardIds={snap.usedCardIds}
        meId={myId}
      />

      {/* The question sits in the sky above the ring — the gap the seating
          already keeps clear so nobody sits behind the flame. */}
      {card && round && (
        <div className="player-question">
          <h2>{card.title}</h2>
          <p>{card.prompt}</p>
        </div>
      )}

      {/* Deliberately empty: this is the window onto the fire. */}
      <div className="player-gap">
        <Countdown round={round} />
      </div>

      <section className="player-sheet" aria-live="polite">
        {problem && <p className="form-error">{problem}</p>}

        <div className="task">
          <h2 className="task-head">{turn.headline}</h2>
          {/* Repeated here because the sky copy is hidden once the sheet is
              open, and the one thing that must never be off screen is the
              question you are being asked. */}
          {card && round && <p className="task-prompt">{card.prompt}</p>}
          {turn.detail && <p className="task-detail">{turn.detail}</p>}
        </div>

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
                className={`score-btn ${ballot.score === n ? 'chosen' : ''}`}
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

        {turn.task.kind === 'side' && (
          // The whole mechanic: two targets, no keyboard, no turn order.
          <div className="side-pick">
            {turn.task.options.map((option, i) => (
              <button
                key={option}
                className={`side ${ballot.optionIndex === i ? 'chosen' : ''}`}
                onClick={() => vote({ optionIndex: i })}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {turn.task.kind === 'sideWithOne' && round && (
          <div className="pick-list">
            {[round.turnPlayerId, round.opponentId]
              .filter((id): id is string => Boolean(id))
              .map((id) => (
                <button
                  key={id}
                  className={`pick ${ballot.targetPlayerId === id ? 'chosen' : ''}`}
                  onClick={() => vote({ targetPlayerId: id })}
                >
                  {snap.players.find((p) => p.id === id)?.name ?? 'Someone'}
                </button>
              ))}
          </div>
        )}

        {turn.task.kind === 'pick' && (
          <div className="pick-list">
            {choicesFor(snap.submissions, myId).map((c) =>
              c.mine ? (
                // Shown, numbered, not votable. Dropping it would renumber
                // everything below it and stop matching the shared screen.
                <div key={c.submission.id} className="pick pick-answer pick-mine">
                  <span className="reveal-num">{c.number}</span>
                  <span className="pick-text">{c.submission.text}</span>
                  <span className="pick-flag">yours</span>
                </div>
              ) : (
                <button
                  key={c.submission.id}
                  className={`pick pick-answer ${ballot.submissionId === c.submission.id ? 'chosen' : ''}`}
                  onClick={() => vote({ submissionId: c.submission.id })}
                >
                  <span className="reveal-num">{c.number}</span>
                  <span className="pick-text">{c.submission.text}</span>
                </button>
              ),
            )}
            {snap.submissions.length === 0 && (
              <p className="muted">Nothing to vote on — nobody else answered.</p>
            )}
          </div>
        )}

        {turn.task.kind === 'guess' && (
          <ul className="guess-list">
            {choicesFor(snap.submissions, myId).filter((c) => !c.mine).map((c) => (
              <li key={c.submission.id}>
                <span className="reveal-num">{c.number}</span>
                <span className="pick-text">{c.submission.text}</span>
                <select
                  value={ballot.guesses[c.submission.id] ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    vote({ submissionId: c.submission.id, guessPlayerId: e.target.value })
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
      </div>
    </main>
  );
}

