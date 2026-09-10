import { useState } from 'react';
import { deckById } from '../game/decks';
import { deal } from '../game/deal';
import { heatCapFor, nextGamePhase, nextRoundPhase, roundFlow } from '../game/machine';
import { themeById } from '../game/themes';
import { lookFromSeed } from '../scene/character';
import type { Backend, GameSnapshot } from '../net';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, HowToPlay, Leaderboard, cardFor, nameOf } from './shared';

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

/**
 * What the host should be doing in each chapter, in the words they can read
 * straight off the screen. This is the run of show — the most useful prose in
 * the original design, and useless anywhere but here.
 */
const RUN_OF_SHOW: Record<string, { say: string; then: string }> = {
  lobby: {
    say: 'Share the join link and the room code. Let people build a character — it takes fifteen seconds and it is the first thing that makes them feel present.',
    then: 'Move on when everyone who is coming has a seat.',
  },
  briefing: {
    say: '"Three rules. Your screen tells you what to do. If it tells you nothing, you do nothing. And everyone gets one Pass that costs absolutely nothing — I would genuinely like to see them used."',
    then: 'Do not explain the scoring. It explains itself and nobody remembers it anyway.',
  },
  warmup: {
    say: 'Everyone answers at once, so nobody is singled out first. Read the card aloud, then stop talking and let people type.',
    then: 'Two cards here is plenty. Deal, close, reveal, vote, score.',
  },
  round1: {
    say: 'Heat 1 only: chat answers and camera-off cards. Read the card, name who is up, and let the timer do the pressure so you do not have to.',
    then: 'Aim for everyone having had one turn before the interval.',
  },
  intermission: {
    say: 'Say the standings out loud and take a real break. Cameras off is fine.',
    then: 'When you come back, raise the dial to 2.',
  },
  round2: {
    say: 'Heat 2: objects get fetched, people are still seated. The room is warm now — you can talk less.',
    then: 'Watch for anyone still on zero and steer a Whim their way.',
  },
  finale: {
    say: 'Duels between the two leaders. Build it up — this is the peak and it should feel like one.',
    then: 'Two duels, maximum. End while people still want more.',
  },
  awards: {
    say: 'Read the top three, then hand out something for everyone else: most votes received, best fooler, biggest swing.',
    then: 'Finish early. Nobody has ever complained about that.',
  },
};

