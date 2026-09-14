/**
 * The phone.
 *
 * One thing on screen at a time, and the rule this enforces: if it is not your
 * move you get NO controls — not disabled ones. A disabled button still asks
 * the reader to work out why it is disabled, and on a phone during a work call
 * nobody has the attention to spare.
 */

import { useState } from 'react';
import { OPTION_LETTERS, averageOf, type Snapshot } from '../types';
import { FINAL_PLEA, INTRO_QUESTIONS, QUESTIONS, questionAt, questionLabel } from '../questions';
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

  if (game.phase === 'lobby' || game.phase === 'briefing') {
    return (
      <div className="locked">
        <p className="eyebrow">
          <span className="pulse" style={{ display: 'inline-block', marginRight: '0.5rem' }} />
          Vitals stable
        </p>
        <h2>Awaiting deployment…</h2>
        <p className="muted">
          {players.length} {players.length === 1 ? 'survivor' : 'survivors'} on the channel.
          Watch the shared screen.
        </p>
      </div>
    );
  }

  if (game.phase === 'running') {
    const question = questionAt(game.questionIdx);
    const isWarmup = game.questionIdx < 0;
    const mine = answers.find((a) => a.playerId === me && a.questionIdx === game.questionIdx);

    if (!game.revealed && !mine) {
      return (
        <>
          {question.clip && <Clip src={question.clip} variant="strip" />}
          <header>
            <p className="eyebrow">{questionLabel(game.questionIdx)}</p>
            <h2>{question.title}</h2>
          </header>
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
          {question.clip && <Clip src={question.clip} variant="strip" />}
          <p className="eyebrow">Choice locked</p>
          <p className="big" aria-label={`You chose ${OPTION_LETTERS[mine.optionIndex]}`}>
            {OPTION_LETTERS[mine.optionIndex]}
          </p>
          <p className="muted">{question.choices[mine.optionIndex]}</p>
          <p className="muted">
            {isWarmup ? 'Waiting on the room' : 'Calculating survival probability. Waiting for the other survivors'} —{' '}
            {snapshot.answeredPlayerIds.length} of {players.length} in.
          </p>
        </div>
      );
    }

    // Revealed. For a real question this is the only moment a figure reaches a
    // phone, and it is only ever your own — a warm-up has no figure at all, so
    // it just shows its flavour line instead.
    const thisRound = myScores.find((s) => s.questionIdx === game.questionIdx);
    return (
      <>
        {question.clip && <Clip src={question.clip} variant="strip" />}
        <header>
          <p className="eyebrow">Outcome</p>
          <h2>{question.title}</h2>
        </header>
        {mine && (
          <p className="muted">
            You took <strong className="amber">{OPTION_LETTERS[mine.optionIndex]}</strong> —{' '}
            {question.choices[mine.optionIndex]}
            {mine.autoAssigned && ' (chosen for you — you were not with us)'}
            {isWarmup && question.outcomes && ` — ${question.outcomes[mine.optionIndex]}`}
          </p>
        )}
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {isWarmup
            ? 'The outcomes are on the shared screen.'
            : 'The outcomes are on the shared screen. Talk it through — and keep your number to yourself.'}
        </p>
        <MyNumbers thisRound={thisRound?.survivalPct} scores={myScores} />
      </>
    );
  }

  if (game.phase === 'plea') return <Plea survival={survival} snapshot={snapshot} me={me} />;

  if (game.phase === 'tribunal') {
    const voted = snapshot.votes.find((v) => v.voterId === me);
    if (voted) {
      const who = players.find((p) => p.id === voted.targetPlayerId);
      return (
        <div className="locked">
          <p className="eyebrow">Vote cast</p>
          <h2>{who?.name}</h2>
          <p className="muted" role="status">{snapshot.votedPlayerIds.length} of {players.length} have voted. Awaiting the final tally.</p>
        </div>
      );
    }
    return (
      <>
        <header>
          <p className="eyebrow">The tribunal</p>
          <h2>Who takes the seat?</h2>
          <p className="muted">The rates and the pleas are on the shared screen.</p>
        </header>
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
      </>
    );
  }

  // Result.
  return (
    <div className="locked">
      <p className="eyebrow">Extraction complete</p>
      <h2>{(snapshot.winner ?? []).map((w) => w.name).join(' and ') || 'Nobody'}</h2>
      <p className="muted">Look at the shared screen.</p>
      <MyNumbers scores={myScores} publicRates />
    </div>
  );
}

/**
 * Your own figures, and nobody else's — the phone has no way to render another
 * player's, because the backend never sent one.
 */
function MyNumbers({ thisRound, scores, publicRates = false }: { thisRound?: number; scores: Snapshot['myScores']; publicRates?: boolean }) {
  const average = averageOf(scores);
  if (average === null) return null;
  return (
    <div className="mine">
      {thisRound !== undefined && (
        <span>
          That move: <strong>{thisRound}%</strong> made it
        </span>
      )}
      <span className="muted">
        Your survival rate so far: <strong>{average}%</strong> over {scores.length}{' '}
        {scores.length === 1 ? 'call' : 'calls'}
      </span>
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        {publicRates ? 'The tribunal has opened everyone’s survival rate.' : 'Nobody else can see this. Keep it that way.'}
      </span>
    </div>
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
        <p className="muted" role="status">{snapshot.pleadedPlayerIds.length} of {snapshot.players.length} pleas filed. Waiting for the host to open the tribunal.</p>
      </div>
    );
  }

  return (
    <>
      <header>
        <p className="eyebrow">The chopper is leaving</p>
        <h2>Why should we take YOU?</h2>
      </header>
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
  const screenUrl = new URL(window.location.href);
  screenUrl.searchParams.set('c', game.code);
  screenUrl.searchParams.set('screen', '1');
  if (game.phase === 'result') return null;

  return (
    <div className="console">
      <p className="eyebrow">Host</p>
      <a className="link" href={screenUrl.toString()} target="_blank" rel="noopener noreferrer">Open shared screen ↗</a>
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
