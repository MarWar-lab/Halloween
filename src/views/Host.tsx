import { useEffect, useRef, useState } from 'react';
import { deckById } from '../game/decks';
import { deal } from '../game/deal';
import { heatCapFor, isPlayingPhase, nextGamePhase, nextRoundPhase, roundFlow } from '../game/machine';
import { themeById } from '../game/themes';
import { lookFromSeed } from '../scene/character';
import { CampfireScene } from '../scene/Campfire';
import { castFrom, fireScaleFor } from '../scene/cast';
import type { Backend, GameSnapshot } from '../net';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, HowToPlay, Leaderboard, Progress, cardFor, nameOf } from './shared';
import { choicesFor, eligibleVoters, myBallot } from '../game/ballot';

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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // ── the game moves itself on ─────────────────────────────────────────────
  // The slowest thing in a round was never a player. It was the gap between
  // the last person tapping and the host noticing they had. Once the room is
  // done, the round advances on its own after a beat long enough to see the
  // last answer land. The host can still press the button early; this only
  // removes the waiting.
  //
  // It sits above the early return because every hook has to run on every
  // render. Below it, the console rendered fewer hooks while the snapshot was
  // loading than once it arrived, and React tore the whole view down to a
  // white screen — which is exactly what shipped.
  const auto = useRef<string | null>(null);
  const liveRound = snap?.round ?? null;
  useEffect(() => {
    if (!snap || !backend || !liveRound || liveRound.results) return;

    const done =
      liveRound.phase === 'submitting'
        ? snap.players.every((p) => snap.submittedPlayerIds.includes(p.id))
        : liveRound.phase === 'voting'
          ? eligibleVoters(liveRound, snap.players).every((p) =>
              snap.votedPlayerIds.includes(p.id),
            )
          : false;
    if (!done) return;

    const key = `${liveRound.id}:${liveRound.phase}`;
    if (auto.current === key) return;
    auto.current = key;

    const t = window.setTimeout(() => {
      const next = nextRoundPhase(liveRound.mechanic, liveRound.phase);
      void (next === 'scored'
        ? backend.scoreRound(liveRound.id)
        : backend.advanceRound(liveRound.id, next, null));
    }, 1400);
    return () => window.clearTimeout(t);
  }, [
    snap,
    backend,
    liveRound,
    snap?.submittedPlayerIds.length,
    snap?.votedPlayerIds.length,
  ]); // eslint-disable-line react-hooks/exhaustive-deps


  if (!snap || !backend) return <main className="host">Connecting…</main>;

  const theme = themeById(snap.game.themeId);
  const round = snap.round;
  const card = cardFor(snap.game.deckId, round?.cardId);
  const roundOver = !round || round.phase === 'scored';
  const guide = RUN_OF_SHOW[snap.game.phase];
  const dealsCards = isPlayingPhase(snap.game.phase);
  // Awards is the end of the evening. There is nothing after it, so the
  // console must not offer a chapter that does not exist.
  const lastChapter = nextGamePhase(snap.game.phase) === snap.game.phase;

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
            ? lastChapter
              ? 'The game is over — this is the awards screen. Start a new one to play again.'
              : `No cards are dealt during ${PHASE_LABEL[snap.game.phase]}. Move on to ${PHASE_LABEL[nextGamePhase(snap.game.phase)]} first.`
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

  const advanceChapter = async () => {
    const phase = nextGamePhase(snap.game.phase);
    if (phase === snap.game.phase) return;
    await backend.setPhase(snap.game.id, phase, heatCapFor(phase));
  };

  const shareUrl = `${window.location.origin}${window.location.pathname}?c=${snap.game.code}`;
  const stageUrl = `${shareUrl}&v=stage`;

  return (
    // The fire first. This screen used to open on four panels of grey admin
    // with the game itself behind a text link, and the first thing a host saw
    // of their own Halloween party was a form. Everything that is not the
    // scene, the card, or the single next action now lives behind one button.
    // `data-busy` shrinks the scene while the host has a job to do, so the
    // card and the button they need both fit above the fold.
    <main className="host" data-busy={!roundOver}>
      <Progress
        game={snap.game}
        players={snap.players}
        usedCardIds={snap.usedCardIds}
        meId={campfire.session?.playerId ?? null}
      />

      <div className="host-stage">
        <CampfireScene
          characters={castFrom(snap)}
          theme={theme}
          fireScale={fireScaleFor(snap.game.phase)}
          className="host-canvas"
        />
        <div className="host-code">
          <strong>{snap.game.code}</strong>
          <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(shareUrl)}>
            Copy join link
          </button>
          <a className="btn btn-sm" href={stageUrl} target="_blank" rel="noreferrer">
            Full screen ↗
          </a>
        </div>
        {snap.players.length === 1 && (
          // A browser is one person. Trying the game out in a second tab makes
          // the server recognise you, not meet you, and it is far from obvious
          // that this is working correctly rather than failing.
          <p className="host-hint">
            Nobody else yet. Send the join link — and to try it yourself, open
            it in a <strong>private window</strong>: a browser can only be one
            player.
          </p>
        )}
        {round && (
          <div className="host-clock">
            <Countdown round={round} />
          </div>
        )}
      </div>

      {problem && <p className="form-error">{problem}</p>}
      {campfire.connection?.fellBackFrom && (
        <p className="fallback-note">
          Running on the local backend. {campfire.connection.fellBackFrom} Everything works;
          players just have to be in tabs on this machine.
        </p>
      )}

      <div className="host-play">
        {card && round ? (
          <>
            <CardPanel
              card={card}
              theme={theme}
              big
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
            {dealsCards
              ? 'No card in play. Deal one when the room is ready.'
              : (RUN_OF_SHOW[snap.game.phase]?.say ?? '')}
          </p>
        )}

        {/* Answering and voting happen right under the card, not in a column
            off to the side — the host was looking from one edge of the screen
            to the other to do one thing. */}
        <PlayPanel
          snapshot={snap}
          backend={backend}
          hostPlayerId={campfire.session?.playerId ?? null}
          onError={setProblem}
        />

        <div className="host-next">
          <p className="host-next-say">
            {roundOver && !dealsCards && !lastChapter
              ? `That is ${PHASE_LABEL[snap.game.phase]} done. Move on when the room is ready.`
              : roundOver && lastChapter
                ? 'That is the night. Put the awards on the shared screen.'
                : roundOver
                  ? 'Deal the next card when the room is ready.'
                  : whatNow(round!.phase, round!.mechanic, outstanding(snap))}
          </p>

          {!roundOver ? (
            <button className="btn btn-primary btn-hero" disabled={busy} onClick={nextStep}>
              {nextStepLabel(round!.phase, round!.mechanic)}
            </button>
          ) : dealsCards ? (
            <button className="btn btn-primary btn-hero" disabled={busy} onClick={dealCard}>
              Deal a card
            </button>
          ) : lastChapter ? (
            <a className="btn btn-primary btn-hero" href={stageUrl} target="_blank" rel="noreferrer">
              Show the awards
            </a>
          ) : (
            <button
              className="btn btn-primary btn-hero"
              disabled={busy}
              onClick={() => void run(advanceChapter)}
            >
              Start {PHASE_LABEL[nextGamePhase(snap.game.phase)].toLowerCase()}
            </button>
          )}

          {/* Deliberately small and quiet: neither is the thing to press. */}
          <div className="host-minor">
            {!lastChapter && (dealsCards || !roundOver) && (
              <button className="linkish" disabled={busy} onClick={() => void run(advanceChapter)}>
                Skip to {PHASE_LABEL[nextGamePhase(snap.game.phase)].toLowerCase()}
              </button>
            )}
            <button className="linkish" onClick={() => setToolsOpen((v) => !v)}>
              {toolsOpen ? 'Hide tools' : 'Tools'}
            </button>
          </div>
        </div>

        <div className="host-standing">
          <Leaderboard players={snap.players} present={snap.present} />
        </div>
      </div>

      {toolsOpen && (
        <div className="host-tools">
          {guide && (
            <div className="panel">
              <h3>{PHASE_LABEL[snap.game.phase]} — what to do</h3>
              <p className="ros-say">{guide.say}</p>
              <p className="muted small">{guide.then}</p>
            </div>
          )}

          <div className="panel">
            <h3>Courage dial</h3>
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

          <div className="panel">
            <h3>The Whim</h3>
            <p className="muted small">One bonus point, for a reason that must make no sense.</p>
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
            <h3>Playing without a device</h3>
            <p className="muted small">
              They play through your screen and appear at the fire like anyone else.
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

          <AtmospherePanel snapshot={snap} backend={backend} />

          <div className="panel">
            <HowToPlay theme={theme} />
          </div>
        </div>
      )}
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
/**
 * What the big button is about to do, in a sentence.
 *
 * The console had three buttons of similar weight and no statement of what
 * came next, so the honest reaction to it was "I don't know which of these to
 * press". One sentence removes the question.
 */