export function Host({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const backend = campfire.backend;
  const [proxyName, setProxyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!snap || !backend) return <main className="host">Connecting…</main>;

  const theme = themeById(snap.game.themeId);
  const round = snap.round;
  const card = cardFor(snap.game.deckId, round?.cardId);
  const roundOver = !round || round.phase === 'scored';
  const guide = RUN_OF_SHOW[snap.game.phase];

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
      const outcome = deal({
        deck: deckById(snap.game.deckId),
        phase: snap.game.phase,
        heatCap: snap.game.heatCap,
        usedCardIds: snap.usedCardIds,
        playerIds: snap.players.map((p) => p.id),
        playedPlayerIds: snap.playedPlayerIds,
        standings: snap.players.map((p) => ({ playerId: p.id, score: p.score })),
      });

      if (!outcome.ok) {
        setProblem(
          outcome.reason === 'not-a-playing-phase'
            ? `No cards are dealt during ${PHASE_LABEL[snap.game.phase]}. Move to the next chapter first.`
            : outcome.reason === 'too-few-players'
              ? 'Not enough people at the fire for that.'
              : `Every card at heat ${snap.game.heatCap} and below has been played. Raise the dial or move on.`,
        );
        return;
      }

      await backend.startRound(snap.game.id, outcome.plan);
    });

  const nextStep = () =>
    run(async () => {
      if (!round) return;
      const next = nextRoundPhase(round.mechanic, round.phase);
      if (next === 'scored') return backend.scoreRound(round.id);
      await backend.advanceRound(
        round.id,
        next,
        next === 'performing' ? (card?.secs ?? null) : null,
      );
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
          {guide && (
            <div className="run-of-show">
              <span className="eyebrow">{PHASE_LABEL[snap.game.phase]} — what to do</span>
              <p className="ros-say">{guide.say}</p>
              <p className="ros-then muted small">{guide.then}</p>
            </div>
          )}

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
            <p className="muted host-empty">No card in play. Deal one when the room is ready.</p>
          )}

          {/* One obvious next action. The other two are secondary on purpose:
              a console with three equally-weighted buttons makes the host
              hesitate, and the room reads the hesitation. */}
          <div className="host-actions">
            {roundOver ? (
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={dealCard}>
                Deal a card
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={nextStep}>
                {nextStepLabel(round!.phase, round!.mechanic)}
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const phase = nextGamePhase(snap.game.phase);
                  await backend.setPhase(snap.game.id, phase, heatCapFor(phase));
                })
              }
            >
              {PHASE_LABEL[nextGamePhase(snap.game.phase)]} →
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

          <PlayPanel
            snapshot={snap}
            backend={backend}
            hostPlayerId={campfire.session?.playerId ?? null}
            onError={setProblem}
          />

          <AtmospherePanel snapshot={snap} backend={backend} />

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

          <div className="panel">
            <h3>Add someone without a device</h3>
            <p className="muted small">
              They play through your screen; you enter their answers and votes. They appear at the
              fire like anyone else.
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

          <div className="panel">
            <HowToPlay theme={theme} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function AtmospherePanel({ snapshot, backend }: { snapshot: GameSnapshot; backend: Backend }) {
  const cues = [
    { label: 'Hush', emoji: '🌫️', title: 'Send a foggy hush to the shared stage.' },
    { label: 'Drumroll', emoji: '🥁', title: 'Build tension before a reveal or score.' },
    { label: 'Cheer', emoji: '👏', title: 'Make the room applaud on the shared stage.' },
    { label: 'Reveal', emoji: '🕯️', title: 'Light the reveal candles.' },
  ];

  return (
    <div className="panel">
      <h3>Atmosphere</h3>
      <div className="atmosphere-grid">
        {cues.map((cue) => (
          <button
            key={cue.label}
            className="btn btn-sm atmosphere-btn"
            title={cue.title}
            onClick={() => backend.react(snapshot.game.id, cue.emoji)}
          >
            <span aria-hidden="true">{cue.emoji}</span>
            {cue.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function nextStepLabel(phase: string, mechanic: string): string {
  switch (phase) {
    case 'choosing':
      return 'Start their clock';
    case 'submitting':
      return 'Close answers & reveal';
    case 'revealing':
      return 'Open voting';
    case 'performing':
      return mechanic === 'duel' ? 'Both done — open voting' : 'Open voting';
    case 'voting':
      return 'Score it';
    default:
      return 'Next step';
  }
}

/**
 * Where the round is, and what it is waiting for.
 *
 * The counts come from `submittedPlayerIds` / `votedPlayerIds` rather than
 * from the answers themselves — the host is not allowed to read a sealed
 * answer, but has to know when everyone has finished writing one.
 */
function PhaseProgress({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;
  if (!round) return null;

  const flow = roundFlow(round.mechanic);
  const at = flow.indexOf(round.phase);
  const total = snapshot.players.length;

  const outstanding = (done: string[]) =>
    snapshot.players.filter((p) => !done.includes(p.id)).map((p) => p.name);

  let waiting: { count: string; who: string[] } | null = null;
  if (round.phase === 'submitting') {
    waiting = {
      count: `${snapshot.submittedPlayerIds.length} of ${total} answered`,
      who: outstanding(snapshot.submittedPlayerIds),
    };
  } else if (round.phase === 'voting') {
    // The performer does not vote on their own turn, so they are not missing.
    const excused = [round.turnPlayerId, round.opponentId].filter(Boolean) as string[];
    const eligible = snapshot.players.filter((p) => !excused.includes(p.id));
    waiting = {
      count: `${snapshot.votedPlayerIds.length} of ${eligible.length} voted`,
      who: eligible.filter((p) => !snapshot.votedPlayerIds.includes(p.id)).map((p) => p.name),
    };
  }

  return (
    <div className="phase-progress">
      <ol>
        {flow.map((p, i) => (
          <li key={p} className={i === at ? 'now' : i < at ? 'done' : undefined}>
            {p}
          </li>
        ))}
      </ol>
      {waiting && (
        <p className="muted small">
          {waiting.count}
          {waiting.who.length > 0 && waiting.who.length <= 4 && (
            <> · still waiting on {waiting.who.join(', ')}</>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The host is a player too, and so is anyone playing through the host's
 * screen. This panel is where all of them take their turn: without it the
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

  return (
    <div className="panel">
      <h3>{round.phase === 'submitting' ? 'Answers from this screen' : 'Votes from this screen'}</h3>

      {controlled.map((player) => {
        const done =
          round.phase === 'submitting'
            ? snapshot.submittedPlayerIds.includes(player.id)
            : snapshot.votedPlayerIds.includes(player.id);
        const isUp = round.turnPlayerId === player.id || round.opponentId === player.id;
        // Their own answers are visible to the host's session; everyone
        // else's are anonymous until scoring, which is what makes this
        // panel safe to have on the shared machine.
        const theirs = snapshot.submissions.filter((s) => s.playerId !== player.id);

        return (
          <div key={player.id} className="proxy-vote">
            <strong>
              {player.name}
              {player.id === hostPlayerId ? ' (you)' : ''}
              {done && <em className="tagline"> {round.phase === 'voting' ? 'voted' : 'sealed'}</em>}
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
            ) : isUp ? (
              <span className="muted small">Being scored — no vote.</span>
            ) : round.mechanic === 'solo' ? (
              <div className="score-row-btns">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className="btn btn-sm"
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
                      onClick={() => void cast(player.id, { targetPlayerId: id })}
                    >
                      {nameOf(snapshot.players, id)}
                    </button>
                  ))}
              </div>
            ) : theirs.length === 0 ? (
              <span className="muted small">Reveal the answers first.</span>
            ) : round.mechanic === 'guesswho' ? (
              <div className="score-row-btns">
                {theirs.map((s, i) => (
                  <label key={s.id} className="guess-row" title={s.text}>
                    <span className="reveal-num">#{i + 1}</span>
                    <select
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value &&
                        void cast(player.id, {
                          submissionId: s.id,
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
                ))}
              </div>
            ) : (
              <div className="score-row-btns">
                {theirs.map((s, i) => (
                  <button
                    key={s.id}
                    className="btn btn-sm"
                    title={s.text}
                    onClick={() => void cast(player.id, { submissionId: s.id })}
                  >
                    #{i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
