import { useState } from 'react';
import { deckById, draw } from '../game/decks';
import {
  heatCapFor,
  mechanicsFor,
  nextGamePhase,
  nextRoundPhase,
  nextTurnPlayer,
  roundFlow,
} from '../game/machine';
import { themeById } from '../game/themes';
import { lookFromSeed } from '../scene/character';
import type { Backend, GameSnapshot } from '../net';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, Leaderboard, cardFor, nameOf } from './shared';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  briefing: 'Briefing',
  warmup: 'Warm-up',
  round1: 'Round one',
  intermission: 'Interval',
  round2: 'Round two',
  finale: 'Finale',
  awards: 'Awards',
};

export function Host({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const backend = campfire.backend;
  const [proxyName, setProxyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!snap || !backend) return <main className="host">Connecting…</main>;

  const theme = themeById(snap.game.themeId);
  const deck = deckById(snap.game.deckId);
  const round = snap.round;
  const card = cardFor(snap.game.deckId, round?.cardId);
  const roundOver = !round || round.phase === 'scored';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const dealCard = () =>
    run(async () => {
      const mechanics = mechanicsFor(snap.game.phase);
      if (mechanics.length === 0) {
        setProblem(`No cards are dealt during ${PHASE_LABEL[snap.game.phase]}. Move on first.`);
        return;
      }

      // Prefer a mechanic that still has cards left at this heat.
      let picked = null;
      for (const mechanic of shuffle(mechanics)) {
        picked = draw(deck, {
          heatCap: snap.game.heatCap,
          usedIds: snap.usedCardIds,
          mechanic,
        });
        if (picked) break;
      }

      if (!picked) {
        setProblem(
          `Every card at heat ${snap.game.heatCap} and below has been played. Raise the heat or move to the next chapter.`,
        );
        return;
      }

      const solo = picked.mechanic === 'solo';
      const duel = picked.mechanic === 'duel';

      const turnPlayerId = solo || duel
        ? nextTurnPlayer(
            snap.players.map((p) => p.id),
            snap.playedPlayerIds,
          )
        : null;

      const opponentId = duel
        ? nextTurnPlayer(
            snap.players.map((p) => p.id),
            [...snap.playedPlayerIds, turnPlayerId ?? ''],
          )
        : null;

      await backend.startRound(snap.game.id, {
        cardId: picked.id,
        mechanic: picked.mechanic,
        lane: picked.lane,
        turnPlayerId,
        opponentId,
        phase: roundFlow(picked.mechanic)[0],
        secs: roundFlow(picked.mechanic)[0] === 'submitting' ? picked.secs : null,
      });
    });

  const nextStep = () =>
    run(async () => {
      if (!round) return;
      const next = nextRoundPhase(round.mechanic, round.phase);
      if (next === 'scored') {
        await backend.scoreRound(round.id);
        return;
      }
      const secs = next === 'performing' ? (card?.secs ?? null) : null;
      await backend.advanceRound(round.id, next, secs);
    });

  const nextChapter = () =>
    run(async () => {
      const phase = nextGamePhase(snap.game.phase);
      await backend.setPhase(snap.game.id, phase, heatCapFor(phase));
    });

  const shareUrl = `${window.location.origin}${window.location.pathname}?c=${snap.game.code}`;
  const stageUrl = `${shareUrl}&v=stage`;

  return (
    <main className="host">
      <header className="host-head">
        <div>
          <span className="eyebrow">Host console · {PHASE_LABEL[snap.game.phase]}</span>
          <h1>
            {snap.game.code}
            <button
              className="btn btn-sm copy"
              onClick={() => void navigator.clipboard?.writeText(shareUrl)}
            >
              Copy join link
            </button>
            <a className="btn btn-sm" href={stageUrl} target="_blank" rel="noreferrer">
              Open Stage ↗
            </a>
          </h1>
        </div>
        {round && <Countdown round={round} />}
      </header>

      {problem && <p className="form-error">{problem}</p>}
      {campfire.connection?.fellBackFrom && (
        <p className="fallback-note">
          Running on the local backend. {campfire.connection.fellBackFrom} Everything works;
          players just have to be in tabs on this machine.
        </p>
      )}

      <div className="host-grid">
        <section className="host-main">
          {card && round ? (
            <>
              <CardPanel
                card={card}
                theme={theme}
                subtitle={
                  round.turnPlayerId
                    ? `${nameOf(snap.players, round.turnPlayerId)}${round.opponentId ? ` vs ${nameOf(snap.players, round.opponentId)}` : ''}`
                    : undefined
                }
              />
              <PhaseProgress snapshot={snap} />
            </>
          ) : (
            <p className="muted host-empty">
              No card in play. Deal one when the room is ready.
            </p>
          )}

          <div className="host-actions">
            <button className="btn btn-primary" disabled={busy || !roundOver} onClick={dealCard}>
              Deal a card
            </button>
            <button className="btn" disabled={busy || roundOver} onClick={nextStep}>
              {round ? nextStepLabel(round.phase) : 'Next step'}
            </button>
            <button className="btn" disabled={busy} onClick={nextChapter}>
              Next chapter →
            </button>
          </div>

          <div className="heat-dial">
            <span className="eyebrow">Courage dial</span>
            <div className="seg" role="group" aria-label="Maximum heat">
              {([1, 2, 3] as const).map((h) => (
                <button
                  key={h}
                  aria-pressed={snap.game.heatCap === h}
                  onClick={() => void run(() => backend.setPhase(snap.game.id, snap.game.phase, h))}
                >
                  {h}
                </button>
              ))}
            </div>
            <p className="muted small">
              {snap.game.heatCap === 1 && 'Chat answers and camera-off cards. Nobody performs.'}
              {snap.game.heatCap === 2 && 'Objects get fetched. Still seated, still no acting.'}
              {snap.game.heatCap === 3 && 'Entrances and reenactments. Volunteers only.'}
            </p>
          </div>
        </section>

        <aside className="host-side">
          <div className="panel">
            <h3>Everyone ({snap.players.length})</h3>
            <Leaderboard players={snap.players} present={snap.present} />
          </div>

          <div className="panel">
            <h3>The Whim</h3>
            <p className="muted small">
              One arbitrary bonus point per round, for a reason that must be announced and must
              make no sense.
            </p>
            <div className="whim-grid">
              {snap.players.map((p) => (
                <button
                  key={p.id}
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => void run(() => backend.awardWhim(p.id, 1))}
                >
                  +1 {p.name}
                </button>
              ))}
            </div>
          </div>

          <PlayPanel
            snapshot={snap}
            backend={backend}
            hostPlayerId={campfire.session?.playerId ?? null}
            onError={setProblem}
          />

          <div className="panel">
            <h3>Add someone without a device</h3>
            <p className="muted small">
              They play through your screen; you enter their votes. They appear at the fire like
              anyone else.
            </p>
            <div className="proxy-add">
              <input
                value={proxyName}
                onChange={(e) => setProxyName(e.target.value.slice(0, 24))}
                placeholder="Their name"
              />
              <button
                className="btn btn-sm"
                disabled={!proxyName.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await backend.addProxy(snap.game.id, proxyName, lookFromSeed(proxyName));
                    setProxyName('');
                  })
                }
              >
                Add
              </button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function nextStepLabel(phase: string): string {
  switch (phase) {
    case 'choosing':
      return 'Start the timer';
    case 'submitting':
      return 'Close answers & reveal';
    case 'revealing':
      return 'Open voting';
    case 'performing':
      return 'Open voting';
    case 'voting':
      return 'Score it';
    default:
      return 'Next step';
  }
}

