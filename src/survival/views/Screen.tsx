/**
 * The shared screen — what the room is looking at through a screen-share.
 *
 * NOTHING HERE MAY SCROLL. The room cannot reach a scrollbar, so every list is
 * a fixed-fraction grid: content shrinks to fit rather than running off the
 * bottom where nobody knows it exists.
 *
 * And nothing here may show a percentage before the tribunal. The outcomes are
 * public; what they cost each person is not. The backend does not send those
 * figures, so this file could not render them if it tried — but it is worth
 * saying, because the obvious "improvement" to this screen is to add them.
 */

import { OPTION_LETTERS, type Snapshot } from '../types';
import { FINAL_PLEA, OPENING, questionAt, questionLabel } from '../questions';
import { Clip } from './Clip';

export function Screen({ snapshot }: { snapshot: Snapshot }) {
  const { game } = snapshot;
  return (
    <div className="screen">
      <Header snapshot={snapshot} />
      <div className="band">
        {game.phase === 'lobby' && <Lobby snapshot={snapshot} />}
        {game.phase === 'briefing' && <p className="setup">{OPENING}</p>}
        {game.phase === 'running' && <Question snapshot={snapshot} />}
        {game.phase === 'plea' && <p className="setup">{FINAL_PLEA.setup}</p>}
        {(game.phase === 'tribunal' || game.phase === 'result') && <Board snapshot={snapshot} />}
      </div>
      <Footer snapshot={snapshot} />
    </div>
  );
}

function Header({ snapshot }: { snapshot: Snapshot }) {
  const { game } = snapshot;
  const question = game.phase === 'running' ? questionAt(game.questionIdx) : null;

  return (
    <header>
      <p className="eyebrow">
        {game.phase === 'lobby' && 'Awaiting survivors'}
        {game.phase === 'briefing' && 'Emergency broadcast'}
        {question && questionLabel(game.questionIdx)}
        {game.phase === 'plea' && 'The final plea'}
        {game.phase === 'tribunal' && 'The tribunal'}
        {game.phase === 'result' && 'Extraction'}
      </p>
      <h2>
        {game.phase === 'lobby' && 'The Last Screen Standing'}
        {game.phase === 'briefing' && 'The world ends on a Tuesday'}
        {question?.title}
        {game.phase === 'plea' && FINAL_PLEA.title}
        {game.phase === 'tribunal' && 'One seat. Make the case.'}
        {game.phase === 'result' && winnerLine(snapshot)}
      </h2>
    </header>
  );
}

const winnerLine = (snapshot: Snapshot): string => {
  const winners = snapshot.winner ?? [];
  if (winners.length === 0) return 'Nobody made it';
  if (winners.length === 1) return `${winners[0].name} takes the seat`;
  // Level on votes and on survival rate. Two people can share a helicopter.
  return `${winners.map((w) => w.name).join(' and ')} share the seat`;
};

function Lobby({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
      <p className="muted">Join at <strong>{window.location.host}/survive</strong>, then enter the code:</p>
      <p className="code-badge">{snapshot.game.code}</p>
      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Start when everyone is actually here — anyone who joins later is marked down
        for every question they missed.
      </p>
      <div className="roster">
        {snapshot.players.map((p) => (
          <span key={p.id} className="seat in">{p.name}</span>
        ))}
      </div>
    </div>
  );
}

function Question({ snapshot }: { snapshot: Snapshot }) {
  const { game, reveal, answers, players } = snapshot;
  const question = questionAt(game.questionIdx);

  if (!game.revealed) {
    return (
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: '1rem', height: '100%', minHeight: 0 }}>
        {question.clip && <Clip src={question.clip} variant="backdrop" />}
        <p className="setup">{question.setup}</p>
        <div className="screen-moves">
          {question.choices.map((choice, i) => (
            <div key={choice} className="screen-move">
              <span className="letter">{OPTION_LETTERS[i]}</span>
              <span>{choice}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '—';
  const tookIt = (optionIndex: number) =>
    answers
      .filter((a) => a.questionIdx === game.questionIdx && a.optionIndex === optionIndex)
      .map((a) => nameOf(a.playerId));

  // A warm-up has no SEALED entry and nothing for the backend's
  // survival_reveal_data to return, so its "reveal" is built straight from the
  // public question data rather than from `snapshot.reveal` — the same shape,
  // just a different source, so the row-rendering below never has to know
  // which kind of question it is looking at.
  const rows = game.questionIdx < 0
    ? question.outcomes!.map((outcome, i) => ({
        optionIndex: i,
        label: question.choices[i],
        outcome,
        takers: tookIt(i).length,
      }))
    : (reveal ?? []);

  return (
    <>
      {question.clip && <Clip src={question.clip} variant="backdrop" />}
      <div className="screen-moves">
        {rows.map((row, i) => (
          <div
            key={row.optionIndex}
            className="screen-move reveal-row"
            // A beat between each row, so the reveal lands one at a time without
            // the host having to click five times.
            style={{ animationDelay: `${i * 0.18}s` }}
          >
            <span className="letter">{OPTION_LETTERS[row.optionIndex]}</span>
            <span style={{ minWidth: 0 }}>
              <strong>{row.label}</strong>
              <span className="outcome"> — {row.outcome}</span>
              {row.takers > 0 && (
                <span className="takers"> [{tookIt(row.optionIndex).join(', ')}]</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The tribunal board: name, plea, and — at last — the rate.
 *
 * This is the first and only screen in the game that shows anybody's figure,
 * and it shows all of them at once. That is the reveal the whole night has
 * been holding back.
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

function Footer({ snapshot }: { snapshot: Snapshot }) {
  const { game, players, answeredPlayerIds, pleadedPlayerIds, votedPlayerIds } = snapshot;

  // The single instruction that makes this game work. Without it people simply
  // compare numbers and the bluffing — which is the whole point — never starts.
  // A warm-up has no percentage to hold back, so it gets a plainer line.
  if (game.phase === 'running' && game.revealed) {
    return (
      <p className="talk">
        {game.questionIdx < 0 ? 'Talk it out.' : 'Talk it out — and keep your own percentage to yourself.'}
      </p>
    );
  }

  if (game.phase === 'running') return <Waiting ids={answeredPlayerIds} players={players} verb="chosen" />;
  if (game.phase === 'plea') {
    return <Waiting ids={pleadedPlayerIds} players={players} verb="filed" />;
  }
  if (game.phase === 'tribunal') {
    return <Waiting ids={votedPlayerIds} players={players} verb="voted" />;
  }
  return <p className="muted" style={{ fontSize: '0.85rem' }}>Room {game.code}</p>;
}

/**
 * Who the room is waiting on.
 *
 * Done and not-done differ in colour AND in shape, because across nine seats
 * through a video call a subtle difference is no difference at all.
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
      <p className="sr-only" aria-live="polite">
        {done.size} of {players.length} have {verb}.
      </p>
    </div>
  );
}
