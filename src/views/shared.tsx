import { useEffect, useState } from 'react';
import { formatClock, secondsUntil } from '../lib/clock';
import { deckById } from '../game/decks';
import type { Card, Player, Round } from '../game/types';
import type { Theme } from '../game/themes';
import { Glyph, type GlyphName } from '../ui/Glyph';

/**
 * A glyph per mechanic. The word is always there too — this is recognition at
 * a glance from the back of a Zoom call, not a rebus.
 */
export const MECHANIC_GLYPH: Record<string, GlyphName> = {
  allplay: 'crowd',
  guesswho: 'mask',
  solo: 'person',
  duel: 'swords',
};

const MECHANIC_WORD: Record<string, string> = {
  allplay: 'Everyone answers',
  guesswho: 'Guess who',
  duel: 'Duel',
};

export function cardFor(deckId: string, cardId: string | null | undefined): Card | null {
  if (!cardId) return null;
  return deckById(deckId).cards.find((c) => c.id === cardId) ?? null;
}

export const nameOf = (players: Player[], id: string | null | undefined) =>
  players.find((p) => p.id === id)?.name ?? 'Someone';

/** Counts against the server's clock, not this device's. */
export function Countdown({ round, big = false }: { round: Round | null; big?: boolean }) {
  const [left, setLeft] = useState(() => secondsUntil(round?.deadlineAt));

  useEffect(() => {
    setLeft(secondsUntil(round?.deadlineAt));
    if (!round?.deadlineAt) return;
    const tick = window.setInterval(() => setLeft(secondsUntil(round.deadlineAt)), 250);
    return () => window.clearInterval(tick);
  }, [round?.deadlineAt, round?.id]);

  if (!round?.deadlineAt) return null;

  const tone = left <= 0 ? 'done' : left <= 5 ? 'crit' : left <= 15 ? 'warn' : '';
  return (
    <div
      className={`clock ${big ? 'clock-big' : ''} ${tone}`}
      role="timer"
      aria-live={left <= 5 ? 'assertive' : 'off'}
    >
      <Glyph name="hourglass" size={big ? 26 : 15} />
      {formatClock(left)}
    </div>
  );
}

/**
 * The rules, in the order a first-timer needs them.
 *
 * Written for someone reading it on a phone thirty seconds before the first
 * card, because that is when it will actually be read.
 */
export function HowToPlay({ theme }: { theme: Theme }) {
  return (
    <details className="how-to">
      <summary>How to play</summary>
      <div className="how-to-body">
        <p>
          Your screen tells you what to do, one thing at a time. When it says
          nothing, you have nothing to do — that is normal and it is most of the
          night.
        </p>

        <h4>The four kinds of card</h4>
        <dl>
          <dt>
            <Glyph name="crowd" size={15} />
            Everyone answers
          </dt>
          <dd>
            You all type an answer privately. They go up on the shared screen
            with no names on them and everyone votes for a favourite.{' '}
            <strong>1 point for answering, 2 for every vote you get.</strong>
          </dd>

          <dt>
            <Glyph name="mask" size={15} />
            Guess who
          </dt>
          <dd>
            Same, but you guess who wrote each one.{' '}
            <strong>2 points per correct guess, 1 for every person you fool.</strong>
          </dd>

          <dt>
            <Glyph name="person" size={15} />
            One person
          </dt>
          <dd>
            One player takes the card — a {theme.vocab.laneSay.toLowerCase()} or a{' '}
            {theme.vocab.laneDo.toLowerCase()} — and everyone else scores it 1–5.{' '}
            <strong>The median becomes their points.</strong> Commitment scores
            higher than talent.
          </dd>

          <dt>
            <Glyph name="swords" size={15} />
            Duel
          </dt>
          <dd>
            Two players, one prompt, the room picks.{' '}
            <strong>3 to the winner, 1 each for turning up.</strong>
          </dd>
        </dl>

        <h4>
          <Glyph name="cape" size={13} />
          The {theme.vocab.pass}
        </h4>
        <p>
          You get one, for the whole night. It ends the card you are on and{' '}
          <strong>costs you nothing at all</strong> — no points, no penalty, no
          catch. It is offered only when a card is asking you personally.
        </p>

        <h4>How the night goes</h4>
        <p>
          Cards start easy and get bolder, and never the other way round. You
          will have watched a dozen people survive something small before
          anything is asked of you.
        </p>
      </div>
    </details>
  );
}

export function Leaderboard({
  players,
  present,
  limit,
}: {
  players: Player[];
  present: string[];
  limit?: number;
}) {
  const here = new Set(present);
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const shown = limit ? sorted.slice(0, limit) : sorted;

  return (
    <ol className="leaderboard">
      {shown.map((p, i) => (
        <li key={p.id} className={i === 0 && p.score > 0 ? 'leading' : undefined}>
          <span className="lb-rank">{i + 1}</span>
          <span className="lb-name">
            {p.name}
            {p.isProxy && <em className="tagline"> proxy</em>}
            {!p.isProxy && !here.has(p.id) && <em className="tagline"> away</em>}
          </span>
          {!p.passSpent && <span className="lb-pass" title="Pass unspent" />}
          <span className="lb-score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function CardPanel({
  card,
  theme,
  subtitle,
  big = false,
}: {
  card: Card | null;
  theme: Theme;
  subtitle?: string;
  big?: boolean;
}) {
  if (!card) return null;
  const laneWord = card.lane === 'do' ? theme.vocab.laneDo : theme.vocab.laneSay;
  const typeLine = card.mechanic === 'solo' ? laneWord : MECHANIC_WORD[card.mechanic];

  // Laid out like a real card: a type line across the top, the title, the
  // rules text, then the flavour line under a rule. Card games settled on
  // that order because it survives being read in a hurry.
  return (
    <div className={`card-panel ${big ? 'card-big' : ''}`} data-lane={card.lane}>
      <span className="card-corner card-corner-tl" aria-hidden="true">
        <Glyph name="cobweb" size="100%" />
      </span>
      <span className="card-corner card-corner-br" aria-hidden="true">
        <Glyph name="cobweb" size="100%" />
      </span>

      <div className="card-meta">
        <span className={`tag ${card.lane === 'do' ? 'tag-do' : 'tag-say'}`}>
          <Glyph name={MECHANIC_GLYPH[card.mechanic] ?? 'person'} size={13} />
          {typeLine}
        </span>
        <span className="pips" aria-label={`Heat ${card.heat} of 3`}>
          {[1, 2, 3].map((h) => (
            <Glyph key={h} name="flame" size={13} className={h <= card.heat ? 'pip on' : 'pip'} />
          ))}
        </span>
        {subtitle && <span className="card-sub">{subtitle}</span>}
      </div>

      <h2 className="card-title">{card.title}</h2>
      <p className="card-say">{card.prompt}</p>
      <p className="card-wins">{card.wins}</p>
    </div>
  );
}

const REACTIONS = ['😂', '😱', '👏', '🔥', '💀', '🫣'];

export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji) => (
        <button key={emoji} className="reaction" onClick={() => onReact(emoji)} aria-label={emoji}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
