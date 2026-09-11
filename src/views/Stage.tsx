import { useEffect, useMemo, useState } from 'react';
import { CampfireScene } from '../scene/Campfire';
import type { AtmosphereCue, RitualEffects } from '../scene/fire';
import { themeById } from '../game/themes';
import type { GameSnapshot } from '../net';
import { castFrom, fireScaleFor } from '../scene/cast';
import { choicesFor } from '../game/ballot';
import { splitTally } from '../game/scoring';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, Leaderboard, Progress, cardFor, nameOf } from './shared';
import { Glyph } from '../ui/Glyph';

/**
 * The Stage is what the host screen-shares. It is read-only and deliberately
 * large: everything on it has to survive being re-encoded by a video call and
 * read from someone's second monitor.
 */
export function Stage({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const [flashes, setFlashes] = useState<{ id: number; emoji: string; playerId: string }[]>([]);

  useEffect(() => {
    const backend = campfire.backend;
    if (!backend) return;
    let n = 0;
    return backend.onReaction((r) => {
      const id = (n += 1);
      setFlashes((f) => [...f, { id, emoji: r.emoji, playerId: r.playerId }]);
      window.setTimeout(() => setFlashes((f) => f.filter((x) => x.id !== id)), 2200);
    });
  }, [campfire.backend]);

  const cue = useMemo(() => latestAtmosphereCue(flashes), [flashes]);
  const cast = useMemo(() => (snap ? castFrom(snap, flashes) : []), [snap, flashes]);
  const ritual = useMemo(() => (snap ? ritualFrom(snap, cue) : null), [snap, cue]);

  if (!snap) return <main className="stage stage-wait">Waiting for the game…</main>;

  const theme = themeById(snap.game.themeId);
  const card = cardFor(snap.game.deckId, snap.round?.cardId);
  const round = snap.round;
  const inLobby = snap.game.phase === 'lobby';
  const inAwards = snap.game.phase === 'awards';
  // Once answers are on screen they are what the room is reading, so the
  // prompt that produced them gives up most of the band.
  const showsAnswers =
    !!round && ['revealing', 'voting', 'scored'].includes(round.phase) && snap.submissions.length > 0;

  return (
    // Rows, not overlays: the scene gets its own band and the card gets
    // another, so a long prompt can never end up sitting on someone's face.
    <main className="stage">
      <header className="stage-top">
        <div className="stage-code">
          <span className="eyebrow">Room code</span>
          <strong>{snap.game.code}</strong>
        </div>
        <Progress game={snap.game} players={snap.players} usedCardIds={snap.usedCardIds} />
        {round && <Countdown round={round} big />}
      </header>

      <div className="stage-scene">
        <CampfireScene
          characters={cast}
          theme={theme}
          fireScale={fireScaleFor(snap.game.phase)}
          ritual={ritual}
          className="stage-canvas"
        />
        <aside className="stage-scores">
          <span className="eyebrow">Standing</span>
          <Leaderboard players={snap.players} present={snap.present} limit={8} />
        </aside>
      </div>

      <section
        className={`stage-centre ${showsAnswers ? 'with-answers' : ''}`}
        aria-live="polite"
      >
          {inLobby ? (
            <div className="stage-lobby">
              <h1>Pull up a log</h1>
              <p>
                Join at this address and enter <strong>{snap.game.code}</strong>.{' '}
                {snap.players.length} {snap.players.length === 1 ? 'person is' : 'people are'} here.
              </p>
            </div>
          ) : inAwards ? (
            <Awards snapshot={snap} />
          ) : (
            <>
              <CardPanel
                card={card}
                theme={theme}
                big
                subtitle={
                  round?.mechanic === 'solo' && round.turnPlayerId
                    ? nameOf(snap.players, round.turnPlayerId)
                    : round?.mechanic === 'duel'
                      ? `${nameOf(snap.players, round.turnPlayerId)} vs ${nameOf(snap.players, round.opponentId)}`
                      : undefined
                }
              />
              <PhaseDetail snapshot={snap} />
            </>
          )}
      </section>

      <div className="flashes" aria-hidden="true">
        {flashes.map((f) => (
          <span key={f.id} className="flash">
            {f.emoji}
          </span>
        ))}
      </div>
    </main>
  );
}

function PhaseDetail({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;
  if (!round) return null;

  const answered = snapshot.submittedPlayerIds.length;
  const eligible = snapshot.players.length;

  // A split has no answers to read out — the room's shape is the result.
  if (round.mechanic === 'split') {
    const card = cardFor(snapshot.game.deckId, round.cardId);
    const options = card?.options ?? [];
    const scored = round.phase === 'scored';
    // Sealed until scoring, like every other vote, so before then the screen
    // shows only how many have tapped.
    const tally = scored ? splitTally(snapshot.votes) : null;
    const high = tally ? Math.max(tally[0], tally[1]) : 0;

    return (
      <>
        <div className="stage-split">
          {options.map((option, i) => (
            <div
              key={option}
              className={`side ${tally && tally[i] === high && high > 0 ? 'won' : ''}`}
            >
              {option}
              {tally && <span className="split-count">{tally[i]}</span>}
            </div>
          ))}
        </div>
        {!scored && (
          <p className="stage-note">
            Tap one. {snapshot.votedPlayerIds.length} of {eligible} in.
          </p>
        )}
      </>
    );
  }

  switch (round.phase) {
    case 'choosing':
      return <p className="stage-note">Reading the card…</p>;

    case 'submitting':
      // A count, never the answers — this screen is shared, and the whole
      // mechanic depends on nobody seeing an answer early. The count comes
      // from who has acted, which is the only part of a sealed answer the
      // server will tell anyone.
      return (
        <p className="stage-note">
          Answers are sealed. {answered} of {eligible} in.
        </p>
      );

    case 'revealing':
      return <AnswerRows snapshot={snapshot} />;

    case 'voting': {
      // Answers stay on screen through the vote — people are voting on them,
      // and still without a name attached.
      const voters = eligibleVoters(snapshot).length;
      return (
        <>
          {snapshot.submissions.length > 0 && <AnswerRows snapshot={snapshot} />}
          <p className="stage-note">
            Vote on your own screen. {snapshot.votedPlayerIds.length} of {voters} in.
          </p>
        </>
      );
    }

    case 'scored': {
      const results = round.results;
      if (!results) return null;
      return (
        <div className="scored">
          <AnswerRows snapshot={snapshot} />
          <ul className="points">
            {Object.entries(results.points)
              .sort((a, b) => b[1] - a[1])
              .map(([playerId, pts]) => (
                <li key={playerId}>
                  <strong>{nameOf(snapshot.players, playerId)}</strong>
                  <span>
                    +{pts}
                    {results.notes?.[playerId] ? ` · ${results.notes[playerId]}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      );
    }

    default:
      return null;
  }
}

function AnswerRows({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;
  if (!round) return null;

  const authors = round.results?.authors ?? {};
  const progressCandles = anonymousVoteCandles(snapshot);
  const votesBySubmission = new Map<string, number>();
  for (const vote of snapshot.votes) {
    if (!vote.submissionId) continue;
    votesBySubmission.set(vote.submissionId, (votesBySubmission.get(vote.submissionId) ?? 0) + 1);
  }
  const highVote = Math.max(0, ...votesBySubmission.values());

  return (
    <ul className="reveal-list">
      {choicesFor(snapshot.submissions, null).map(({ submission: s, number }) => {
        const scored = round.phase === 'scored';
        const votes = votesBySubmission.get(s.id) ?? 0;
        const candleLit = scored ? Math.min(5, votes) : progressCandles;
        const isWinner = scored && highVote > 0 && votes === highVote;

        return (
          <li key={s.id} className={isWinner ? 'answer-winner' : undefined}>
            <span className="reveal-num">{number}</span>
            <span className="answer-body">
              <span className="pick-text">{s.text}</span>
              <CandleRow lit={candleLit} flare={isWinner} />
            </span>
            {scored && (
              <em className="reveal-author">
                {nameOf(snapshot.players, authors[s.id] ?? s.playerId)}
              </em>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CandleRow({ lit, flare = false }: { lit: number; flare?: boolean }) {
  return (
    <span className={`answer-candles ${flare ? 'flare' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((n) => (
        <i key={n} className={n < lit ? 'lit' : undefined} />
      ))}
    </span>
  );
}

function eligibleVoters(snapshot: GameSnapshot) {
  const round = snapshot.round;
  if (!round) return [];
  const excused =
    round.mechanic === 'solo' || round.mechanic === 'duel'
      ? [round.turnPlayerId, round.opponentId].filter(Boolean)
      : [];
  return snapshot.players.filter((p) => !excused.includes(p.id));
}

function anonymousVoteCandles(snapshot: GameSnapshot) {
  const total = eligibleVoters(snapshot).length;
  if (total === 0) return 0;
  return Math.min(5, Math.ceil((snapshot.votedPlayerIds.length / total) * 5));
}

function ritualFrom(snapshot: GameSnapshot, cue: AtmosphereCue | null): RitualEffects {
  const round = snapshot.round;
  const submitPhase =
    round &&
    (round.mechanic === 'allplay' || round.mechanic === 'guesswho') &&
    ['submitting', 'revealing', 'voting', 'scored'].includes(round.phase);
  const votePhase = round && ['voting', 'scored'].includes(round.phase);

  return {
    sealed: submitPhase ? snapshot.submittedPlayerIds.length : 0,
    submitTotal: submitPhase ? snapshot.players.length : 0,
    voted: votePhase ? snapshot.votedPlayerIds.length : 0,
    voteTotal: votePhase ? eligibleVoters(snapshot).length : 0,
    answerCount: snapshot.submissions.length,
    mood: ritualMoodFor(snapshot),
    cue,
  };
}

function ritualMoodFor(snapshot: GameSnapshot): RitualEffects['mood'] {
  const round = snapshot.round;
  if (snapshot.game.phase === 'finale') return 'finale';
  if (round?.mechanic === 'guesswho') return 'guesswho';
  switch (round?.phase) {
    case 'submitting':
    case 'revealing':
    case 'voting':
    case 'scored':
      return round.phase;
    default:
      return 'idle';
  }
}

function latestAtmosphereCue(
  flashes: { id: number; emoji: string; playerId: string }[],
): AtmosphereCue | null {
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const cue = cueForEmoji(flashes[i].emoji);
    if (cue) return cue;
  }
  return null;
}

function cueForEmoji(emoji: string): AtmosphereCue | null {
  switch (emoji) {
    case '🌫️':
      return 'hush';
    case '🥁':
      return 'drumroll';
    case '👏':
      return 'cheer';
    case '🕯️':
      return 'reveal';
    default:
      return null;
  }
}




/**
 * The last screen of the night. A leaderboard alone sends most of the room
 * away with nothing, so everyone leaves with a title — the superlatives are
 * computed from what actually happened, not handed out at random.
 */
function Awards({ snapshot }: { snapshot: GameSnapshot }) {
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score);
  const [winner] = ranked;

  const superlatives: { title: string; who: string; why: string }[] = [];

  const unspent = ranked.filter((p) => !p.passSpent);
  if (unspent.length > 0 && unspent.length < ranked.length) {
    superlatives.push({
      title: 'Never blinked',
      who: unspent.map((p) => p.name).join(', '),
      why: 'finished the night with the Pass unused',
    });
  }

  const passers = ranked.filter((p) => p.passSpent);
  if (passers.length > 0) {
    superlatives.push({
      title: 'Knew when to fold',
      who: passers.map((p) => p.name).join(', '),
      why: 'used the Pass, exactly as intended',
    });
  }

  const tail = ranked[ranked.length - 1];
  if (tail && tail.id !== winner?.id) {
    superlatives.push({
      title: 'Played anyway',
      who: tail.name,
      why: 'turned up for every card regardless',
    });
  }

  return (
    <div className="awards">
      <h1 className="awards-head">
        <Glyph name="laurels" size={40} />
        {winner ? `${winner.name} takes it` : 'That was the night'}
      </h1>
      <ol className="podium">
        {ranked.slice(0, 3).map((p, i) => (
          <li key={p.id} data-place={i + 1}>
            {i === 0 && <Glyph name="podium" size={20} />}
            <span className="podium-name">{p.name}</span>
            <span className="podium-score">{p.score}</span>
          </li>
        ))}
      </ol>
      <ul className="superlatives">
        {superlatives.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span>{s.who}</span>
            <em>{s.why}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