function outstanding(snap: GameSnapshot): number {
  const round = snap.round;
  if (!round) return 0;
  if (round.phase === 'submitting') return snap.players.length - snap.submittedPlayerIds.length;
  if (round.phase === 'voting') {
    const excused = [round.turnPlayerId, round.opponentId].filter(Boolean).length;
    return Math.max(0, snap.players.length - excused - snap.votedPlayerIds.length);
  }
  return 0;
}

function whatNow(phase: string, mechanic: string, waiting: number): string {
  switch (phase) {
    case 'choosing':
      return 'Read the card aloud, then start their clock.';
    case 'submitting':
      return waiting > 0
        ? `Waiting on ${waiting} ${waiting === 1 ? 'person' : 'people'}. Close when you are ready.`
        : 'Everyone has answered. Close and read them out.';
    case 'revealing':
      return 'Read the answers aloud, then open the vote.';
    case 'performing':
      return mechanic === 'duel' ? 'Both go, then open the vote.' : 'Let them go, then open the vote.';
    case 'voting':
      return waiting > 0
        ? `Waiting on ${waiting} ${waiting === 1 ? 'vote' : 'votes'}.`
        : 'Everyone has voted. Score it.';
    default:
      return 'Deal the next card when the room is ready.';
  }
}

/** The internal phase names are not English. These are. */
const STEP_LABEL: Record<string, string> = {
  choosing: 'Reading the card',
  performing: 'Their turn',
  submitting: 'Writing',
  revealing: 'Reading out',
  voting: 'Voting',
  scored: 'Scored',
};

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
            {STEP_LABEL[p] ?? p}
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
  const playCard = cardFor(snapshot.game.deckId, round?.cardId);
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
      <h3>{round.phase === 'submitting' ? 'Your answer' : 'Your vote'}</h3>

      {controlled.map((player) => {
        const done =
          round.phase === 'submitting'
            ? snapshot.submittedPlayerIds.includes(player.id)
            : snapshot.votedPlayerIds.includes(player.id);
        const isUp = round.turnPlayerId === player.id || round.opponentId === player.id;
        // The host's session can see the answers it typed for its own proxies,
        // and nobody else's — that masking is what makes this panel safe to
        // have open on the shared machine. `mine` marks the ones this player
        // must not vote for; they stay listed so the numbers still match the
        // shared screen.
        const choices = choicesFor(snapshot.submissions, player.id);
        const ballot = myBallot(snapshot.votes, player.id);

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
            ) : round.mechanic === 'poll' ? (
              <div className="pick-list name-list">
                {snapshot.players.map((target) => (
                  <button
                    key={target.id}
                    className={`pick ${ballot.targetPlayerId === target.id ? 'chosen' : ''}`}
                    onClick={() => void cast(player.id, { targetPlayerId: target.id })}
                  >
                    <span className="pick-text">{target.name}</span>
                  </button>
                ))}
              </div>
            ) : round.mechanic === 'split' ? (
              <div className="side-pick side-pick-sm">
                {(playCard?.options ?? []).map((option: string, i: number) => (
                  <button
                    key={option}
                    className={`side ${ballot.optionIndex === i ? 'chosen' : ''}`}
                    onClick={() => void cast(player.id, { optionIndex: i })}
                  >
                    {option}
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
            ) : choices.length === 0 ? (
              <span className="muted small">Reveal the answers first.</span>
            ) : round.mechanic === 'guesswho' ? (
              <ul className="guess-list">
                {choices
                  .filter((c) => !c.mine)
                  .map((c) => (
                    <li key={c.submission.id}>
                      <span className="reveal-num">{c.number}</span>
                      <span className="pick-text">{c.submission.text}</span>
                      <select
                        value={ballot.guesses[c.submission.id] ?? ''}
                        onChange={(e) =>
                          e.target.value &&
                          void cast(player.id, {
                            submissionId: c.submission.id,
                            guessPlayerId: e.target.value,
                          })
                        }
                      >
                        <option value="" disabled>
                          Who wrote it?
                        </option>
                        {snapshot.players
                          .filter((p) => p.id !== player.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </li>
                  ))}
              </ul>
            ) : (
              // Whole answers, not "#2" with the text hidden in a tooltip. A
              // tooltip cannot be read aloud, does not exist on a touch
              // screen, and is useless at the speed a host works.
              <div className="pick-list">
                {choices.map((c) =>
                  c.mine ? (
                    <div key={c.submission.id} className="pick pick-answer pick-mine">
                      <span className="reveal-num">{c.number}</span>
                      <span className="pick-text">{c.submission.text}</span>
                      <span className="pick-flag">theirs</span>
                    </div>
                  ) : (
                    <button
                      key={c.submission.id}
                      className={`pick pick-answer ${ballot.submissionId === c.submission.id ? 'chosen' : ''}`}
                      onClick={() => void cast(player.id, { submissionId: c.submission.id })}
                    >
                      <span className="reveal-num">{c.number}</span>
                      <span className="pick-text">{c.submission.text}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