function PhaseProgress({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;
  if (!round) return null;

  const flow = roundFlow(round.mechanic);
  const at = flow.indexOf(round.phase);

  const waiting =
    round.phase === 'submitting'
      ? `${snapshot.submissions.length} of ${snapshot.players.length} answered`
      : round.phase === 'voting'
        ? `${new Set(snapshot.votes.map((v) => v.voterId)).size} of ${snapshot.players.length} voted`
        : null;

  return (
    <div className="phase-progress">
      <ol>
        {flow.map((p, i) => (
          <li key={p} className={i === at ? 'now' : i < at ? 'done' : undefined}>
            {p}
          </li>
        ))}
      </ol>
      {waiting && <p className="muted small">{waiting}</p>}
    </div>
  );
}

/**
 * The host is a player too, and so is anyone playing through the host's screen.
 * This panel is where all of them actually take their turn: without it the
 * console can deal a card that nobody sitting at it is able to answer.
 *
 * Passing an explicit playerId acts on that player's behalf, which the backend
 * only permits for the host.
 */
function PlayPanel({
  snapshot,
  backend,
  hostPlayerId,
  onError,
}: {
  snapshot: GameSnapshot;
  backend: Backend;
  hostPlayerId: string | null;
  onError: (message: string) => void;
}) {
  const round = snapshot.round;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!round || (round.phase !== 'submitting' && round.phase !== 'voting')) return null;

  // The host plays as themselves (no playerId argument) and for every proxy.
  const controlled = snapshot.players.filter((p) => p.isProxy || p.id === hostPlayerId);
  if (controlled.length === 0) return null;

  const onBehalfOf = (playerId: string) => (playerId === hostPlayerId ? undefined : playerId);

  const submit = async (playerId: string) => {
    const text = (drafts[playerId] ?? '').trim();
    if (!text) return;
    try {
      await backend.submitAnswer(round.id, text, onBehalfOf(playerId));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save that answer.');
    }
  };

  const cast = async (playerId: string, vote: Parameters<Backend['castVote']>[1]) => {
    try {
      await backend.castVote(round.id, vote, onBehalfOf(playerId));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not record that vote.');
    }
  };

  const voted = new Set(snapshot.votes.map((v) => v.voterId));
  const submitted = new Set(snapshot.submissions.map((s) => s.playerId));

  return (
    <div className="panel">
      <h3>{round.phase === 'submitting' ? 'Answers from this screen' : 'Votes from this screen'}</h3>

      {controlled.map((player) => (
        <div key={player.id} className="proxy-vote">
          <strong>
            {player.name}
            {player.id === hostPlayerId ? ' (you)' : ''}
            {round.phase === 'submitting' && submitted.has(player.id) && (
              <em className="tagline"> sealed</em>
            )}
            {round.phase === 'voting' && voted.has(player.id) && (
              <em className="tagline"> voted</em>
            )}
          </strong>

          {round.phase === 'submitting' ? (
            <div className="proxy-answer">
              <textarea
                rows={2}
                maxLength={600}
                value={drafts[player.id] ?? ''}
                placeholder="Type what they say out loud"
                onChange={(e) => setDrafts((d) => ({ ...d, [player.id]: e.target.value }))}
              />
              <button className="btn btn-sm" onClick={() => void submit(player.id)}>
                Seal
              </button>
            </div>
          ) : round.mechanic === 'solo' ? (
            <div className="score-row-btns">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className="btn btn-sm"
                  disabled={player.id === round.turnPlayerId}
                  onClick={() => void cast(player.id, { score: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : round.mechanic === 'duel' ? (
            <div className="score-row-btns">
              {[round.turnPlayerId, round.opponentId]
                .filter((id): id is string => Boolean(id))
                .map((id) => (
                  <button
                    key={id}
                    className="btn btn-sm"
                    disabled={id === player.id}
                    onClick={() => void cast(player.id, { targetPlayerId: id })}
                  >
                    {nameOf(snapshot.players, id)}
                  </button>
                ))}
            </div>
          ) : (
            <div className="score-row-btns">
              {snapshot.submissions.length === 0 && (
                <span className="muted small">Reveal the answers first.</span>
              )}

              {round.mechanic === 'guesswho'
                ? // Guess-who needs two facts per vote — which answer, and who
                  // they think wrote it — so a one-tap button cannot express it.
                  snapshot.submissions
                    .filter((s) => s.playerId !== player.id)
                    .map((s, i) => (
                      <label key={s.id} className="guess-row" title={s.text}>
                        <span className="reveal-num">#{i + 1}</span>
                        <select
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value &&
                            void cast(player.id, {
                              targetPlayerId: s.playerId,
                              guessPlayerId: e.target.value,
                            })
                          }
                        >
                          <option value="" disabled>
                            Guess…
                          </option>
                          {snapshot.players
                            .filter((p) => p.id !== player.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))
                : snapshot.submissions
                    .filter((s) => s.playerId !== player.id)
                    .map((s, i) => (
                      <button
                        key={s.id}
                        className="btn btn-sm"
                        title={s.text}
                        onClick={() => void cast(player.id, { targetPlayerId: s.playerId })}
                      >
                        #{i + 1}
                      </button>
                    ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
