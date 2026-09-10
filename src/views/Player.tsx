import { useEffect, useState } from 'react';
import { themeById } from '../game/themes';
import { CampfireScene } from '../scene/Campfire';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, Leaderboard, ReactionBar, cardFor, nameOf } from './shared';

/**
 * The player's own device. Phone-first: one job on screen at a time, big
 * targets, and never anything the Stage has not revealed yet.
 */
export function Player({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const backend = campfire.backend;
  const myId = campfire.session?.playerId ?? null;

  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const round = snap?.round ?? null;

  // A new round means a new answer box.
  useEffect(() => {
    setDraft('');
    setSent(false);
    setProblem(null);
  }, [round?.id]);

  if (!snap || !backend || !myId) return <main className="player">Connecting…</main>;

  const theme = themeById(snap.game.themeId);
  const me = snap.players.find((p) => p.id === myId);
  const card = cardFor(snap.game.deckId, round?.cardId);
  const isUp = round?.turnPlayerId === myId || round?.opponentId === myId;
  const myVotes = snap.votes.filter((v) => v.voterId === myId);

  const act = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <main className="player">
      <header className="player-head">
        <div>
          <span className="eyebrow">{snap.game.code}</span>
          <strong>{me?.name ?? 'You'}</strong>
        </div>
        <div className="player-score">
          {me?.score ?? 0}
          <span>{theme.vocab.points}</span>
        </div>
      </header>

      {problem && <p className="form-error">{problem}</p>}

      <section className="player-body" aria-live="polite">
        {snap.game.phase === 'lobby' && (
          <div className="player-wait">
            <CampfireScene
              characters={[{ id: myId, name: me?.name ?? 'You', look: me?.look ?? { body: 0, topper: 0, top: 0, accessory: 0 }, state: 'idle' }]}
              theme={theme}
              showNames={false}
              className="player-canvas"
            />
            <h2>You&rsquo;re in</h2>
            <p className="muted">
              {snap.players.length} around the fire. The host starts when everyone has arrived.
            </p>
          </div>
        )}

        {snap.game.phase !== 'lobby' && !round && (
          <p className="muted player-wait">Waiting for the next card…</p>
        )}

        {round && card && (
          <>
            {isUp && round.phase !== 'scored' && (
              <p className="youre-up">You&rsquo;re up.</p>
            )}

            <CardPanel
              card={card}
              theme={theme}
              subtitle={
                round.turnPlayerId && !isUp ? nameOf(snap.players, round.turnPlayerId) : undefined
              }
            />

            <Countdown round={round} big />

            {round.phase === 'submitting' && (
              <div className="answer">
                <label className="field">
                  <span>{card.submitHint ?? 'Your answer'}</span>
                  <textarea
                    rows={4}
                    value={draft}
                    maxLength={600}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Nobody sees this until the reveal."
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!draft.trim()}
                  onClick={() =>
                    void act(async () => {
                      await backend.submitAnswer(round.id, draft.trim());
                      setSent(true);
                    })
                  }
                >
                  {sent ? 'Update my answer' : 'Seal it'}
                </button>
                {sent && <p className="muted small">Sealed. You can still change it until time.</p>}
              </div>
            )}

            {round.phase === 'revealing' && (
              <p className="muted">Answers are going up on the shared screen.</p>
            )}

            {round.phase === 'voting' && (
              <Voting
                snapshot={snap}
                myId={myId}
                onVote={(vote) => void act(() => backend.castVote(round.id, vote))}
                voted={myVotes.length > 0}
              />
            )}

            {round.phase === 'scored' && (
              <div className="my-result">
                <h2>
                  {round.results?.points[myId]
                    ? `+${round.results.points[myId]} to you`
                    : 'No points that round'}
                </h2>
                {round.results?.notes?.[myId] && (
                  <p className="muted">{round.results.notes[myId]}</p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <footer className="player-foot">
        <ReactionBar onReact={(emoji) => backend.react(snap.game.id, emoji)} />
        <div className="player-tools">
          {me && !me.passSpent && round && round.phase !== 'scored' && (
            <button
              className="btn btn-sm"
              onClick={() => void act(() => backend.spendPass(snap.game.id))}
            >
              Use my {theme.vocab.pass}
            </button>
          )}
          {me?.passSpent && <span className="muted small">{theme.vocab.pass} spent</span>}
        </div>
        <details className="player-scores">
          <summary>Standing</summary>
          <Leaderboard players={snap.players} present={snap.present} />
        </details>
      </footer>
    </main>
  );
}

function Voting({
  snapshot,
  myId,
  onVote,
  voted,
}: {
  snapshot: import('../net').GameSnapshot;
  myId: string;
  onVote: (vote: { targetPlayerId?: string; score?: number; guessPlayerId?: string }) => void;
  voted: boolean;
}) {
  const round = snapshot.round;
  if (!round) return null;

  if (round.mechanic === 'solo') {
    if (round.turnPlayerId === myId) {
      return <p className="muted">You can&rsquo;t score your own turn. Sit tight.</p>;
    }
    return (
      <div className="vote-block">
        <p className="vote-ask">How did that go?</p>
        <div className="score-buttons">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="btn score-btn" onClick={() => onVote({ score: n })}>
              {n}
            </button>
          ))}
        </div>
        <p className="muted small">
          1 is barely tried, 5 is fully committed. Commitment beats quality — that&rsquo;s the
          whole scoring philosophy.
        </p>
        {voted && <p className="muted small">Vote recorded. Change it any time before scoring.</p>}
      </div>
    );
  }

  if (round.mechanic === 'duel') {
    const options = [round.turnPlayerId, round.opponentId].filter(Boolean) as string[];
    return (
      <div className="vote-block">
        <p className="vote-ask">Who took it?</p>
        <div className="vote-options">
          {options.map((id) => (
            <button
              key={id}
              className="btn vote-option"
              disabled={id === myId}
              onClick={() => onVote({ targetPlayerId: id })}
            >
              {nameOf(snapshot.players, id)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // all-play and guess-who both vote on the revealed answers.
  const mine = snapshot.submissions.find((s) => s.playerId === myId);
  const options = snapshot.submissions.filter((s) => s.id !== mine?.id);

  if (options.length === 0) {
    return <p className="muted">Nothing to vote on yet.</p>;
  }

  return (
    <div className="vote-block">
      <p className="vote-ask">
        {round.mechanic === 'guesswho' ? 'Whose is this?' : 'Which one got you?'}
      </p>
      <ul className="vote-options vote-list">
        {options.map((s, i) => (
          <li key={s.id}>
            <span className="reveal-num">{i + 1}</span>
            <span className="vote-text">{s.text}</span>
            {round.mechanic === 'guesswho' ? (
              <select
                defaultValue=""
                onChange={(e) =>
                  e.target.value &&
                  onVote({ targetPlayerId: s.playerId, guessPlayerId: e.target.value })
                }
              >
                <option value="" disabled>
                  Guess…
                </option>
                {snapshot.players
                  .filter((p) => p.id !== myId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            ) : (
              <button className="btn btn-sm" onClick={() => onVote({ targetPlayerId: s.playerId })}>
                This one
              </button>
            )}
          </li>
        ))}
      </ul>
      {voted && <p className="muted small">Vote recorded.</p>}
    </div>
  );
}
