/**
 * The one screen. Everyone plays from their own device — there is no separate
 * shared screen to read aloud from, so whatever the room needs to know has to
 * live here: the scenario, all five outcomes once they open, who the room is
 * waiting on, everyone's final case and rate.
 *
 * One thing on screen at a time, and the rule this enforces: if it is not your
 * move you get NO controls — not disabled ones. A disabled button still asks
 * the reader to work out why it is disabled, and on a phone during a work call
 * nobody has the attention to spare.
 */

import { useState } from 'react';
import { OPTION_LETTERS, survivalOddsOf, type Snapshot } from '../types';
import { FINAL_PLEA, INTRO_QUESTIONS, OPENING, QUESTIONS, questionAt, questionLabel } from '../questions';
import type { Survival } from '../state/useSurvival';
import { Clip } from './Clip';

interface Props {
  survival: Survival;
  snapshot: Snapshot;
  me: string;
  isHost: boolean;
}

export function Player({ survival, snapshot, me, isHost }: Props) {
  return (
    <div className="phone">
      <div className="room-bar">
        <span>Room <strong>{snapshot.game.code}</strong></span>
        <span>{snapshot.players.find((p) => p.id === me)?.name}</span>
      </div>
      <Task survival={survival} snapshot={snapshot} me={me} />
      {isHost && <Console survival={survival} snapshot={snapshot} />}
    </div>
  );
}

