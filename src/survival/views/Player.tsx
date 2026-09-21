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

import { useEffect, useRef, useState } from 'react';
import { OPTION_LETTERS, survivalOddsOf, type Snapshot } from '../types';
import {
  EXTRACTION,
  EXTRACTION_BRIEF,
  FINAL_PLEA,
  INTRO_QUESTIONS,
  OPENING,
  QUESTIONS,
  RUTHLESS_LIMIT,
  marksOf,
  questionAt,
  questionLabel,
  type Question,
} from '../questions';
import { buildDebrief } from '../debrief';
import type { Survival } from '../state/useSurvival';
import { Clip } from './Clip';
import { clockOf } from '../puzzles';
import { DigitRain } from '../scene/DigitRain';
import { Terminal } from '../scene/Terminal';

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
        {game.mode === 'consensus' && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Playing in teams tonight — you&rsquo;ll be paired up once the briefing starts, and
            any teammate&rsquo;s tap locks the choice in for both of you.
          </p>
        )}
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
        <p className="setup">{EXTRACTION_BRIEF}</p>
        <TeamBanner snapshot={snapshot} me={me} />
        <Notepad gameId={game.id} me={me} />
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
          <TeamBanner snapshot={snapshot} me={me} />
          <ManifestLine key={game.questionIdx} question={question} snapshot={snapshot} questionIdx={game.questionIdx} />
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
            {snapshot.myTeam && snapshot.myTeam.length > 1
              ? 'Any one of you can lock this in for the whole team. Talk fast.'
              : 'One tap, and it is locked. Choose carefully.'}
          </p>
          <Exchange survival={survival} snapshot={snapshot} me={me} />
          <Notepad gameId={game.id} me={me} />
        </>
      );
    }

    if (!game.revealed && mine) {
      const onATeam = Boolean(snapshot.myTeam && snapshot.myTeam.length > 1);
      return (
        <div className="locked">
          {question.clip && <Clip src={question.clip} />}
          <p className="eyebrow">Choice locked</p>
          <p className="big" aria-label={`${onATeam ? 'Your team chose' : 'You chose'} ${OPTION_LETTERS[mine.optionIndex]}`}>
            {OPTION_LETTERS[mine.optionIndex]}
          </p>
          <p className="muted">{question.choices[mine.optionIndex]}</p>
          <p className="muted">
            {isWarmup ? 'Waiting on the room.' : 'Calculating survival probability.'}
          </p>
          {onATeam && <p className="muted" style={{ fontSize: '0.8rem' }}>Locked in by whoever on your team tapped first.</p>}
          <ManifestLine key={game.questionIdx} question={question} snapshot={snapshot} questionIdx={game.questionIdx} />
          <Waiting ids={snapshot.answeredPlayerIds} players={players} verb="chosen" />
          <Exchange survival={survival} snapshot={snapshot} me={me} />
          <Notepad gameId={game.id} me={me} />
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

    const isLastRealQuestion = !isWarmup && game.questionIdx === QUESTIONS.length - 1;
    const myMarks = marksOf(answers, me);

    return (
      <>
        {question.clip && <Clip src={question.clip} />}
        <header>
          <p className="eyebrow">Outcome</p>
          <h2>{question.title}</h2>
        </header>
        <ManifestLine key={game.questionIdx} question={question} snapshot={snapshot} questionIdx={game.questionIdx} />
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
        {isLastRealQuestion && <Transmission text={EXTRACTION.rule} />}
        {!isWarmup && (
          <MyNumbers
            thisRound={myScores.find((s) => s.questionIdx === game.questionIdx)?.survivalPct}
            scores={myScores}
            marks={myMarks}
          />
        )}
        <Exchange survival={survival} snapshot={snapshot} me={me} />
        <Notepad gameId={game.id} me={me} />
      </>
    );
  }

  if (game.phase === 'plea') return <PleaStep survival={survival} snapshot={snapshot} me={me} />;

  if (game.phase === 'tribunal') {
    const escaped = new Set(snapshot.escapedPlayerIds);
    // The vote has its own budgeted seat now, so a room where several people
    // cracked the code no longer walks everybody through a tribunal that
    // cannot change anything. The only way it is still moot is if there is
    // literally nobody left to vote for.
    const votingIsMoot = players.every((p) => p.id === me || escaped.has(p.id));
    const voted = snapshot.votes.find((v) => v.voterId === me);

    return (
      <>
        <header>
          <p className="eyebrow">The tribunal</p>
          <h2>
            {snapshot.seatCount} {snapshot.seatCount === 1 ? 'seat' : 'seats'}. Make the case for
            what is left.
          </h2>
        </header>
        <Board snapshot={snapshot} />
        {escaped.has(me) ? (
          <Aboard snapshot={snapshot} me={me} />
        ) : votingIsMoot ? (
          <p className="talk">
            Everybody still standing is already aboard. There is nothing left to vote on.
          </p>
        ) : voted ? (
          <div className="locked">
            <p className="eyebrow">Vote cast</p>
            <h2>{players.find((p) => p.id === voted.targetPlayerId)?.name}</h2>
            <Waiting ids={snapshot.votedPlayerIds} players={players} verb="voted" />
          </div>
        ) : (
          <div className="moves">
            {players
              // You cannot vote for yourself, and an escapee cannot be voted
              // for either — both are already off the table, so neither is
              // offered rather than offered disabled.
              .filter((p) => p.id !== me && !escaped.has(p.id))
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
        <h2>{seatsLine(snapshot)}</h2>
      </header>
      <Board snapshot={snapshot} />
      {bumpedLine(snapshot)}
      {contestedLine(snapshot)}
      <KeyReveal snapshot={snapshot} />
      <Debrief snapshot={snapshot} />
    </>
  );
}

/**
 * What the code actually was, and how it was built.
 *
 * The backend has computed this at `result` since the extraction puzzle
 * shipped — `survival_key_reveal` raises before then, and that refusal is
 * part of the seal — and no screen has ever rendered it. So a room that did
 * not crack the code spent the night assembling a manifest and then never
 * found out what it added up to, which is the one piece of information
 * everybody wants the moment it stops mattering.
 */
function KeyReveal({ snapshot }: { snapshot: Snapshot }) {
  if (!snapshot.keyReveal) return null;
  return (
    <div className="transmission green">
      <p className="eyebrow">The manifest, unsealed</p>
      <p className="big-code">{snapshot.keyReveal.code}</p>
      <p className="muted">{snapshot.keyReveal.recipe}</p>
    </div>
  );
}

/**
 * Discussion prompts for whoever is facilitating, built from what the room
 * actually did — not a fixed script. See src/survival/debrief.ts for why
 * this needs no new data: it is the same public per-round tally the live
 * reveal already showed, just kept for all nine rounds instead of one.
 */
function Debrief({ snapshot }: { snapshot: Snapshot }) {
  const prompts = buildDebrief(snapshot.answers);
  if (prompts.length === 0) return null;
  return (
    <div className="debrief">
      <p className="eyebrow">Talk it out</p>
      {prompts.map((p) => (
        <div key={p.title} className="debrief-row">
          <strong>{p.title}</strong>
          <p className="muted">{p.body}</p>
        </div>
      ))}
    </div>
  );
}

/** "A" / "A and B" / "A, B and C" — shared by every line that lists seat-holders by name. */
const joinNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Who got out, by which of the three paths, and what the room failed to do.
 *
 * The last clause is the point. A seat won by the vote when nobody cracked
 * the code is not the same result as a seat won by the vote alongside one —
 * it means the room never assembled the manifest, which is a thing the room
 * did together and should be told about together. Without it the ending is
 * only ever a list of who won.
 */
const seatsLine = (snapshot: Snapshot): string => {
  const seats = snapshot.seats ?? [];
  if (seats.length === 0) return 'The chopper leaves empty. Nobody got out.';

  const named = (path: string) => seats.filter((s) => s.path === path).map((s) => s.name);
  const byCode = named('escape');
  const byRecord = named('record');
  const byVote = named('vote');

  const clauses: string[] = [];
  if (byCode.length) clauses.push(`${joinNames(byCode)} read the port the code`);
  if (byRecord.length) clauses.push(`${joinNames(byRecord)} survived the night on the numbers`);
  if (byVote.length) clauses.push(`the room voted ${joinNames(byVote)} aboard`);

  // The clauses are written lower-case so they read as a list wherever they
  // land; whichever one comes first has to start the sentence.
  const joined = clauses.join('. ');
  const line = joined.charAt(0).toUpperCase() + joined.slice(1);
  const empty = snapshot.seatCount - seats.filter((s) => !s.contested).length;
  const failures: string[] = [];
  if (!byCode.length) failures.push('nobody cracked the code');
  if (empty > 0) failures.push(`${empty} seat${empty === 1 ? '' : 's'} left empty`);

  return failures.length ? `${line} — ${failures.join(', ')}` : line;
};

/**
 * Names whoever is sharing the last seat, unresolved — a vote that tied all
 * the way down to the unrounded odds, or a team that cracked the code
 * together but outgrew the room left for them. Either way `contested` means
 * the algorithm ran out of ways to pick one winner honestly, so this says so
 * instead of pretending the seat numbers on the board are the whole story.
 */
function contestedLine(snapshot: Snapshot) {
  const contested = (snapshot.seats ?? []).filter((s) => s.contested);
  if (contested.length === 0) return null;
  const cause = contested[0].path === 'escape'
    ? 'cracked the code together — there was no room for all of them'
    : contested[0].path === 'record'
      ? 'came through the night on identical odds, with nothing left to separate them'
      : 'tied for the last seat, all the way down, with nothing left to break it';
  return (
    <p className="talk" style={{ borderColor: 'var(--amber)' }}>
      {joinNames(contested.map((s) => s.name))} {cause}. Seat {contested[0].seat} is shared,
      not decided.
    </p>
  );
}

/**
 * Names anyone who solved the extraction code but was refused a seat anyway —
 * the one claim this can make honestly without re-running the seat algorithm
 * client-side. A disqualified player who never solved it and lost the vote
 * was never "bumped" from anything, so this stays silent about them.
 */
/**
 * A little alliterative flourish for the one moment this game rewards it —
 * somebody clawed their way to a seat and their own ruthlessness cost them
 * it anyway. Original line, not a quotation from anywhere; the "V" run is
 * just a wink at the genre this scene belongs to.
 */
function bumpedLine(snapshot: Snapshot) {
  const disqualified = new Set((snapshot.ruthless ?? []).filter((r) => r.disqualified).map((r) => r.playerId));
  const seated = new Set((snapshot.seats ?? []).map((s) => s.playerId));
  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? '—';
  const refused = snapshot.escapedPlayerIds.filter((id) => disqualified.has(id) && !seated.has(id));
  if (refused.length === 0) return null;
  return (
    <p className="talk" style={{ borderColor: 'var(--alarm)' }}>
      Vicious, vengeful, and very nearly victorious — {refused.map(nameOf).join(', ')} cracked
      the code, and the port voided the seat anyway. {RUTHLESS_LIMIT} or more marks is more than
      it will carry.
    </p>
  );
}

/**
 * The tribunal board: name, plea, and — at last — the rate.
 *
 * This is the first and only moment in the game that shows anybody's figure
 * but your own, and it shows all of them at once. That is the reveal the
 * whole night has been holding back. Vote tallies stay hidden until the
 * result, so nobody piles onto whoever is already ahead mid-vote.
 */
function Board({ snapshot }: { snapshot: Snapshot }) {
  const { standings, pleas, players, votes, game, ruthless } = snapshot;
  const pleaOf = (id: string) => pleas.find((p) => p.playerId === id)?.text;
  const escaped = new Set(snapshot.escapedPlayerIds);
  const marksOfPlayer = (id: string) => ruthless?.find((r) => r.playerId === id);
  const seatOf = (id: string) => snapshot.seats?.find((s) => s.playerId === id);
  const rows = standings ?? players.map((p) => ({
    playerId: p.id, name: p.name, rounds: 0, average: 0,
  }));

  return (
    <div className="board">
      {rows.map((row, i) => {
        const tally = votes.filter((v) => v.targetPlayerId === row.playerId).length;
        const marks = marksOfPlayer(row.playerId);
        const seat = seatOf(row.playerId);
        return (
          <div
            key={row.playerId}
            className={`board-row${game.phase === 'result' && marks?.disqualified ? ' bumped' : ''}`}
          >
            <span style={{ minWidth: 0 }}>
              <span className="rank">{i + 1}.</span>{' '}
              <span className="who">{escaped.has(row.playerId) && '▲ '}{row.name}</span>
              <span className="said"> — “{pleaOf(row.playerId) ?? 'said nothing'}”</span>
              {seat && (
                <span className="seated">
                  {' '}· seat {seat.seat}{seat.contested ? ' (shared)' : ''}
                </span>
              )}
              {game.phase === 'result' && tally > 0 && (
                <span className="takers"> · {tally} {tally === 1 ? 'vote' : 'votes'}</span>
              )}
              {game.phase === 'result' && marks && (
                <span className="marks"> · {marks.marks} {marks.marks === 1 ? 'mark' : 'marks'}</span>
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
 * "Your team: X, Y" — shown once teams exist (from the briefing onward) so
 * nobody is guessing who they're deciding with. Silent in solo mode, and
 * silent for a lone (teamless) player, since there is nothing to announce.
 */
function TeamBanner({ snapshot, me }: { snapshot: Snapshot; me: string }) {
  const team = snapshot.myTeam;
  if (!team || team.length < 2) return null;
  const names = team
    .filter((id) => id !== me)
    .map((id) => snapshot.players.find((p) => p.id === id)?.name)
    .filter(Boolean);
  return (
    <p className="muted" style={{ fontSize: '0.85rem' }}>
      Your team: you and {names.join(', ')}.
    </p>
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
function MyNumbers({
  thisRound, scores, marks,
}: { thisRound?: number; scores: Snapshot['myScores']; marks: number }) {
  const odds = survivalOddsOf(scores);
  if (odds === null) return null;
  const marksClass = marks >= RUTHLESS_LIMIT - 1 ? 'alarm' : marks >= RUTHLESS_LIMIT - 2 ? 'amber' : 'muted';
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
      <span className={marksClass}>
        Marks against your name: <strong>{marks}</strong> of {RUTHLESS_LIMIT}
      </span>
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        Nobody else can see this. Keep it that way.
      </span>
    </div>
  );
}

/** The current round's manifest line, if this round carries one and it has arrived. */
/** Placeholder glyph and prompt per obscuring style — see `Question.manifest.style`. */
const MANIFEST_STYLE_COPY: Record<'frost' | 'static' | 'torn', { placeholder: string; prompt: string }> = {
  frost: { placeholder: '❄❄', prompt: 'tap to wipe the frost' },
  static: { placeholder: '▮▮', prompt: 'tap to stabilise the signal' },
  torn: { placeholder: '▨▨', prompt: 'tap to piece it together' },
};

/**
 * A manifest line, obscured until tapped. The real digit is never in the DOM
 * until `revealed` flips true — this is a placeholder-swap, not a CSS blur a
 * curious player could see around by inspecting the page. Starts hidden on
 * every mount, which in practice means every phase transition within a round
 * hides it again: a small, deliberate cost for not having written it down.
 */
function ManifestLine({
  question, snapshot, questionIdx,
}: { question: Question; snapshot: Snapshot; questionIdx: number }) {
  const [revealed, setRevealed] = useState(false);
  const manifest = question.manifest;
  const clue = snapshot.clue;
  if (!manifest) return null;

  // Consensus mode: this round has a clue, but a teammate is the seer, not
  // me. Named who to ask, never the digit itself — the only way to get it
  // is to actually talk to them.
  if (clue?.questionIdx !== questionIdx) {
    if (!snapshot.clueSeer) return null;
    return (
      <div className={`transmission ${manifest.color} ${manifest.style} asking`}>
        Your team has this one — ask <strong>{snapshot.clueSeer.name}</strong> what their screen showed.
      </div>
    );
  }

  const copy = MANIFEST_STYLE_COPY[manifest.style];
  return (
    <div className="manifest-rig">
      {/* Un-stacked: the machine is one object (photo, lit from inside by
          the rain, nothing else on it), the line you actually read is a
          separate, plain box next to it. The two together were reading as
          noise piled on top of itself; apart, each one is legible on its
          own. Rain pours harder while hidden and settles once there's a
          real digit — the tap that reveals it is still the payoff. */}
      <Terminal color={manifest.color} label={`BERTH ${manifest.berth}`}>
        <DigitRain color={manifest.color} intensity={revealed ? 0.2 : 0.8} />
      </Terminal>
      <div
        role="button"
        tabIndex={0}
        className={`transmission ${manifest.color} ${manifest.style}${revealed ? ' revealed' : ''}`}
        onClick={() => setRevealed(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setRevealed(true);
        }}
      >
        {manifest.line(revealed ? String(clue.digit) : copy.placeholder)}
        {!revealed && <span className="reveal-hint"> — {copy.prompt}</span>}
      </div>
    </div>
  );
}

/** A one-off reminder, not a reveal — the rule was already stated in full at the briefing. */
function Transmission({ text }: { text: string }) {
  return <p className="transmission alarm">{text}</p>;
}

/**
 * A private, self-managed scratchpad. Nothing here is synced anywhere or
 * collected for the player automatically — if a clue isn't written down
 * while it's on screen, it's gone the moment the host advances. Keyed on
 * both game and player: under `?net=local`, several tabs share one
 * `localStorage` but are different people.
 */
/**
 * The Exchange — the room's shared ledger, and the only place fragments move.
 *
 * Three taps and nothing typed: post the rule you hold, ask for a berth you
 * cannot finish, or name the line you think survives. None of them needs a
 * voice, which is the point. A third of any team will not speak up on a call
 * with twenty people on it, and if trading needs speech then the fragments
 * only ever move between the people who already talk.
 *
 * Posting is irreversible and purely generous: it helps whoever is racing
 * you for the same seat, and the board records that you did it. That is the
 * whole tension, and it is the thing the debrief has to work with.
 */
function Exchange({ survival, snapshot, me }: Omit<Props, 'isHost'>) {
  const open = snapshot.puzzles;
  // Open on the berth that most needs attention: the newest one this team
  // has not solved, falling back to the newest of all.
  const firstUnsolved = [...open].reverse().find((p) => p.digit === null);
  const [showing, setShowing] = useState<number | null>(null);
  const berth = open.find((p) => p.berth === showing) ?? firstUnsolved ?? open[open.length - 1];
  if (!berth) return null;

  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? '—';
  const solvedCount = open.filter((p) => p.digit !== null).length;
  const asking = berth.askingPlayerIds.filter((id) => id !== me);

  return (
    <div className="ledger">
      <p className="eyebrow">
        The ledger · {solvedCount} of {EXTRACTION.length} seals
      </p>

      <div className="berth-tabs" role="tablist">
        {open.map((p) => (
          <button
            key={p.berth}
            role="tab"
            aria-selected={p.berth === berth.berth}
            className={`berth-tab${p.berth === berth.berth ? ' on' : ''}${p.digit !== null ? ' got' : ''}`}
            onClick={() => setShowing(p.berth)}
          >
            {/* Shape as well as colour: across nine of these on a small
                screen a hue on its own is not a difference. */}
            {p.digit !== null ? '▍' : '·'} Berth {p.berth}
            {p.digit !== null && <strong> {p.digit}</strong>}
          </button>
        ))}
      </div>

      {berth.digit !== null ? (
        <p className="talk">
          Berth {berth.berth} reads <strong>{berth.digit}</strong>. Your team has it
          {berth.firstSolvedBy ? ` — ${berth.firstSolvedBy} got there first.` : '.'}
        </p>
      ) : (
        <>
          <div className="manifest">
            {berth.lines.map((line) => (
              <button
                key={line.id}
                className="manifest-line"
                onClick={() => void survival.solveBerth(berth.berth, line.id)}
                disabled={survival.busy}
              >
                <span className="letter" aria-hidden>{line.id}</span>
                <span>
                  berth {line.berth} · seal {line.seal} · {clockOf(line.signedAt)} · {line.signer}
                </span>
              </button>
            ))}
          </div>
          <p className="fine">Tap the line that survives every rule below.</p>
        </>
      )}

      {berth.myRule && (
        <div className={`transmission${berth.myRulePosted ? ' green' : ''}`}>
          <p className="eyebrow">{berth.myRulePosted ? 'You published' : 'Yours alone'}</p>
          <p>{berth.myRule}</p>
          {!berth.myRulePosted && (
            <button
              className="primary"
              onClick={() => void survival.postFragment(berth.berth)}
              disabled={survival.busy}
            >
              Publish it to the ledger
            </button>
          )}
        </div>
      )}

      {berth.posted.length > 0 && (
        <div className="posted">
          {berth.posted.map((post) => (
            <p key={post.playerId + post.text}>
              <strong>{nameOf(post.playerId)}</strong> — {post.text}
            </p>
          ))}
        </div>
      )}

      {berth.digit === null && (
        <>
          {asking.length > 0 && (
            <p className="fine">
              {asking.length === 1
                ? `${nameOf(asking[0])} is asking for this one.`
                : `${asking.length} people are asking for this one.`}
            </p>
          )}
          {!berth.askingPlayerIds.includes(me) && (
            <button
              className="link"
              onClick={() => void survival.askForBerth(berth.berth)}
              disabled={survival.busy}
            >
              I need berth {berth.berth}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Notepad({ gameId, me }: { gameId: string; me: string }) {
  const key = `survival:notes:${gameId}:${me}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  return (
    <details className="notepad">
      <summary>Notes</summary>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            localStorage.setItem(key, e.target.value);
          } catch {
            /* Private-browsing or a full quota — the note just doesn't persist. */
          }
        }}
        placeholder="Whatever you need to remember."
      />
      <p className="muted" style={{ fontSize: '0.7rem' }}>Never leaves this phone.</p>
    </details>
  );
}

/**
 * The plea phase opens with a private recap, then the keypad, then either the
 * composer or silence. Whether you've escaped is checked fresh on every
 * render — never stored in this step's own state — because a submission from
 * the keypad can land mid-render and flip it true out from under you.
 *
 * Two different ways out of the keypad lead to two different places, on
 * purpose. Choosing "I'll take my chances with the room" is opting OUT of
 * the code before ever failing it — you still get to make your case, same as
 * anyone who never tried. Running out of tries is different: the briefing
 * says it plainly ("the port stops listening and it is the room who decides
 * for you"), and that has to mean something — no plea, straight to silence.
 */
function PleaStep({ survival, snapshot, me }: Omit<Props, 'isHost'>) {
  const [step, setStep] = useState<'recap' | 'keypad' | 'plea' | 'silenced'>('recap');
  if (snapshot.escapedPlayerIds.includes(me)) return <Aboard snapshot={snapshot} me={me} />;
  if (step === 'recap') return <Recap snapshot={snapshot} me={me} onContinue={() => setStep('keypad')} />;
  if (step === 'keypad') {
    return (
      <Keypad
        survival={survival}
        snapshot={snapshot}
        me={me}
        onSkip={() => setStep('plea')}
        onSilenced={() => setStep('silenced')}
      />
    );
  }
  if (step === 'silenced') return <Silenced snapshot={snapshot} />;
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
  const marks = marksOf(snapshot.answers, me);

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
        <div className="recap-row">
          <span><strong>Marks against your name</strong></span>
          <span className="rate">{marks} of {RUTHLESS_LIMIT}</span>
        </div>
      </div>
      {odds !== null && (
        <p className="muted">
          Your survival rate so far: <strong className="amber">{odds}%</strong>. Still yours
          alone — the room finds out at the tribunal.
        </p>
      )}
      <button className="primary" onClick={onContinue}>Continue to the keypad</button>
    </>
  );
}

/**
 * The extraction keypad. A wrong guess is final in the sense that it counts,
 * never in the sense that it locks you out — there is always a way to try
 * again once the short cooldown clears, and the only feedback is right or
 * wrong, never "close."
 */
function Keypad({
  survival, snapshot, me, onSkip, onSilenced,
}: {
  survival: Survival; snapshot: Snapshot; me: string; onSkip: () => void; onSilenced: () => void;
}) {
  const [code, setCode] = useState('');
  const [rejected, setRejected] = useState(false);
  // Seeded from, and never allowed to fall behind, the team's own count from
  // the snapshot — the server-side truth arrives a beat after `submit`
  // resolves, so this closes that gap rather than flickering the input back
  // on for a moment. In solo mode "the team" is just me, so this degrades to
  // exactly the old per-player counter.
  const [localWrong, setLocalWrong] = useState(0);
  const wrongCount = Math.max(localWrong, snapshot.teamAttempts);
  const onATeam = Boolean(snapshot.myTeam && snapshot.myTeam.length > 1);
  // Ticks down on its own, once a second, regardless of how often the
  // backend happens to push a fresh snapshot — the local backend only pushes
  // one on a write, so without this a cleared cooldown would leave the
  // button reading "wait Ns" forever, which is exactly the kind of stuck
  // state this keypad must never produce.
  const [secondsLeft, setSecondsLeft] = useState(snapshot.retryInSeconds);
  const cooling = secondsLeft > 0;

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);

  // Watches the THRESHOLD, not just my own submissions — a teammate who
  // never once touched this keypad still has to be carried into silence
  // once the team's shared count crosses the line, because the wrong guess
  // that did it might have come from someone else's phone entirely. Depends
  // only on the boolean, never on `onSilenced` itself — that prop is a fresh
  // closure every render (it's an inline arrow in PleaStep), and depending on
  // it would clear and reschedule this timer on every snapshot push, so it
  // could never actually fire while updates kept arriving inside the delay.
  const skipTimer = useRef(0);
  const onSilencedRef = useRef(onSilenced);
  onSilencedRef.current = onSilenced;
  const outOfTries = wrongCount >= EXTRACTION.maxWrongGuesses;
  useEffect(() => {
    if (!outOfTries) return;
    // Give the room a beat to read "Rejected" before the screen moves on —
    // never an instant cut, but never a third try either. Straight to
    // silence, not the plea composer: running out of tries is the one way
    // into the tribunal that was never a choice.
    skipTimer.current = window.setTimeout(() => onSilencedRef.current(), 1400);
    return () => window.clearTimeout(skipTimer.current);
  }, [outOfTries]);

  const submit = async () => {
    setRejected(false);
    const result = await survival.escape(code);
    setCode('');
    if (!result?.accepted) {
      setRejected(true);
      setSecondsLeft(result?.retryInSeconds ?? 0);
      setLocalWrong(snapshot.teamAttempts + 1);
    }
  };

  return (
    <>
      <header>
        <p className="eyebrow">The extraction port</p>
        <h2>{EXTRACTION.prompt}</h2>
      </header>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Four green seals, read from the last berth back to the first.
      </p>
      {onATeam && (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          One keypad for the whole team — any of you can try it, and cracking it seats you all.
        </p>
      )}
      <input
        className="code keypad"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={EXTRACTION.length}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, EXTRACTION.length))}
        placeholder={'•'.repeat(EXTRACTION.length)}
        aria-label="Extraction code"
        disabled={cooling || survival.busy || wrongCount >= EXTRACTION.maxWrongGuesses}
      />
      {rejected && (
        <p className="error keypad-tries">
          {wrongCount >= EXTRACTION.maxWrongGuesses
            ? 'Rejected. That was the last try — the room decides now.'
            : cooling
              ? `Rejected. Try again in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}.`
              : 'Rejected.'}
        </p>
      )}
      <button
        className="primary"
        disabled={code.length < EXTRACTION.length || cooling || survival.busy || wrongCount >= EXTRACTION.maxWrongGuesses}
        onClick={() => void submit()}
      >
        {cooling ? `Wait ${secondsLeft}s` : 'Try the code'}
      </button>
      {onATeam && wrongCount > 0 && (
        <p className="muted" style={{ fontSize: '0.75rem' }}>
          Your team has tried {wrongCount} {wrongCount === 1 ? 'time' : 'times'} — that cooldown is shared too.
        </p>
      )}
      {snapshot.escapedPlayerIds.length > 0 && (
        <div>
          <p className="muted" style={{ fontSize: '0.8rem' }}>Already aboard:</p>
          <div className="roster">
            {snapshot.escapedPlayerIds.map((id) => (
              <span key={id} className="seat aboard">
                {snapshot.players.find((p) => p.id === id)?.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <Exchange survival={survival} snapshot={snapshot} me={me} />
      <Notepad gameId={snapshot.game.id} me={me} />
      <button className="link" onClick={onSkip}>I&rsquo;ll take my chances with the room</button>
    </>
  );
}

/** You made it. No plea to compose, no vote to enter — the seat is already yours. */
function Aboard({ snapshot, me }: { snapshot: Snapshot; me: string }) {
  const rank = snapshot.escapedPlayerIds.indexOf(me) + 1;
  const others = snapshot.escapedPlayerIds
    .filter((id) => id !== me)
    .map((id) => snapshot.players.find((p) => p.id === id)?.name)
    .filter(Boolean);
  const teammatesAboard = (snapshot.myTeam ?? []).filter((id) => id !== me && snapshot.escapedPlayerIds.includes(id));
  return (
    <div className="locked">
      <p className="eyebrow">Extraction code accepted</p>
      <p className="big">Seat {rank}</p>
      <p className="muted">You are on the chopper.</p>
      {teammatesAboard.length > 0 && <p className="muted">Cracked it together with your team.</p>}
      {others.length > 0 && <p className="muted">Also aboard: {others.join(', ')}</p>}
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        The port has your name. It also has your record.
      </p>
    </div>
  );
}

/**
 * Two wrong tries, and the port stops listening — no plea composer, because
 * this is the one way into the tribunal the player never chose. They still
 * see the room settle in around them; they just don't get a say in it.
 */
function Silenced({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="locked">
      <p className="eyebrow">The extraction port</p>
      <p className="big">Silenced</p>
      <p className="muted">
        Two wrong tries, and the port stopped listening. Nobody is pleading your case —
        the room decides without you.
      </p>
      <Waiting ids={snapshot.pleadedPlayerIds} players={snapshot.players} verb="filed a plea" />
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

  // An escapee needs neither a plea nor a vote to have "settled" — the code
  // already decided them.
  const settled = (ids: string[]) => new Set([...ids, ...snapshot.escapedPlayerIds]).size;
  const remaining = game.phase === 'plea'
    ? players.length - settled(snapshot.pleadedPlayerIds)
    : game.phase === 'tribunal' ? players.length - settled(snapshot.votedPlayerIds) : 0;
  if (game.phase === 'result') return null;

  return (
    <div className="console">
      <p className="eyebrow">Host</p>
      {game.phase === 'lobby' && (
        <div className="row">
          <button
            onClick={() => void survival.setMode(game.mode === 'consensus' ? 'solo' : 'consensus')}
            disabled={survival.busy}
          >
            {game.mode === 'consensus' ? 'Playing in teams — tap for solo' : 'Playing solo — tap for teams'}
          </button>
        </div>
      )}
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