function Task({ survival, snapshot, me }: Omit<Props, 'isHost'>) {
  const { game, players, myScores, answers } = snapshot;

  if (game.phase === 'lobby') {
    return (
      <div className="locked">
        <p className="muted">Join at <strong>{window.location.host}/survive</strong>, then enter the code:</p>
        <p className="code-badge">{game.code}</p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Start when everyone is actually here — anyone who joins later is marked down
          for every question they missed.
        </p>
        <div className="roster">
          {players.map((p) => (
            <span key={p.id} className="seat in">{p.name}</span>
          ))}
        </div>
      </div>
    );
  }

  if (game.phase === 'briefing') {
    return (
      <>
        <header>
          <p className="eyebrow">Emergency broadcast</p>
          <h2>The world ends on a Tuesday</h2>
        </header>
        <p className="setup">{OPENING}</p>
      </>
    );
  }

  if (game.phase === 'running') {
    const question = questionAt(game.questionIdx);
    const isWarmup = game.questionIdx < 0;
    const mine = answers.find((a) => a.playerId === me && a.questionIdx === game.questionIdx);

    if (!game.revealed && !mine) {
      return (
        <>
          {question.clip && <Clip src={question.clip} />}
          <header>
            <p className="eyebrow">{questionLabel(game.questionIdx)}</p>
            <h2>{question.title}</h2>
          </header>
          <p className="setup">{question.setup}</p>
          <div className="moves">
            {question.choices.map((choice, i) => (
              <button
                key={choice}
                className="move"
                onClick={() => void survival.answer(i)}
                disabled={survival.busy}
              >
                <span className="letter" aria-hidden>{OPTION_LETTERS[i]}</span>
                <span>{choice}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            One tap, and it is locked. Choose carefully.
          </p>
        </>
      );
    }

    if (!game.revealed && mine) {
      return (
        <div className="locked">
          {question.clip && <Clip src={question.clip} />}
          <p className="eyebrow">Choice locked</p>
          <p className="big" aria-label={`You chose ${OPTION_LETTERS[mine.optionIndex]}`}>
            {OPTION_LETTERS[mine.optionIndex]}
          </p>
          <p className="muted">{question.choices[mine.optionIndex]}</p>
          <p className="muted">
            {isWarmup ? 'Waiting on the room.' : 'Calculating survival probability.'}
          </p>
          <Waiting ids={snapshot.answeredPlayerIds} players={players} verb="chosen" />
        </div>
      );
    }

    // Revealed. Every outcome opens here, on every device, at once — reading
    // the room's answers is the whole point of a question that just closed.
    // The number is the one thing that never joins them: a real question's
    // percentage stays yours alone until the recap at the very end.
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '—';
    const tookIt = (optionIndex: number) =>
      answers
        .filter((a) => a.questionIdx === game.questionIdx && a.optionIndex === optionIndex)
        .map((a) => nameOf(a.playerId));

    // A warm-up has no SEALED entry and nothing for the backend's
    // survival_reveal_data to return, so its outcomes are built straight from
    // the public question data instead of `snapshot.reveal` — same shape, so
    // the row-rendering below never has to know which kind it is looking at.
    const rows = isWarmup
      ? question.outcomes!.map((outcome, i) => ({
          optionIndex: i, label: question.choices[i], outcome, takers: tookIt(i).length,
        }))
      : (snapshot.reveal ?? []);

    return (
      <>
        {question.clip && <Clip src={question.clip} />}
        <header>
          <p className="eyebrow">Outcome</p>
          <h2>{question.title}</h2>
        </header>
        <div className="reveal-list">
          {rows.map((row, i) => (
            <div
              key={row.optionIndex}
              className={`reveal-row${row.optionIndex === mine?.optionIndex ? ' mine-row' : ''}`}
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <span className="letter">{OPTION_LETTERS[row.optionIndex]}</span>
              <span style={{ minWidth: 0 }}>
                <strong>{row.label}</strong>
                <span className="outcome"> — {row.outcome}</span>
                {row.takers > 0 && <span className="takers"> [{tookIt(row.optionIndex).join(', ')}]</span>}
              </span>
            </div>
          ))}
        </div>
        {isWarmup ? (
          <p className="talk">Talk it out.</p>
        ) : (
          <p className="talk">Talk it out — and keep your own percentage to yourself.</p>
        )}
        {!isWarmup && (
          <MyNumbers thisRound={myScores.find((s) => s.questionIdx === game.questionIdx)?.survivalPct} scores={myScores} />
        )}
      </>
    );
  }

  if (game.phase === 'plea') return <PleaStep survival={survival} snapshot={snapshot} me={me} />;

  if (game.phase === 'tribunal') {
    const voted = snapshot.votes.find((v) => v.voterId === me);
    return (
      <>
        <header>
          <p className="eyebrow">The tribunal</p>
          <h2>One seat. Make the case.</h2>
        </header>
        <Board snapshot={snapshot} />
        {voted ? (
          <div className="locked">
            <p className="eyebrow">Vote cast</p>
            <h2>{players.find((p) => p.id === voted.targetPlayerId)?.name}</h2>
            <Waiting ids={snapshot.votedPlayerIds} players={players} verb="voted" />
          </div>
        ) : (
          <div className="moves">
            {players
              // You cannot vote for yourself, so your own name is not offered.
              // Offering it greyed out would only invite the question.
              .filter((p) => p.id !== me)
              .map((p) => (
                <button
                  key={p.id}
                  className="move"
                  onClick={() => void survival.vote(p.id)}
                  disabled={survival.busy}
                >
                  <span className="letter" aria-hidden>▸</span>
                  <span>{p.name}</span>
                </button>
              ))}
          </div>
        )}
      </>
    );
  }

  // Result.
  return (
    <>
      <header>
        <p className="eyebrow">Extraction complete</p>
        <h2>{winnerLine(snapshot)}</h2>
      </header>
      <Board snapshot={snapshot} />
    </>
  );
}

const winnerLine = (snapshot: Snapshot): string => {
  const winners = snapshot.winner ?? [];
  if (winners.length === 0) return 'Nobody made it';
  if (winners.length === 1) return `${winners[0].name} takes the seat`;
  // Level on votes and on survival rate. Two people can share a helicopter.
  return `${winners.map((w) => w.name).join(' and ')} share the seat`;
};

/**
 * The tribunal board: name, plea, and — at last — the rate.
 *
 * This is the first and only moment in the game that shows anybody's figure
 * but your own, and it shows all of them at once. That is the reveal the
 * whole night has been holding back. Vote tallies stay hidden until the
 * result, so nobody piles onto whoever is already ahead mid-vote.
 */
function Board({ snapshot }: { snapshot: Snapshot }) {
  const { standings, pleas, players, votes, game } = snapshot;
  const pleaOf = (id: string) => pleas.find((p) => p.playerId === id)?.text;
  const rows = standings ?? players.map((p) => ({
    playerId: p.id, name: p.name, rounds: 0, average: 0,
  }));

  return (
    <div className="board">
      {rows.map((row) => {
        const tally = votes.filter((v) => v.targetPlayerId === row.playerId).length;
        return (
          <div key={row.playerId} className="board-row">
            <span style={{ minWidth: 0 }}>
              <span className="who">{row.name}</span>
              <span className="said"> — “{pleaOf(row.playerId) ?? 'said nothing'}”</span>
              {game.phase === 'result' && tally > 0 && (
                <span className="takers"> · {tally} {tally === 1 ? 'vote' : 'votes'}</span>
              )}
            </span>
            <span className="rate">{row.average}%</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Who the room is waiting on, on every device that cares — there is no shared
 * screen carrying this anymore. Done and not-done differ in shape AND colour,
 * because across nine seats on a call a subtle difference is no difference.
 */
function Waiting({
  ids, players, verb,
}: { ids: string[]; players: Snapshot['players']; verb: string }) {
  const done = new Set(ids);
  return (
    <div>
      <div className="roster">
        {players.map((p) => (
          <span key={p.id} className={done.has(p.id) ? 'seat in' : 'seat out'}>
            {p.name}
          </span>
        ))}
      </div>
      <p className="sr-only" role="status">
        {done.size} of {players.length} have {verb}.
      </p>
    </div>
  );
}

/**
 * Your own figures, and nobody else's — the phone has no way to render another
 * player's, because the backend never sent one.
 */
function MyNumbers({ thisRound, scores }: { thisRound?: number; scores: Snapshot['myScores'] }) {
  const odds = survivalOddsOf(scores);
  if (odds === null) return null;
  return (
    <div className="mine">
      {thisRound !== undefined && (
        <span>
          That move: <strong>{thisRound}%</strong> made it
        </span>
      )}
      <span className="muted">
        Your survival rate so far: <strong>{odds}%</strong> over {scores.length}{' '}
        {scores.length === 1 ? 'call' : 'calls'}
      </span>
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        Nobody else can see this. Keep it that way.
      </span>
    </div>
  );
}

/**
 * The plea phase opens with a private recap — nobody has seen a single number
 * all night, so this is the first moment any of it adds up. It is a purely
 * local step: nothing here is synced or written anywhere, it is just a beat
 * before the composer, and every player dismisses their own on their own
 * schedule rather than everyone moving on together.
 */
function PleaStep({ survival, snapshot, me }: Omit<Props, 'isHost'>) {
  const [recapSeen, setRecapSeen] = useState(false);
  if (!recapSeen) {
    return <Recap snapshot={snapshot} me={me} onContinue={() => setRecapSeen(true)} />;
  }
  return <Plea survival={survival} snapshot={snapshot} me={me} />;
}

function Recap({ snapshot, me, onContinue }: { snapshot: Snapshot; me: string; onContinue: () => void }) {
  const mine = snapshot.answers.filter((a) => a.playerId === me && a.questionIdx >= 0);
  const rows = QUESTIONS.map((q, i) => {
    const answer = mine.find((a) => a.questionIdx === i);
    const score = snapshot.myScores.find((s) => s.questionIdx === i);
    return {
      title: q.title,
      letter: answer ? OPTION_LETTERS[answer.optionIndex] : '—',
      label: answer ? q.choices[answer.optionIndex] : 'no answer',
      pct: score?.survivalPct,
    };
  });
  const odds = survivalOddsOf(snapshot.myScores);

  return (
    <>
      <header>
        <p className="eyebrow">Your night</p>
        <h2>Before you plead your case</h2>
      </header>
      <div className="recap-list">
        {rows.map((r) => (
          <div key={r.title} className="recap-row">
            <span style={{ minWidth: 0 }}>
              <strong>{r.title}</strong>
              <span className="muted"> — {r.letter}: {r.label}</span>
            </span>
            <span className="rate">{r.pct ?? '—'}%</span>
          </div>
        ))}
      </div>
      {odds !== null && (
        <p className="muted">
          Your odds of making it out: <strong className="amber">{odds}%</strong>. Still yours
          alone — the room finds out at the tribunal.
        </p>
      )}
      <button className="primary" onClick={onContinue}>Continue to your plea</button>
    </>
  );
}

function Plea({ survival, snapshot, me }: Omit<Props, 'isHost'>) {
  const existing = snapshot.pleas.find((p) => p.playerId === me);
  const [text, setText] = useState(existing?.text ?? '');
  const left = FINAL_PLEA.maxChars - text.length;

  if (existing) {
    return (
      <div className="locked">
        <p className="eyebrow">Plea filed</p>
        <p className="muted">“{existing.text}”</p>
        <Waiting ids={snapshot.pleadedPlayerIds} players={snapshot.players} verb="filed a plea" />
      </div>
    );
  }

  return (
    <>
      <header>
        <p className="eyebrow">The chopper is leaving</p>
        <h2>Why should we take YOU?</h2>
      </header>
      <p className="setup">{FINAL_PLEA.setup}</p>
      <textarea
        rows={4}
        value={text}
        maxLength={FINAL_PLEA.maxChars}
        onChange={(e) => setText(e.target.value)}
        placeholder="One sentence."
        aria-label="Your plea to the pilot"
      />
      <p className="muted" style={{ fontSize: '0.8rem' }}>{left} characters left</p>
      <button
        className="primary"
        disabled={text.trim().length === 0 || survival.busy}
        onClick={() => void survival.plea(text)}
      >
        Submit plea
      </button>
    </>
  );
}

/**
 * The host's controls, on their own phone.
 *
 * The host plays too, so these live under the play area rather than replacing
 * it — and there is deliberately no way to see anybody's percentage from here.
 * A host who can read the room's numbers is a host who cannot play.
 */
function Console({ survival, snapshot }: { survival: Survival; snapshot: Snapshot }) {
  const { game, players, answeredPlayerIds } = snapshot;
  const waiting = game.phase === 'running' && !game.revealed;
  const everyone = answeredPlayerIds.length >= players.length;

  const remaining = game.phase === 'plea'
    ? players.length - snapshot.pleadedPlayerIds.length
    : game.phase === 'tribunal' ? players.length - snapshot.votedPlayerIds.length : 0;
  if (game.phase === 'result') return null;

  return (
    <div className="console">
      <p className="eyebrow">Host</p>
      {(game.phase === 'plea' || game.phase === 'tribunal') && (
        <p className="muted" role="status">
          {players.length - remaining} of {players.length} have {game.phase === 'plea' ? 'filed a plea' : 'voted'}.
          {remaining > 0 && ` Continuing now closes ${game.phase === 'plea' ? 'pleas' : 'voting'} for the rest.`}
        </p>
      )}
      {waiting && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {answeredPlayerIds.length} of {players.length} have chosen.
          {!everyone && game.questionIdx >= 0 && ' Opening now gives the rest the worst move.'}
        </p>
      )}
      <div className="row">
        {waiting ? (
          <button className="primary" onClick={() => void survival.reveal()} disabled={survival.busy}>
            {everyone ? 'Open the outcomes' : `Open without ${players.length - answeredPlayerIds.length} ${players.length - answeredPlayerIds.length === 1 ? 'choice' : 'choices'}`}
          </button>
        ) : (
          <button className="primary" onClick={() => void survival.advance()} disabled={survival.busy}>
            {remaining > 0 ? (game.phase === 'plea' ? `Open without ${remaining} ${remaining === 1 ? 'plea' : 'pleas'}` : `Count without ${remaining} ${remaining === 1 ? 'vote' : 'votes'}`) : nextLabel(game.phase, game.questionIdx)}
          </button>
        )}
      </div>
    </div>
  );
}

function nextLabel(phase: Snapshot['game']['phase'], questionIdx: number): string {
  if (phase === 'lobby') return 'Begin the briefing';
  if (phase === 'briefing') return INTRO_QUESTIONS.length > 0 ? 'Start the warm-up' : 'Start question 1';
  if (phase === 'running') {
    // The next warm-up is still a negative index below zero.
    if (questionIdx + 1 < 0) return `Warm-up ${questionIdx + INTRO_QUESTIONS.length + 2}`;
    // questionIdx + 1 === 0: the warm-ups are done, the real gauntlet opens.
    if (questionIdx < 0) return 'Question 1';
    return questionIdx < QUESTIONS.length - 1 ? `Question ${questionIdx + 2}` : 'The final plea';
  }
  if (phase === 'plea') return 'Open the tribunal';
  if (phase === 'tribunal') return 'Count the votes';
  return 'Finished';
}
